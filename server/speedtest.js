// 供应商测速：对模型列表端点做 1 次热身 + 1 次计时 GET。
// 测的是 API 端点网络/网关响应速度，不代表模型推理速度。
import { buildModelCandidates, headersFor, normalizeBaseUrl } from './registry.js';

async function timedGet(url, headers, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    // 读完响应体才算完整往返（避免只测到首包）
    await res.text();
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error: err && err.name === 'AbortError' ? '请求超时' : err && err.message ? err.message : '网络错误',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function speedtestProvider(provider, { timeoutMs = 8000 } = {}) {
  const base = normalizeBaseUrl(provider.baseUrl || '');
  if (!base) return { ok: false, latencyMs: 0, error: '未填写 Base URL' };
  const candidates = buildModelCandidates(base, provider.protocol || 'openai');
  if (!candidates.length) return { ok: false, latencyMs: 0, error: '无法解析 Base URL' };
  const headers = headersFor(provider.protocol || 'openai', provider.apiKey || '');

  // 热身（不计时）：排除 TLS 握手/DNS 首连开销
  await timedGet(candidates[0], headers, timeoutMs);

  let last = null;
  for (const url of candidates) {
    const r = await timedGet(url, headers, timeoutMs);
    last = { ...r, endpoint: url };
    if (r.ok) return { ok: true, latencyMs: r.latencyMs, endpoint: url };
    // 鉴权失败说明链路是通的，延迟仍有参考价值
    if (r.status === 401 || r.status === 403) {
      return { ok: true, latencyMs: r.latencyMs, endpoint: url, warning: '端点可达但鉴权失败，请检查 API Key' };
    }
  }
  return {
    ok: false,
    latencyMs: last ? last.latencyMs : 0,
    endpoint: last ? last.endpoint : candidates[0],
    error: last && last.error ? last.error : last && last.status ? `HTTP ${last.status}` : '网络错误',
  };
}
