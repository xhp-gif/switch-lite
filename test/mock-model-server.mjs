import http from 'node:http';

export function startMockServer(port = 18999) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname === '/v1/models') {
        const auth = req.headers.authorization || '';
        if (!auth.startsWith('Bearer sk-test-')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'deepseek-v4-pro', object: 'model' },
              { id: 'deepseek-r1', object: 'model' },
              { id: 'glm-5.2', object: 'model' },
              { id: 'kimi/kimi-k3', object: 'model' },
              { id: 'qwen3.8-max', object: 'model' },
              { id: 'text-embedding-v4', object: 'model' },
            ],
          }),
        );
        return;
      }
      // 模拟“订阅 key 打按量端点”：无论 key 对错都 401（用于变体端点自动探测测试）
      if (url.pathname === '/locked/v1/models') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
        return;
      }
      // 模拟“订阅专用端点”：合法 key 才放行
      if (url.pathname === '/coding/v1/models') {
        const auth = req.headers.authorization || '';
        if (!auth.startsWith('Bearer sk-test-')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'glm-4.7' }, { id: 'glm-4.6' }] }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
