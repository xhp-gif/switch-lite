import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// 必须早于动态 import 的服务端模块（RELAY_PORT 等在模块加载时求值）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-relay-'));
process.env.CCS_LITE_HOME = tmp;
process.env.CCS_RELAY_PORT = '0'; // 随机端口，避免与运行中的实例冲突

const { startRelay } = await import('../server/relay.js');
const storage = await import('../server/storage.js');
const { readUsage } = await import('../server/usage.js');

test('中继全链路：/p/<id> 转发 -> 鉴权注入 -> SSE 计量落盘', async (t) => {
  // 模拟上游：OpenAI Responses API，SSE 返回 usage
  let seenAuth = null;
  const upstream = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/responses') {
      seenAuth = req.headers.authorization;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        [
          'data: {"type":"response.created","response":{"id":"r1"}}',
          '',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":111,"output_tokens":22}}}',
          '',
        ].join('\n'),
      );
      return;
    }
    res.writeHead(404).end('{}');
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upstreamPort = upstream.address().port;

  const relayServer = startRelay();
  await new Promise((r) => relayServer.on('listening', r));
  const relayPort = relayServer.address().port;

  t.after(() => {
    relayServer.close();
    upstream.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const provider = storage.createProvider({
    name: 'Relay Mock',
    target: 'codex',
    baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    apiKey: 'sk-relay-test',
    protocol: 'openai',
  });

  // 模拟 Codex：POST <relay>/p/<id>/responses（应被转发到 <upstream>/v1/responses）
  const res = await fetch(`http://127.0.0.1:${relayPort}/p/${provider.id}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: 'Bearer should-be-replaced' },
    body: JSON.stringify({ model: 'mock-model', input: 'hi', stream: true }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('response.completed'), '响应应原样透传');
  assert.equal(seenAuth, 'Bearer sk-relay-test', '中继应注入供应商真实 key 并覆盖客户端带来的值');

  // 计量是响应结束后的旁路动作，稍等落盘
  await new Promise((r) => setTimeout(r, 150));
  const events = readUsage();
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.providerId, provider.id);
  assert.equal(e.providerName, 'Relay Mock');
  assert.equal(e.target, 'codex');
  assert.equal(e.model, 'mock-model');
  assert.equal(e.input, 111);
  assert.equal(e.output, 22);
  assert.equal(e.status, 200);
  assert.equal(e.ok, true);

  // 健康检查：启动器据此判断中继存活与代码新旧
  const health = await fetch(`http://127.0.0.1:${relayPort}/__health`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(typeof health.pid, 'number');
  assert.equal(typeof health.startedAt, 'number');

  // 未知供应商：502，不产生计量
  const res2 = await fetch(`http://127.0.0.1:${relayPort}/p/no-such-id/responses`, { method: 'POST', body: '{}' });
  assert.equal(res2.status, 502);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(readUsage().length, 1);
});
