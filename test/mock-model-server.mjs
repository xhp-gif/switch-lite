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
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
