import { VENDOR_PRESETS } from './presets.js';

// 从探测成功的 endpoint 反推标准化有效的 Base URL
export function resolveBaseFromEndpoint(endpoint) {
  return String(endpoint || '')
    .replace(/\/models$/i, '')
    .replace(/\/api\/tags$/i, '')
    .replace(/\/+$/, '');
}

// ---------- 厂商端点登记表（按量 / 订阅多地址支持） ----------
// 从 VENDOR_PRESETS 的 baseUrl / anthropicUrl / variants 汇总出每个 origin 的
// 合法路径集合与默认端点：纠偏时只放行登记过的路径（含其版本子路径），
// 未登记的路径才回退到该厂商的默认端点——避免把用户粘贴的编程订阅地址
// （如 open.bigmodel.cn/api/coding/paas/v4）改写回按量 API 地址。
const HOST_RULES = (() => {
  const map = new Map();
  const addUrl = (raw) => {
    if (!raw) return;
    let u;
    try {
      u = new URL(raw);
    } catch {
      return;
    }
    const origin = u.origin;
    const pathname = u.pathname.replace(/\/+$/, '') || '/';
    // 根路径 base（如 api.deepseek.com）没有“必须带某路径”的约束，
    // 不登记纠偏规则，避免把用户填的 /v1 等版本路径误清掉
    if (pathname === '/') return;
    let rule = map.get(origin);
    if (!rule) {
      rule = { default: `${origin}${pathname}`, paths: [] };
      map.set(origin, rule);
    }
    if (!rule.paths.includes(pathname)) rule.paths.push(pathname);
  };
  // 顺序即优先级：preset.baseUrl 先登记，成为该 origin 的默认端点
  for (const p of VENDOR_PRESETS) {
    addUrl(p.baseUrl);
    addUrl(p.anthropicUrl);
    for (const v of p.variants || []) addUrl(v.baseUrl);
  }
  return map;
})();

function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(String(hostname || '').toLowerCase());
}

function hostHealTarget(url) {
  // 本地服务是用户自己管的，不做厂商纠偏
  if (isLocalHost(url.hostname)) return null;
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const rule = HOST_RULES.get(url.origin);
  if (!rule) return null;
  // 路径与登记过的端点一致，或是其版本子路径（如 /api/anthropic/v1）→ 放行
  const known = rule.paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return known ? null : rule.default;
}

// 列出与 baseUrl 同 origin 的其它已登记端点（同厂商的按量/订阅地址），
// 供 discoverModels 在 key 被拒时自动重试
export function variantEndpointsFor(baseUrl) {
  let origin;
  try {
    origin = new URL(normalizeBaseUrl(baseUrl)).origin;
  } catch {
    return [];
  }
  const seen = new Set([stripTrailingSlash(String(baseUrl || '')).toLowerCase()]);
  const out = [];
  for (const p of VENDOR_PRESETS) {
    const entries = [
      ...(p.variants || []).map((v) => ({ ...v, protocol: v.protocol || p.protocol, wireApi: v.wireApi || p.wireApi })),
      p.anthropicUrl
        ? { id: 'anthropic', label: 'Anthropic 兼容', desc: '', baseUrl: p.anthropicUrl, protocol: 'anthropic', wireApi: p.wireApi }
        : null,
      { id: 'default', label: p.name, desc: '', baseUrl: p.baseUrl, protocol: p.protocol, wireApi: p.wireApi },
    ].filter(Boolean);
    for (const e of entries) {
      let u;
      try {
        u = new URL(e.baseUrl);
      } catch {
        continue;
      }
      if (u.origin !== origin) continue;
      const key = stripTrailingSlash(e.baseUrl).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        presetId: p.id,
        variantId: e.id,
        label: e.label,
        desc: e.desc || '',
        baseUrl: stripTrailingSlash(e.baseUrl),
        protocol: e.protocol,
        wireApi: e.wireApi,
      });
    }
  }
  return out;
}

