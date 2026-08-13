// SwitchLite 本地中继：
// 1) 通用路由 /p/<providerId>/...：按供应商转发到真实上游并注入鉴权，
//    所有 Agent（Codex / Claude Code / Gemini / OpenCode / Hermes）的调用都经此计量 token 用量。
// 2) 旧路由 /v2（relay.json）：兼容早期写入的 Codex 配置，只做工具剥离透传。
// 工具剥离：Codex 桌面端会把应用自带的 namespace/custom 工具带进请求，
// 部分第三方网关（如千帆）只接受 function/mcp/knowledge_search，转发前剥掉。
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProvider } from './storage.js';
import { appendUsage } from './usage.js';

export const RELAY_PORT = Number(process.env.CCS_RELAY_PORT || 4180);
export const RELAY_ORIGIN = `http://127.0.0.1:${RELAY_PORT}`;
export const RELAY_BASE = `${RELAY_ORIGIN}/v2`; // 旧 Codex 配置使用的地址

// 写入各 Agent 配置的中转地址：/p/<供应商 id>
export function relayProviderUrl(providerId) {
  return `${RELAY_ORIGIN}/p/${providerId}`;
}

const STRICT_HOSTS = [
  'qianfan.baidubce.com',
  'dashscope.aliyuncs.com',
  'open.bigmodel.cn',
  'api.moonshot.cn',
  'ark.cn-beijing.volces.com',
  'api.siliconflow.cn',
];

const ALLOWED_TOOL_TYPES = new Set(['function', 'mcp', 'knowledge_search']);

function relayConfFile() {
  const home = process.env.CCS_LITE_HOME ? path.resolve(process.env.CCS_LITE_HOME) : path.join(os.homedir(), '.cc-switch-lite');
  return path.join(home, 'relay.json');
}

function readRelayConf() {
  try {
    return JSON.parse(fs.readFileSync(relayConfFile(), 'utf8'));
  } catch {
    return null;
  }
}

export function isStrictHost(upstream) {
  return STRICT_HOSTS.some((h) => String(upstream || '').includes(h));
}

// 严格网关 + Responses API 才需要剥离工具；新路由的 pathOnly 不带前导斜杠（"responses"），旧路由带（"/v2/responses"）
export function needsToolStrip(upstream, method, pathOnly) {
  return isStrictHost(upstream) && method === 'POST' && /(^|\/)responses$/.test(String(pathOnly || ''));
}

export function stripUnsupportedTools(body) {
  try {
    const obj = JSON.parse(body);
    if (!obj || !Array.isArray(obj.tools)) return body;
    obj.tools = obj.tools.filter((t) => t && ALLOWED_TOOL_TYPES.has(t.type));
    if (obj.tool_choice && typeof obj.tool_choice === 'object' && obj.tool_choice.type === 'function') {
      const name = obj.tool_choice.function?.name;
      if (name && !obj.tools.some((t) => t.name === name)) obj.tool_choice = 'auto';
    }
    return JSON.stringify(obj);
  } catch {
    return body;
  }
}

// ---------- 用量解析（纯函数，可单测） ----------

function sseDataLines(text) {
  return String(text || '')
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter((l) => l && l !== '[DONE]')
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseJsonOrSse(text) {
  const events = sseDataLines(text);
  if (events.length) return events;
  try {
    const obj = JSON.parse(text);
    return Array.isArray(obj) ? obj : [obj];
  } catch {
    return [];
  }
}

function modelFromRequest(protocol, reqPath, reqBody) {
  try {
    const obj = JSON.parse(reqBody || '');
    if (obj && typeof obj.model === 'string' && obj.model) return obj.model;
  } catch {
    /* 非 JSON 请求体 */
  }
  if (protocol === 'gemini') {
    const m = String(reqPath || '').match(/\/models\/([^:/]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return '';
}

// 从响应文本（SSE 或 JSON）提取 token 用量，统一为 {input, output}
export function extractUsage(protocol, reqPath, reqBody, respText) {
  try {
    const events = parseJsonOrSse(respText);
    if (!events.length) return null;
    const model = modelFromRequest(protocol, reqPath, reqBody);
    let input = 0;
    let output = 0;
    let cached = 0;
    let found = false;

    for (const ev of events) {
      // OpenAI Responses API：终态事件的 response.usage
      const ru = ev?.response?.usage;
      if (ru && (ru.input_tokens != null || ru.output_tokens != null)) {
        input = Number(ru.input_tokens) || 0;
        output = Number(ru.output_tokens) || 0;
        cached = Number(ru.input_tokens_details?.cached_tokens) || 0;
        found = true;
        continue;
      }
      // Anthropic：message_start 带 input_tokens，message_delta 带 output_tokens（取最后一次）
      if (ev?.type === 'message_start' && ev?.message?.usage) {
        input = Number(ev.message.usage.input_tokens) || 0;
        output = Number(ev.message.usage.output_tokens) || 0;
        cached = Number(ev.message.usage.cache_read_input_tokens) || 0;
        found = true;
        continue;
      }
      if (ev?.type === 'message_delta' && ev?.usage?.output_tokens != null) {
        output = Number(ev.usage.output_tokens) || 0;
        found = true;
        continue;
      }
      // Gemini：usageMetadata（流式取最后一个）
      const gm = ev?.usageMetadata;
      if (gm && (gm.promptTokenCount != null || gm.candidatesTokenCount != null)) {
        input = Number(gm.promptTokenCount) || 0;
        output = Number(gm.candidatesTokenCount) || 0;
        cached = Number(gm.cachedContentTokenCount) || 0;
        found = true;
        continue;
      }
      // OpenAI Chat Completions / Anthropic 非流式：顶层 usage
      const u = ev?.usage;
      if (u) {
        const i = u.prompt_tokens ?? u.input_tokens;
        const o = u.completion_tokens ?? u.output_tokens;
        if (i != null || o != null) {
          input = Number(i) || 0;
          output = Number(o) || 0;
          cached = Number(u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens) || 0;
          found = true;
        }
      }
    }
    if (!found) return null;
    return { model, input, output, total: input + output, cached };
  } catch {
    return null;
  }
}

// ---------- 转发 ----------

function forward(req, res, { upstream, headers, body, onDone }) {
  const u = new URL(upstream);
  const transport = u.protocol === 'https:' ? https : http;
  const r2 = transport.request(
    {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: req.method,
      headers,
    },
    (res2) => {
      res.writeHead(res2.statusCode, res2.headers);
      res2.pipe(res);
      // 计量 tap：旁路累积响应文本，绝不影响透传
      if (onDone) {
        let captured = '';
        res2.on('data', (c) => {
          if (captured.length < 2 * 1024 * 1024) captured += c.toString('utf8');
        });
        res2.on('end', () => {
          try {
            onDone(res2.statusCode, captured);
          } catch {
            /* 计量失败静默 */
          }
        });
      }
    },
  );
  r2.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  });
  r2.write(body);
  r2.end();
}

function readBody(req, cb) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 16 * 1024 * 1024) req.destroy();
  });
  req.on('end', () => cb(body));
}

