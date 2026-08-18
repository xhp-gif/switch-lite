import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { relayProviderUrl, isStrictHost } from './relay.js';
import { hermesConfigPath, applyHermes } from './hermesConfig.js';

function homeDir() {
  return process.env.CCS_HOME_OVERRIDE ? path.resolve(process.env.CCS_HOME_OVERRIDE) : os.homedir();
}

function targets() {
  const home = homeDir();
  return {
    claude: { label: 'Claude Code', file: path.join(home, '.claude', 'settings.json') },
    codex: { label: 'Codex CLI', file: path.join(home, '.codex', 'config.toml') },
    gemini: { label: 'Gemini CLI', file: path.join(home, '.gemini', 'settings.json') },
    opencode: { label: 'OpenCode', file: path.join(home, '.config', 'opencode', 'opencode.json') },
    hermes: { label: 'Hermes Agent', file: hermesConfigPath() },
  };
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${file}.bak-${stamp}`;
  fs.copyFileSync(file, bak);
  return bak;
}

function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  if (fs.existsSync(file)) fs.rmSync(file);
  fs.renameSync(tmp, file);
}

export function configStatus() {
  const out = {};
  for (const [key, t] of Object.entries(targets())) {
    const info = { file: t.file, exists: fs.existsSync(t.file), backups: [] };
    if (info.exists) {
      info.mtime = fs.statSync(t.file).mtime.toISOString();
      const dir = path.dirname(t.file);
      const base = path.basename(t.file);
      if (fs.existsSync(dir)) {
        info.backups = fs
          .readdirSync(dir)
          .filter((f) => f.startsWith(`${base}.bak-`))
          .sort()
          .reverse()
          .slice(0, 5)
          .map((f) => path.join(dir, f));
      }
    }
    out[key] = info;
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function tomlString(v) {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function providerKey(id) {
  return `csl_${String(id).replace(/[^a-zA-Z0-9_-]/g, '') || 'provider'}`;
}

function authHeaders(provider) {
  if (provider.protocol === 'anthropic') return [['x-api-key', provider.apiKey || '']];
  if (provider.protocol === 'gemini') return [['x-goog-api-key', provider.apiKey || '']];
  return [['Authorization', `Bearer ${provider.apiKey || ''}`]];
}

function buildCodexBlock(provider, modelId, wireApi, catalogName, authViaAuthFile) {
  // 固定使用 custom 作为 Codex 供应商 ID（与 CC Switch 一致）：
  // Codex 按 provider 分桶显示会话历史，固定 ID 才能让所有供应商的会话
  // 出现在同一个历史列表里。
  const key = 'custom';
  const lines = [
    `model = ${tomlString(modelId)}`,
    `model_provider = ${tomlString(key)}`,
    `model_catalog_json = ${tomlString(catalogName)}`,
    '',
    `[model_providers.${key}]`,
    `name = ${tomlString(provider.name)}`,
    // 经本地中继按供应商转发：剥离第三方网关不接受的 namespace/custom 工具，并计量 token 用量
    `base_url = ${tomlString(relayProviderUrl(provider.id))}`,
    `wire_api = ${tomlString(wireApi || 'chat')}`,
  ];
  if (authViaAuthFile) {
    // 桌面端/CLI 的鉴权层会优先使用 ~/.codex/auth.json 里的 OPENAI_API_KEY，
    // 与 CC Switch 的成熟做法保持一致：把供应商 key 写入 auth.json。
    lines.push(`requires_openai_auth = true`);
  } else {
    const headers = authHeaders(provider);
    if (headers.some(([, v]) => v)) {
      lines.push(`[model_providers.${key}.http_headers]`);
      for (const [name, value] of headers) lines.push(`${tomlString(name)} = ${tomlString(value)}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// 第三方 Responses 网关的兼容设置：关闭内置 web 搜索工具、关闭多智能体
// namespace 工具（前者会声明 type=web_search，后者会声明 type=namespace，
// 千帆/百炼等网关只接受 function/mcp/knowledge_search）。
function ensureCodexCompatSettings(text) {
  const lines = String(text).split(/\r?\n/);
  const featuresIdx = lines.findIndex((l) => l.trim() === '[features]');
  if (featuresIdx !== -1) {
    let end = featuresIdx + 1;
    while (end < lines.length && !/^\[/.test(lines[end].trim())) end++;
    const hasFlag = lines.slice(featuresIdx + 1, end).some((l) => /^multi_agent\s*=/.test(l.trim()));
    if (!hasFlag) lines.splice(featuresIdx + 1, 0, 'multi_agent = false');
  } else {
    const firstSub = lines.findIndex((l) => /^\[features\./.test(l.trim()));
    const insertAt = firstSub === -1 ? lines.length : firstSub;
    lines.splice(insertAt, 0, '[features]', 'multi_agent = false', '');
  }
  return lines.join('\n');
}

export function patchCodexToml(existing, block) {
  const srcLines = String(existing || '').split(/\r?\n/);
  const blockLines = String(block || '').split(/\r?\n/).map((l) => l.trimEnd());
  // 把新块拆成“顶层键”和“表格段”：顶层键必须放在所有表格之前，
  // 否则会被 TOML 解析成上一个表格的属性，导致配置失效。
  const firstTable = blockLines.findIndex((l) => l.trim().startsWith('['));
  const headKeys = firstTable === -1 ? blockLines : blockLines.slice(0, firstTable);
  const bodyTables = firstTable === -1 ? [] : blockLines.slice(firstTable);

  const out = [];
  let currentSection = null;
  let skipping = false;

  for (const line of srcLines) {
    const trimmed = line.trim();
    if (skipping) {
      if (/^\[/.test(trimmed)) skipping = false;
      else continue;
    }
    if (
      /^\[model_providers\.(csl_|custom)/.test(trimmed) ||
      /^\[mcp_servers\]/.test(trimmed) ||
      /^\[mcp_servers\./.test(trimmed)
    ) {
      skipping = true;
      currentSection = null;
      continue;
    }
    if (/^\[/.test(trimmed)) {
      currentSection = trimmed;
      out.push(line);
      continue;
    }
    // 顶层 model / model_provider 由我们管理，删除旧值避免 TOML 重复键
    if (
      currentSection === null &&
      (/^model\s*=/.test(trimmed) ||
        /^model_provider\s*=/.test(trimmed) ||
        /^model_catalog_json\s*=/.test(trimmed) ||
        /^web_search\s*=/.test(trimmed))
    ) {
      continue;
    }
    out.push(line);
  }

  if (!headKeys.some((l) => /^web_search\s*=/.test(l.trim()))) {
    headKeys.push('web_search = "disabled"');
  }
  while (out.length && out[0].trim() === '') out.shift();
  while (out.length && out[out.length - 1].trim() === '') out.pop();

  const parts = [];
  if (headKeys.length) parts.push(headKeys.join('\n').trim());
  if (out.length) parts.push(out.join('\n'));
  if (bodyTables.length) parts.push(bodyTables.join('\n').trim());
  return ensureCodexCompatSettings(parts.join('\n\n') + '\n');
}

function applyClaude(provider, modelId) {
  const settings = readJson(targets().claude.file);
  settings.env = settings.env || {};
  // 经本地中继转发（按供应商注入 key 并计量用量，若为非 Anthropic 协议则由本地中继自动进行 Anthropic ↔ OpenAI 协议转译）；
  // AUTH_TOKEN 仍需写入，Claude Code 要求它非空才会发请求，中继会用真实 key 覆盖它。
  settings.env.ANTHROPIC_BASE_URL = relayProviderUrl(provider.id);
  settings.env.ANTHROPIC_AUTH_TOKEN = provider.apiKey || 'sk-switch-lite';
  settings.env.ANTHROPIC_MODEL = modelId;
  delete settings.model; // 顶层 model 会触发 Claude Code 客户端对官方模型名的硬编码白名单校验，由 env.ANTHROPIC_* 接管
  // 模型路由：Claude Code 内部按 Opus/Sonnet/Haiku 三档发请求，
  // 第三方厂商没有这些模型名，需映射到该厂商实际模型。
  // 为确保稳定性，默认所有档位（Sonnet / Opus / Haiku）均统一指向用户选择的主模型 modelId，
  // 并同步对齐显示名称 (*_MODEL_NAME)，清理历史残留的 FABLE 键，避免 Claude 扩展下拉显示旧名称。
  settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = modelId;
  settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME = modelId;
  settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = modelId;
  settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = modelId;
  settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = modelId;
  settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME = modelId;
  delete settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL;
  delete settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME;
  delete settings.env.ANTHROPIC_SMALL_FAST_MODEL; // 旧键归一化为 DEFAULT_*
  fs.writeFileSync(targets().claude.file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function buildCatalogEntry(modelId) {
  return {
    slug: modelId,
    display_name: modelId,
    description: `Configured via SwitchLite: ${modelId}`,
    context_window: 200000,
    max_context_window: 200000,
    effective_context_window_percent: 95,
    base_instructions: `You are Codex, a coding agent powered by ${modelId}. You and the user share the same workspace and collaborate to achieve the user's goals.`,
    supported_reasoning_levels: [
      { effort: 'low', description: 'Fast responses with lighter reasoning' },
      { effort: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
      { effort: 'high', description: 'Greater reasoning depth for complex problems' },
    ],
    default_reasoning_level: 'medium',
    shell_type: 'shell_command',
    visibility: 'list',
    supported_in_api: true,
    priority: 5,
    support_verbosity: false,
    supports_reasoning_summaries: false,
    default_reasoning_summary: 'none',
    use_responses_lite: false,
    include_skills_usage_instructions: true,
    prefer_websockets: false,
    supports_search_tool: false,
    // 注意：不声明 apply_patch_tool_type（freeform 会发布 type=custom 工具，
    // 而当前 Codex 构建也不接受 function 变体，多数第三方网关拒绝 custom）
    supports_image_detail_original: false,
    supports_parallel_tool_calls: true,
    experimental_supported_tools: [],
    input_modalities: ['text'],
    truncation_policy: { mode: 'tokens', limit: 10000 },
  };
}

/**
 * 写入 SwitchLite 自己的模型目录，并尽量继承已有目录（如 cc-switch 的），
 * 保证 Codex 模型列表里之前配置过的模型不会消失。
 */
function writeCodexCatalog(provider, modelId) {
  const codexDir = path.join(homeDir(), '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  const catalogFile = path.join(codexDir, 'switch-lite-model-catalog.json');
  const ccSwitchCatalog = path.join(codexDir, 'cc-switch-model-catalog.json');
  const strict = isStrictHost(provider.baseUrl);
  let models = [];
  try {
    if (fs.existsSync(ccSwitchCatalog)) {
      const base = JSON.parse(fs.readFileSync(ccSwitchCatalog, 'utf8'));
      if (Array.isArray(base.models)) {
        models = base.models.filter((m) => m && m.slug).map((m) => ({ ...m }));
      }
    }
  } catch {
    /* 继承失败就只用内置模板 */
  }
  if (!models.some((m) => m.slug === modelId)) {
    // 新模型使用干净的最小卡片，不复用其他模型卡的 comp_hash / base_instructions 等专属字段
    models.push(buildCatalogEntry(modelId));
  }
  if (strict) {
    // 严格网关（千帆等）只接受 function/mcp/knowledge_search 工具：
    // 清理继承卡片里会触发 custom 工具的字段，并关闭 verbosity
    for (const m of models) {
      delete m.apply_patch_tool_type;
      delete m.web_search_tool_type;
      delete m.tools;
      delete m.model_messages;
      m.support_verbosity = false;
      delete m.default_verbosity;
    }
  }
  writeFileAtomic(catalogFile, JSON.stringify({ models }, null, 2) + '\n');
  return 'switch-lite-model-catalog.json';
}

function liteHome() {
  return process.env.CCS_LITE_HOME ? path.resolve(process.env.CCS_LITE_HOME) : path.join(os.homedir(), '.cc-switch-lite');
}

function writeRelayConf(provider) {
  const dir = liteHome();
  fs.mkdirSync(dir, { recursive: true });
  let origin = provider.baseUrl || '';
  try {
    origin = new URL(provider.baseUrl).origin;
  } catch {
    /* 保留原值 */
  }
  writeFileAtomic(
    path.join(dir, 'relay.json'),
    JSON.stringify({ upstream: origin, apiKey: provider.apiKey || '' }, null, 2) + '\n',
  );
}

function applyCodex(provider, modelId) {
  const catalogName = writeCodexCatalog(provider, modelId);
  writeRelayConf(provider);
  // 当前 Codex CLI 已移除 chat 协议，自定义供应商只能用 responses
  const block = buildCodexBlock(provider, modelId, 'responses', catalogName, true);
  const file = targets().codex.file;
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  writeFileAtomic(file, patchCodexToml(existing, block));
  writeCodexAuth(provider);
}

// Codex 的鉴权层读取 ~/.codex/auth.json 的 OPENAI_API_KEY（与 CC Switch 行为一致）。
// 切换供应商时把该供应商的 key 写入，并备份原文件以便恢复。
function writeCodexAuth(provider) {
  const authFile = path.join(homeDir(), '.codex', 'auth.json');
  if (fs.existsSync(authFile)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(authFile, `${authFile}.bak-${stamp}`);
  }
  writeFileAtomic(authFile, JSON.stringify({ OPENAI_API_KEY: provider.apiKey || '' }, null, 2) + '\n');
}

function applyGemini(provider, modelId) {
  if (provider.protocol !== 'gemini') {
    throw new Error('Gemini CLI 仅支持 Gemini 协议的供应商（如 Google Gemini 官方或兼容网关），当前供应商协议不匹配。');
  }
  const settings = readJson(targets().gemini.file);
  settings.model = modelId;
  settings.env = settings.env || {};
  if (provider.apiKey) settings.env.GEMINI_API_KEY = provider.apiKey;
  // 经本地中继转发（按供应商注入 x-goog-api-key 并计量用量）
  settings.env.GOOGLE_GEMINI_BASE_URL = relayProviderUrl(provider.id);
  fs.writeFileSync(targets().gemini.file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function npmPackageFor(protocol) {
  if (protocol === 'anthropic') return '@ai-sdk/anthropic';
  if (protocol === 'gemini') return '@ai-sdk/google';
  return '@ai-sdk/openai-compatible';
}

function opencodeProviderKey(provider) {
  const raw = provider.presetId && provider.presetId !== 'custom' ? provider.presetId : provider.name;
  const slug = String(raw || 'provider')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'provider';
}

function applyOpenCode(provider, modelId) {
  const file = targets().opencode.file;
  const config = readJson(file);
  const key = opencodeProviderKey(provider);
  const existingProvider = config.provider?.[key] || {};
  const existingModels = existingProvider.models || {};
  config.provider = config.provider || {};
  config.provider[key] = {
    ...existingProvider,
    npm: npmPackageFor(provider.protocol),
    name: provider.name,
    options: {
      // 经本地中继转发（按供应商注入鉴权并计量用量）
      baseURL: relayProviderUrl(provider.id),
      apiKey: provider.apiKey || '',
    },
    models: {
      ...existingModels,
      [modelId]: { name: modelId },
    },
  };
  config.model = `${key}/${modelId}`;
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// 各目标在切换时会触碰的文件（用于失败回滚快照）
function touchedFiles(target) {
  const home = homeDir();
  const t = targets()[target];
  if (target === 'codex') {
    return [
      t.file,
      path.join(home, '.codex', 'auth.json'),
      path.join(home, '.codex', 'switch-lite-model-catalog.json'),
      path.join(liteHome(), 'relay.json'),
    ];
  }
  return [t.file];
}

function snapshotFiles(files) {
  return files.map((file) => {
    if (!fs.existsSync(file)) return { file, existed: false, content: null };
    try {
      return { file, existed: true, content: fs.readFileSync(file, 'utf8') };
    } catch {
      return { file, existed: true, content: null, unreadable: true }; // 目录/权限异常：还原时跳过
    }
  });
}

function restoreSnapshots(snaps) {
  for (const s of snaps) {
    try {
      if (s.unreadable) continue;
      if (s.existed) writeFileAtomic(s.file, s.content);
      else if (fs.existsSync(s.file)) fs.rmSync(s.file);
    } catch {
      /* 还原本身失败则保留现状，磁盘上还有 .bak- 备份 */
    }
  }
}

export function applyConfig({ target, provider, modelId }) {
  const t = targets()[target];
  if (!t) throw new Error(`未知目标应用: ${target}`);
  if (!provider.baseUrl) throw new Error('请先填写 Base URL');
  if (!modelId) throw new Error('请先选择一个模型');
  fs.mkdirSync(path.dirname(t.file), { recursive: true });
  const bak = backup(t.file);
  // 事务式写入：任一文件写失败，自动还原全部已改文件，避免“半新半旧”导致 Agent 瘫痪
  const snaps = snapshotFiles(touchedFiles(target));
  let catalogFile = null;
  try {
    if (target === 'claude') applyClaude(provider, modelId);
    else if (target === 'codex') {
      applyCodex(provider, modelId);
      catalogFile = 'switch-lite-model-catalog.json';
    }
    else if (target === 'gemini') applyGemini(provider, modelId);
    else if (target === 'opencode') applyOpenCode(provider, modelId);
    else if (target === 'hermes') applyHermes(provider, modelId);
  } catch (err) {
    restoreSnapshots(snaps);
    const e = new Error(`${err.message}（配置已自动还原，未产生半成品改动）`);
    e.cause = err;
    throw e;
  }
  return { target, file: t.file, backup: bak, model: modelId, catalogFile };
}