// 智能输入推导：根据用户输入的 URL 或 API Key 指纹，自动推测协议、供应商预设与标准 Base URL
export function inferProviderHint({ url = '', apiKey = '' }) {
  const cleanKey = String(apiKey || '').trim();
  const cleanUrl = String(url || '').trim().toLowerCase();

  // 1. API Key 特征指纹
  if (cleanKey.startsWith('bce-v3/')) {
    return { protocol: 'openai', presetId: 'baidu', baseUrl: 'https://qianfan.baidubce.com/v2', name: '百度千帆' };
  }
  if (cleanKey.startsWith('sk-ant-')) {
    return { protocol: 'anthropic', presetId: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', name: 'Anthropic' };
  }
  if (cleanKey.startsWith('AIza')) {
    return { protocol: 'gemini', presetId: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', name: 'Google Gemini' };
  }
  if (cleanKey.startsWith('sk-or-v1-')) {
    return { protocol: 'openai', presetId: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', name: 'OpenRouter' };
  }

  // 2. 域名特征指纹
  if (cleanUrl.includes('qianfan.baidubce.com')) {
    return { protocol: 'openai', presetId: 'baidu', baseUrl: 'https://qianfan.baidubce.com/v2', name: '百度千帆' };
  }
  if (cleanUrl.includes('dashscope.aliyuncs.com')) {
    return {
      protocol: 'openai',
      presetId: 'aliyun',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      anthropicUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
      name: '阿里云百炼',
    };
  }
  if (cleanUrl.includes('open.bigmodel.cn')) {
    if (cleanUrl.includes('/api/coding')) {
      return { protocol: 'openai', presetId: 'zhipu', variantId: 'coding', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', name: '智谱 GLM 编程订阅' };
    }
    if (cleanUrl.includes('/api/anthropic')) {
      return { protocol: 'anthropic', presetId: 'zhipu', variantId: 'coding-anthropic', baseUrl: 'https://open.bigmodel.cn/api/anthropic', name: '智谱 GLM 编程订阅' };
    }
    return { protocol: 'openai', presetId: 'zhipu', variantId: 'api', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', name: '智谱 GLM' };
  }
  if (cleanUrl.includes('api.kimi.com')) {
    return { protocol: 'anthropic', presetId: 'moonshot', variantId: 'coding', baseUrl: 'https://api.kimi.com/coding/v1', name: 'Kimi For Coding' };
  }
  if (cleanUrl.includes('api.moonshot.cn')) {
    return { protocol: 'openai', presetId: 'moonshot', variantId: 'api', baseUrl: 'https://api.moonshot.cn/v1', name: 'Moonshot Kimi' };
  }
  if (cleanUrl.includes('api.deepseek.com')) {
    return { protocol: 'openai', presetId: 'deepseek', baseUrl: 'https://api.deepseek.com', name: 'DeepSeek 官方' };
  }
  if (cleanUrl.includes('api.siliconflow.cn')) {
    return { protocol: 'openai', presetId: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', name: '硅基流动 SiliconFlow' };
  }
  if (cleanUrl.includes('volces.com')) {
    return { protocol: 'openai', presetId: 'volcengine', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', name: '火山方舟 Ark' };
  }
  if (cleanUrl.includes('api.minimaxi.com')) {
    if (cleanUrl.includes('/anthropic')) {
      return { protocol: 'anthropic', presetId: 'minimax', variantId: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', name: 'MiniMax（Anthropic 兼容）' };
    }
    return { protocol: 'openai', presetId: 'minimax', variantId: 'api', baseUrl: 'https://api.minimaxi.com/v1', name: 'MiniMax' };
  }
  if (cleanUrl.includes('api.x.ai')) {
    return { protocol: 'openai', presetId: 'xai', baseUrl: 'https://api.x.ai/v1', name: 'xAI Grok' };
  }
  if (cleanUrl.includes('generativelanguage.googleapis.com')) {
    return { protocol: 'gemini', presetId: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', name: 'Google Gemini' };
  }
  if (cleanUrl.includes('anthropic.com')) {
    return { protocol: 'anthropic', presetId: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', name: 'Anthropic' };
  }

  return null;
}

export function stripTrailingSlash(s) {
  return String(s || '').trim().replace(/\/+$/, '');
}

export function normalizeBaseUrl(input) {
  let url = stripTrailingSlash(input);
  if (!url) return '';
  // 自动补齐协议前缀
  if (!/^https?:\/\//i.test(url)) {
    url = /^localhost|^127\.0\.0\.1/i.test(url) ? `http://${url}` : `https://${url}`;
  }
  // 去掉用户可能粘贴的“动作型”完整路径
  url = url.replace(/\/chat\/completions$/i, '');
  url = url.replace(/\/completions$/i, '');
  url = url.replace(/\/responses$/i, '');
  url = url.replace(/\/messages$/i, '');
  url = url.replace(/\/embeddings$/i, '');
  // 去掉结尾 /models，保留 /v1，我们会按需重新拼接
  url = url.replace(/\/models$/i, '');
  url = stripTrailingSlash(url);

  // 厂商端点智能纠偏：路径不是该厂商登记过的任何端点（含按量/订阅变体及其
  // 版本子路径）时，才回退到默认端点；登记过的路径原样放行
  try {
    const u = new URL(url);
    const healed = hostHealTarget(u);
    if (healed) url = healed;
  } catch {
    /* ignore */
  }

  return url;
}

export function buildModelCandidates(baseUrl, protocol) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return [];
  const candidates = [];
  const add = (u) => {
    if (u && !candidates.includes(u)) candidates.push(u);
  };

  try {
    const u = new URL(base);
    if (u.hostname.includes('qianfan.baidubce.com')) {
      add(`${u.origin}/v2/models`);
      return candidates;
    }
  } catch {
    /* ignore */
  }

  if (protocol === 'anthropic') {
    add(`${base}/models`);
    if (!/\/v1$/i.test(base)) add(`${base}/v1/models`);
    return candidates;
  }

  if (protocol === 'gemini') {
    add(`${base}/models`);
    return candidates;
  }

  // OpenAI 兼容
  add(`${base}/models`);
  if (!/\/v1$/i.test(base) && !/\/v2$/i.test(base) && !/\/v3$/i.test(base) && !/\/v4$/i.test(base)) {
    add(`${base}/v1/models`);
    add(`${base}/api/v1/models`);
    add(`${base}/api/models`);
    add(`${base}/v2/models`);
  }

  try {
    const u = new URL(base);
    const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (isLocal) add(`${u.origin}/api/tags`);
  } catch {
    /* 非法 URL 后面会报错 */
  }

  // DashScope 原生路径 -> 尝试 compatible-mode
  try {
    const u = new URL(base);
    if (u.hostname.includes('dashscope') && /\/api\/v1$/.test(u.pathname)) {
      add(`${u.origin}/compatible-mode/v1/models`);
    }
    if (u.hostname.includes('qianfan.baidubce.com') && !/\/v2$/.test(u.pathname)) {
      add(`${u.origin}/v2/models`);
    }
  } catch {
    /* ignore */
  }

  return candidates;
}

export function parseModels(payload, protocol) {
  const out = [];
  const push = (id) => {
    if (!id) return;
    let clean = String(id).trim();
    if (protocol === 'gemini' && clean.startsWith('models/')) clean = clean.slice('models/'.length);
    if (clean && !out.some((m) => m.id === clean)) out.push({ id: clean });
  };

  if (payload && Array.isArray(payload.data)) {
    for (const item of payload.data) push(item.id ?? item.name ?? item.model);
  }
  if (payload && Array.isArray(payload.models)) {
    for (const item of payload.models) push(item.name ?? item.id ?? item.model);
  }
  if (Array.isArray(payload)) {
    for (const item of payload) push(item.id ?? item.name ?? item.model);
  }
  return out;
}

export function authFor(protocol, apiKey = '', baseUrl = '') {
  const cleanKey = String(apiKey || '').trim();
  const cleanUrl = String(baseUrl || '').trim().toLowerCase();
  // 特征指纹优先级最高：百度千帆、DeepSeek、阿里云等始终使用 Bearer
  if (
    cleanKey.startsWith('bce-v3/') ||
    cleanUrl.includes('qianfan.baidubce.com') ||
    cleanUrl.includes('deepseek') ||
    cleanUrl.includes('dashscope') ||
    cleanUrl.includes('bigmodel') ||
    cleanUrl.includes('moonshot') ||
    cleanUrl.includes('siliconflow')
  ) {
    return 'bearer';
  }
  if (cleanKey.startsWith('sk-ant-') || cleanUrl.includes('anthropic.com')) {
    return 'x-api-key';
  }
  if (cleanKey.startsWith('AIza') || cleanUrl.includes('generativelanguage.googleapis.com')) {
    return 'x-goog-api-key';
  }
  if (protocol === 'anthropic') return 'x-api-key';
  if (protocol === 'gemini') return 'x-goog-api-key';
  return 'bearer';
}

export function headersFor(protocol, apiKey, baseUrl = '') {
  const headers = { 'User-Agent': 'SwitchLite/0.1', Accept: 'application/json' };
  if (!apiKey) return headers;
  const auth = authFor(protocol, apiKey, baseUrl);
  if (auth === 'x-api-key') headers['x-api-key'] = apiKey;
  else if (auth === 'x-goog-api-key') headers['x-goog-api-key'] = apiKey;
  else headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function tryFetch(url, headers, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* 非 JSON 响应 */
    }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 200) };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err && err.name === 'AbortError' ? '请求超时' : err && err.message ? err.message : '网络错误',
      json: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 根据 Base URL 直接获取供应商模型列表。
 * 会依次尝试多个候选端点，直到拿到非空模型列表。
 */
export async function discoverModels({ baseUrl, apiKey = '', protocol = 'openai', timeoutMs = 12000, variants = null }) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error('请先填写 Base URL');
  const candidates = buildModelCandidates(base, protocol);
  if (!candidates.length) throw new Error(`无法解析 Base URL：${baseUrl}`);
  const headers = headersFor(protocol, apiKey, base);
  const attempts = [];

  for (const url of candidates) {
    const r = await tryFetch(url, headers, timeoutMs);
    attempts.push({ url, status: r.status, ok: r.ok, error: r.error || null });
    if (r.ok) {
      const models = parseModels(r.json, protocol);
      if (models.length) {
        const resolvedBaseUrl = resolveBaseFromEndpoint(url);
        return { models, endpoint: url, resolvedBaseUrl, attempts };
      }
    }
  }

  const authFailed = attempts.some((a) => a.status === 401 || a.status === 403);

  // key 被拒（401/403）但该厂商登记了多个端点（按量 API / 编程订阅等）：
  // 用同一把 key 逐个变体端点重试，哪个通就用哪个——订阅 key 打按量地址
  // 必然 401，反之亦然，这是区分“key 错”和“地址错”的关键信号。
  let variantsTried = 0;
  if (authFailed) {
    for (const alt of variants ?? variantEndpointsFor(base)) {
      const altProtocol = alt.protocol || protocol;
      const altCandidates = buildModelCandidates(alt.baseUrl, altProtocol);
      if (altCandidates.length) variantsTried++;
      const altHeaders = headersFor(altProtocol, apiKey, alt.baseUrl);
      for (const url of altCandidates) {
        const r = await tryFetch(url, altHeaders, timeoutMs);
        attempts.push({ url, status: r.status, ok: r.ok, error: r.error || null, variant: alt.label });
        if (r.ok) {
          const models = parseModels(r.json, altProtocol);
          if (models.length) {
            return {
              models,
              endpoint: url,
              resolvedBaseUrl: resolveBaseFromEndpoint(url),
              attempts,
              matchedVariant: {
                presetId: alt.presetId || null,
                variantId: alt.variantId || null,
                label: alt.label || '',
                baseUrl: alt.baseUrl,
                protocol: altProtocol,
                wireApi: alt.wireApi || null,
              },
            };
          }
        }
      }
    }
  }

  const rateLimited = attempts.some((a) => a.status === 429);
  const notFound = attempts.length > 0 && attempts.every((a) => a.status === 404 || a.status === 405);
  let msg = `无法从该 URL 获取模型列表（已尝试 ${attempts.length} 个端点）`;
  if (rateLimited) {
    msg += '：上游供应商接口触发了频率限制 (429 Too Many Requests)，请稍等 5 秒后再试，或在下方直接手动输入模型 ID。';
  } else if (authFailed) {
    msg += '：API Key 无效或未授权，请检查 API Key 是否正确、是否有模型权限。';
    if (variantsTried) msg += `（已自动尝试该厂商的另外 ${variantsTried} 个端点，key 均被拒绝）`;
  } else if (notFound) {
    msg += '：这些地址都没有可用的 /models 接口，该服务可能未开放公开模型列表。您可在下方直接手动输入模型 ID 接入。';
  } else {
    const last = attempts[attempts.length - 1];
    if (last && last.error) msg += `：${last.error}`;
  }
  const err = new Error(msg);
  err.attempts = attempts;
  err.manualFallback = notFound || rateLimited;
  throw err;
}

// ---------- 推荐模型降噪 ----------

const SERIES_RULES = [
  [/deepseek/i, 'DeepSeek'],
  [/glm/i, 'GLM'],
  [/kimi|\bk2\b|\bk3\b/i, 'Kimi'],
  [/qwen/i, '通义千问'],
  [/minimax/i, 'MiniMax'],
  [/mimo/i, '小米'],
  [/claude/i, 'Claude'],
  [/gpt|\bo1\b|\bo3\b|\bo4\b|\bcodex/i, 'OpenAI'],
  [/gemini/i, 'Gemini'],
];

export function guessSeries(modelId) {
  for (const [re, name] of SERIES_RULES) {
    if (re.test(modelId)) return name;
  }
  return null;
}

/**
 * 生成「推荐」分组的模型列表：
 * 1. 预设里的常用模型（如阿里云的 DeepSeek / GLM / Kimi / 千问系列）
 * 2. 从抓取结果里按系列自动归类的热门模型
 */
export function buildRecommendations(fetched = [], preset = null) {
  const available = new Set(fetched.map((m) => m.id));
  const series = [];
  const seen = new Set();

  if (preset && Array.isArray(preset.recommended)) {
    for (const s of preset.recommended) {
      const items = (s.models || []).map((id) => ({ id, available: available.has(id) }));
      if (items.length) {
        series.push({ series: s.series, note: s.note || '', items });
        items.forEach((i) => seen.add(i.id));
      }
    }
  }

  const auto = new Map();
  for (const m of fetched) {
    if (seen.has(m.id)) continue;
    const name = guessSeries(m.id);
    if (!name) continue;
    if (!auto.has(name)) auto.set(name, []);
    auto.get(name).push({ id: m.id, available: true });
  }
  for (const [name, items] of auto) {
    series.push({ series: name, note: '自动发现', items });
  }
  return series;
}
