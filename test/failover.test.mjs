// 熔断 + 故障转移：备选链选择、熔断状态机、端到端转移
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-failover-'));
process.env.CCS_LITE_HOME = tmp;
process.env.CCS_RELAY_PORT = '0';

const { startRelay, recordAttempt, breakerState, failoverChain } = await import('../server/relay.js');
const storage = await import('../server/storage.js');
const { readUsage } = await import('../server/usage.js');

test('熔断器状态机：连续失败 3 次熔断，期满半开，成功复位', () => {
  const id = 'breaker-unit';
  assert.equal(breakerState(id).open, false);
  recordAttempt(id, false);
  recordAttempt(id, false);
  assert.equal(breakerState(id).open, false, '2 次失败不应熔断');
  recordAttempt(id, false);
  assert.equal(breakerState(id).open, true, '3 次失败应熔断');
  // 熔断期满后允许试探
  assert.equal(breakerState(id, Date.now() + 121_000).open, false);
  recordAttempt(id, true);
  assert.equal(breakerState(id).fails, 0, '成功后应复位');
});

test('备选链：只纳入同 Agent 且模型列表包含请求模型的供应商，跳过熔断中的', () => {
  const all = [
    { id: 'p1', target: 'codex', baseUrl: 'http://a', models: [{ id: 'm1' }] },
    { id: 'p2', target: 'codex', baseUrl: 'http://b', models: [{ id: 'm1' }] },
    { id: 'p3', target: 'codex', baseUrl: 'http://c', models: [{ id: 'other' }] },
    { id: 'p4', target: 'claude', baseUrl: 'http://d', models: [{ id: 'm1' }] },
    { id: 'p5', target: 'codex', baseUrl: 'http://e', models: [] },
  ];
  recordAttempt('p2', false);
  recordAttempt('p2', false);
  recordAttempt('p2', false); // 熔断 p2
  const chain = failoverChain('p1', 'm1', all);
  assert.deepEqual(chain.map((p) => p.id), [], 'p2 熔断、p3 无此模型、p4 不同 Agent、p5 无模型列表');
  const chain2 = failoverChain('p1', 'm1', all, Date.now() + 121_000);
  assert.deepEqual(chain2.map((p) => p.id), ['p2'], '熔断期满应重新纳入');
});

test('端到端：主供应商 500 → 自动转移到备用，计量两条且带转移标记', async (t) => {
  const upstreamA = http.createServer((req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"upstream A broken"}');
  });
  const upstreamB = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":5}}}\n\n');
  });
  await new Promise((r) => upstreamA.listen(0, '127.0.0.1', r));
  await new Promise((r) => upstreamB.listen(0, '127.0.0.1', r));

  const relayServer = startRelay();
  await new Promise((r) => relayServer.on('listening', r));
  const relayPort = relayServer.address().port;

  t.after(() => {
    relayServer.close();
    upstreamA.close();
    upstreamB.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const a = storage.createProvider({
    name: 'Broken A',
    target: 'codex',
    baseUrl: `http://127.0.0.1:${upstreamA.address().port}/v1`,
    apiKey: 'sk-a',
    protocol: 'openai',
    models: [{ id: 'shared-model' }],
  });
  const b = storage.createProvider({
    name: 'Backup B',
    target: 'codex',
    baseUrl: `http://127.0.0.1:${upstreamB.address().port}/v1`,
    apiKey: 'sk-b',
    protocol: 'openai',
    models: [{ id: 'shared-model' }],
  });

  const res = await fetch(`http://127.0.0.1:${relayPort}/p/${a.id}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'shared-model', input: 'hi', stream: true }),
  });
  assert.equal(res.status, 200, '应转移到备用供应商并成功');
  const text = await res.text();
  assert.ok(text.includes('response.completed'));

  await new Promise((r) => setTimeout(r, 150));
  const events = readUsage();
  assert.equal(events.length, 2, '两次尝试各记一条');
  const [failEv, okEv] = events;
  assert.equal(failEv.providerName, 'Broken A');
  assert.equal(failEv.status, 500);
  assert.equal(failEv.retried, true, '被转移的失败尝试应带 retried 标记');
  assert.equal(okEv.providerName, 'Backup B');
  assert.equal(okEv.ok, true);
  assert.equal(okEv.failoverFrom, 'Broken A');
  assert.equal(okEv.failoverTo, 'Backup B');
  assert.equal(okEv.total, 15);
});

test('关闭故障转移开关：主供应商 500 原样返回给客户端', async (t) => {
  storage.updateSettings({ failover: false });
  t.after(() => storage.updateSettings({ failover: true }));

  const upstream = http.createServer((req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"still broken"}');
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const relayServer = startRelay();
  await new Promise((r) => relayServer.on('listening', r));
  const relayPort = relayServer.address().port;
  t.after(() => {
    relayServer.close();
    upstream.close();
  });

  const p = storage.createProvider({
    name: 'Solo',
    target: 'claude',
    baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
    apiKey: 'sk-solo',
    protocol: 'openai',
    models: [{ id: 'm' }],
  });
  const res = await fetch(`http://127.0.0.1:${relayPort}/p/${p.id}/responses`, {
    method: 'POST',
    body: JSON.stringify({ model: 'm' }),
  });
  assert.equal(res.status, 500, '开关关闭时不应转移，错误原样返回');
});