// 通用路由：/p/<providerId>/<rest...>
function handleProviderRoute(req, res, providerId, restWithQuery) {
  const provider = getProvider(providerId);
  if (!provider || !provider.baseUrl) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'relay：供应商不存在或已删除，请在 SwitchLite 中重新接入' }));
    return;
  }
  const protocol = provider.protocol || 'openai';
  let upstream = protocol === 'anthropic' ? provider.anthropicUrl || provider.baseUrl : provider.baseUrl;
  upstream = String(upstream).replace(/\/+$/, '');
  // Gemini SDK 会自带 /v1beta 版本路径，上游 base 里若已包含则去掉避免重复
  if (protocol === 'gemini') upstream = upstream.replace(/\/v1beta$/i, '').replace(/\/v1$/i, '');

  readBody(req, (body) => {
    let outBody = body;
    const pathOnly = restWithQuery.split('?')[0];
    if (needsToolStrip(upstream, req.method, pathOnly)) {
      outBody = stripUnsupportedTools(body);
    }
    const headers = { ...req.headers };
    delete headers.authorization;
    delete headers['x-api-key'];
    delete headers['x-goog-api-key'];
    if (provider.apiKey) {
      if (protocol === 'anthropic') headers['x-api-key'] = provider.apiKey;
      else if (protocol === 'gemini') headers['x-goog-api-key'] = provider.apiKey;
      else headers.authorization = `Bearer ${provider.apiKey}`;
    }
    const target = `${upstream}/${restWithQuery}`;
    headers.host = new URL(target).host;
    headers['content-length'] = Buffer.byteLength(outBody);
    const startedAt = Date.now();
    forward(req, res, {
      upstream: target,
      headers,
      body: outBody,
      onDone: (status, respText) => {
        const usage = extractUsage(protocol, pathOnly, body, respText);
        appendUsage({
          providerId: provider.id,
          providerName: provider.name,
          target: provider.target,
          model: usage?.model || modelFromRequest(protocol, pathOnly, body),
          input: usage?.input || 0,
          output: usage?.output || 0,
          total: usage?.total || 0,
          cached: usage?.cached || 0,
          durationMs: Date.now() - startedAt,
          status,
          ok: status < 400,
        });
      },
    });
  });
}

// 旧路由：relay.json 直通（早期写入的 Codex 配置）
function handleLegacyRoute(req, res) {
  const conf = readRelayConf();
  if (!conf || !conf.upstream) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'relay 未配置：请先在 SwitchLite 中接入 Codex 供应商' }));
    return;
  }
  readBody(req, (body) => {
    let outBody = body;
    if (needsToolStrip(conf.upstream, req.method, req.url)) {
      outBody = stripUnsupportedTools(body);
    }
    const u = new URL(String(conf.upstream).replace(/\/+$/, '') + (req.url || '/'));
    const headers = { ...req.headers, host: u.host, 'content-length': Buffer.byteLength(outBody) };
    if (conf.apiKey) headers.authorization = `Bearer ${conf.apiKey}`;
    forward(req, res, { upstream: u.toString(), headers, body: outBody, onDone: null });
  });
}

export function startRelay() {
  const startedAt = Date.now();
  const server = http.createServer((req, res) => {
    // 健康检查：供启动器判断中继是否存活、是否需要按代码新旧替换
    if (req.method === 'GET' && (req.url === '/__health' || req.url === '/__health/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pid: process.pid, startedAt }));
      return;
    }
    const m = String(req.url || '').match(/^\/p\/([A-Za-z0-9-]+)\/?(.*)$/);
    if (m) return handleProviderRoute(req, res, m[1], m[2]);
    return handleLegacyRoute(req, res);
  });
  server.listen(RELAY_PORT, '127.0.0.1', () => {
    console.log(`SwitchLite relay listening on 127.0.0.1:${RELAY_PORT}`);
  });
  server.on('error', (e) => {
    console.error('[relay] 启动失败:', e.message);
  });
  return server;
}
