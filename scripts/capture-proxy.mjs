// 开发调试工具：把 Codex/OpenCode 发往供应商的请求原样转发到真实上游，
// 并记录请求体到临时目录 csl-proxy-log.jsonl，用于排查供应商兼容性。
// 用法: node scripts/capture-proxy.mjs <upstreamBaseUrl> [port]
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const upstream = String(process.argv[2] || '').replace(/\/+$/, '');
const port = Number(process.argv[3] || 18899);
const logFile = path.join(os.tmpdir(), 'csl-proxy-log.jsonl');

if (!upstream) {
  console.error('usage: node scripts/capture-proxy.mjs <upstreamBaseUrl> [port]');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    fs.appendFileSync(
      logFile,
      JSON.stringify({ at: new Date().toISOString(), url: req.url, method: req.method, body: body.slice(0, 400000) }) + '\n',
    );
    const u = new URL(upstream + req.url);
    const transport = u.protocol === 'https:' ? https : http;
    const headers = { ...req.headers, host: u.host, 'content-length': Buffer.byteLength(body) };
    const r2 = transport.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: req.method, headers }, (res2) => {
      let b = '';
      res2.on('data', (c) => { b += c; });
      res2.on('end', () => {
        res.writeHead(res2.statusCode, { 'content-type': res2.headers['content-type'] || 'application/json' });
        res.end(b);
      });
    });
    r2.on('error', (e) => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); });
    r2.write(body);
    r2.end();
  });
});

server.listen(port, () => {
  console.log(`capture proxy listening on 127.0.0.1:${port} -> ${upstream}`);
});
