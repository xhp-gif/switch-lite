// 测速：正常端点、鉴权失败仍算可达、连接失败
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { speedtestProvider } = await import('../server/speedtest.js');

test('测速：正常端点返回延迟；鉴权失败视为可达；断连返回错误', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"data":[{"id":"m1"}]}');
      }, 30);
      return;
    }
    if (req.url === '/v2/models') {
      res.writeHead(401).end('{}');
      return;
    }
    res.writeHead(404).end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  t.after(() => server.close());

  const ok = await speedtestProvider({ baseUrl: `http://127.0.0.1:${port}/v1`, protocol: 'openai', apiKey: 'sk-x' });
  assert.equal(ok.ok, true);
  assert.ok(ok.latencyMs >= 0 && ok.latencyMs < 5000, `延迟应在合理范围，实际 ${ok.latencyMs}ms`);
  assert.equal(ok.endpoint, `http://127.0.0.1:${port}/v1/models`);

  const auth = await speedtestProvider({ baseUrl: `http://127.0.0.1:${port}/v2`, protocol: 'openai', apiKey: '' });
  assert.equal(auth.ok, true, '401 说明链路可达');
  assert.match(auth.warning, /鉴权/);

  const dead = await speedtestProvider({ baseUrl: 'http://127.0.0.1:1/v1', protocol: 'openai', apiKey: '' }, { timeoutMs: 2000 });
  assert.equal(dead.ok, false);
  assert.ok(dead.error);

  const empty = await speedtestProvider({ baseUrl: '', protocol: 'openai' });
  assert.equal(empty.ok, false);
});
