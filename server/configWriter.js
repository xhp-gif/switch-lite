import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { relayProviderUrl, isStrictHost } from './relay.js';
import YAML from 'yaml';
import { hermesConfigPath, applyHermes } from './hermesConfig.js';
import { getCustomAgents } from './storage.js';

function homeDir() {
  return process.env.CCS_HOME_OVERRIDE ? path.resolve(process.env.CCS_HOME_OVERRIDE) : os.homedir();
}


// DeepSeek Harness 的 profile patch 层 (~/.dsh/profiles/web/cordis.patch.yml):
// DSH 启动时把每个 bundle 层 + 该 profile 的 cordis.patch.yml 叠成最终配置树，
// settings.yaml 的实时写入 (dsh-settings-file 的整文档重写) 无法删掉这里的键。
// 把模型目录与默认模型写进这一层后，即使 DSH 自己的进程/设置页把 settings.yaml
// 重写回不含 models 的旧快照，DSH 重启后模型选择器依然能看到带日期快照后缀的模型。
function writeDshProfilePatch(providers, activeProviderKey, activeModelId) {
  const home = homeDir();
  const profileDir = path.join(home, '.dsh', 'profiles', 'web');
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  fs.mkdirSync(profileDir, { recursive: true });

  // 读取现有 patch 层并保留用户自己添加的其它条目。
  let existing = [];
  if (fs.existsSync(patchFile)) {
    try {
      const parsed = YAML.parse(fs.readFileSync(patchFile, 'utf8'));
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      /* 解析失败则从空数组重建 */
    }
  }

  const keep = existing.filter((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
    const id = row.id;
    return id !== 'llm-deepseek' && id !== 'llm-pi-ai' && id !== 'agent-default-model';
  });

  const patch = [
    ...keep,
    {
      id: 'llm-deepseek',
      name: '@deepseek-ai/dsh-llm-deepseek',
      disabled: true,
    },
    {
      id: 'llm-pi-ai',
      name: '@deepseek-ai/dsh-llm-pi-ai',
      config: {
        providers,
      },
    },
    {
      id: 'agent-default-model',
      name: '@deepseek-ai/dsh-agent-default-model',
      config: {
        provider: activeProviderKey,
        model: activeModelId,
      },
    },
  ];

  const header = [
    '# Your patch layer for this dsh profile, applied after every bundle layer:',
    '# a top-level YAML array of loader patch entries (id-targeted config',
    '# overrides, disables, and insert lists; `!!js` expressions allowed).',
    '# llm-pi-ai / agent-default-model rows below are maintained by SwitchLite.',
    '',
  ].join('\n');
  writeFileAtomic(patchFile, header + YAML.stringify(patch) + '\n');
}

export function targets() {
  const home = homeDir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const cursorFile =
    process.platform === 'win32'
      ? path.join(appData, 'Cursor', 'User', 'settings.json')
      : path.join(home, '.cursor', 'settings.json');

  const baseTargets = {
    claude: { label: 'Claude Code', file: path.join(home, '.claude', 'settings.json') },
    codex: { label: 'Codex CLI', file: path.join(home, '.codex', 'config.toml') },
    gemini: { label: 'Gemini CLI', file: path.join(home, '.gemini', 'settings.json') },
    opencode: { label: 'OpenCode', file: path.join(home, '.config', 'opencode', 'opencode.json') },
    hermes: { label: 'Hermes Agent', file: hermesConfigPath() },
    cursor: { label: 'Cursor', file: cursorFile },
    grok: { label: 'Grok CLI', file: path.join(home, '.grok', 'config.json') },
    deepseek_harness: { label: 'DeepSeek Harness', file: path.join(home, '.dsh', 'settings.yaml') },
    tare: { label: 'Tare CLI', file: path.join(home, '.tare', 'config.json') },
    qcoder: { label: 'QCoder', file: path.join(home, '.qcoder', 'settings.json') },
    zcode: { label: 'ZCode', file: path.join(home, '.zcode', 'config.json') },
  };

  try {
    const custom = getCustomAgents();
    for (const c of custom) {
      if (c && c.id && c.configFile) {
        let resolved = c.configFile.trim();
        if (resolved.startsWith('~')) {
          resolved = path.join(home, resolved.slice(1).replace(/^[/\\]/, ''));
        } else if (resolved.includes('%')) {
          resolved = resolved.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
        } else {
          resolved = path.resolve(resolved);
        }
        baseTargets[c.id] = {
          label: c.name || c.id,
          file: resolved,
          custom: true,
          format: c.format || 'json',
        };
      }
    }
  } catch {
    /* 自定义 Agent 解析失败静默 */
  }

  return baseTargets;
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${file}.bak-${stamp}`;
  fs.copyFileSync(file, bak);
  pruneBackups(file);
  return bak;
}

// 每个文件只保留最近 KEEP 份 .bak-*，避免长期切换无限累积
const BACKUP_KEEP = 5;
function pruneBackups(file) {
  try {
    const dir = path.dirname(file);
    const base = path.basename(file);
    const baks = fs.readdirSync(dir).filter((f) => f.startsWith(`${base}.bak-`)).sort(); // ISO 戳字典序即时间序
    for (const old of baks.slice(0, -BACKUP_KEEP)) fs.rmSync(path.join(dir, old));
  } catch {
    /* 清理失败不影响主流程 */
  }
}

function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    if (process.platform === 'win32') {
      try {
        fs.writeFileSync(file, content, 'utf8');
        try { fs.unlinkSync(tmp); } catch {}
        return;
      } catch {}
    }
    throw err;
  }
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
      /^\[model_providers\.(csl_|custom)/.test(trimmed)
    ) {
      // 只跳过我们自己管理的 model_providers 段；
      // [mcp_servers] 是用户自己配的 MCP 服务器，必须保留——
      // 严格网关的工具兼容已由中继在网络层处理（stripUnsupportedTools），
      // 在配置文件里删掉会直接弄丢用户的 MCP 配置。
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

function buildCatalogEntry(modelId, providerDisplayName) {
  const label = providerDisplayName ? `${providerDisplayName} / ${modelId}` : modelId;
  return {
    slug: modelId,
    display_name: label,
    description: `Configured via SwitchLite: ${label}`,
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
    supports_image_detail_original: true,
    supports_parallel_tool_calls: true,
    experimental_supported_tools: [],
    input_modalities: ['text', 'image'],
    truncation_policy: { mode: 'tokens', limit: 10000 },
  };
}

/**
 * 写入 SwitchLite 自己的模型目录，并尽量继承已有目录（如 cc-switch 的），
 * 保证 Codex 模型列表里之前配置过的模型不会消失，并标注对应的供应商名称。
 */
function writeCodexCatalog(provider, modelId) {
  const codexDir = path.join(homeDir(), '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  const catalogFile = path.join(codexDir, 'switch-lite-model-catalog.json');
  const ccSwitchCatalog = path.join(codexDir, 'cc-switch-model-catalog.json');
  const strict = isStrictHost(provider.baseUrl);
  let models = [];
  const inheritFrom = fs.existsSync(catalogFile) ? catalogFile : ccSwitchCatalog;
  try {
    if (fs.existsSync(inheritFrom)) {
      const base = JSON.parse(fs.readFileSync(inheritFrom, 'utf8'));
      if (Array.isArray(base.models)) {
        models = base.models.filter((m) => m && m.slug).map((m) => ({ ...m }));
      }
    }
  } catch {
    /* 继承失败就只用内置模板 */
  }

  const displayName = dshProviderDisplayName(provider);
  let entry = models.find((m) => m.slug === modelId);
  if (!entry) {
    entry = buildCatalogEntry(modelId, displayName);
    models.push(entry);
  } else {
    entry.display_name = `${displayName} / ${modelId}`;
    entry.description = `Configured via SwitchLite: ${displayName} / ${modelId}`;
  }

  // 让当前应用的模型成为目录默认项（priority=1 且排到列表最前）：
  for (const m of models) {
    if (m.slug === modelId) m.priority = 1;
    else if (typeof m.priority !== 'number' || m.priority < 2) m.priority = 2;
    // 启用多模态图片输入支持
    if (!Array.isArray(m.input_modalities) || !m.input_modalities.includes('image')) {
      m.input_modalities = ['text', 'image'];
    }
    m.supports_image_detail_original = true;
  }
  models.sort((a, b) => (a.slug === modelId ? -1 : b.slug === modelId ? 1 : 0));

  if (strict) {
    // 严格网关（千帆等）只接受 function/mcp/knowledge_search 工具：
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
// 切换供应商时合并写入该字段：保留文件里的其他内容（如 ChatGPT OAuth 登录态），
// 整体覆盖会把用户的 OpenAI 登录清掉。写入前仍做备份以便恢复。
function writeCodexAuth(provider) {
  const authFile = path.join(homeDir(), '.codex', 'auth.json');
  backup(authFile);
  let auth = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) auth = parsed;
  } catch {
    /* 文件不存在或损坏则从空对象开始 */
  }
  auth.OPENAI_API_KEY = provider.apiKey || '';
  writeFileAtomic(authFile, JSON.stringify(auth, null, 2) + '\n');
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
  if (target === 'deepseek_harness') {
    return [
      t.file,
      path.join(home, '.dsh', 'settings.yaml'),
      path.join(home, '.dsh', '.credentials.yaml'),
      path.join(home, '.dsh', 'profiles', 'web', 'cordis.patch.yml'),
      path.join(home, '.deepseek', 'harness.json'),
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

let DatabaseSync = null;
try {
  const mod = await import('node:sqlite');
  DatabaseSync = mod.DatabaseSync;
} catch {}

function syncCursorStateDb(provider, modelId) {
  if (!DatabaseSync || process.env.NODE_ENV === 'test' || process.env.CCS_HOME_OVERRIDE) return;
  try {
    const home = homeDir();
    let dbPath = null;
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      dbPath = path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    } else if (process.platform === 'darwin') {
      dbPath = path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    } else {
      dbPath = path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    }

    if (!fs.existsSync(dbPath)) return;

    const db = new DatabaseSync(dbPath);
    const rowKey = 'src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser';
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(rowKey);
    if (!row || !row.value) {
      db.close();
      return;
    }

    const data = JSON.parse(row.value);
    const relayUrl = relayProviderUrl(provider.id);
    data.openAIBaseUrl = relayUrl;

    // 注入模型到 availableDefaultModels2
    const displayName = dshProviderDisplayName(provider);
    data.availableDefaultModels2 = data.availableDefaultModels2 || [];
    const existing = data.availableDefaultModels2.find((m) => m && m.name === modelId);
    if (!existing) {
      data.availableDefaultModels2.push({
        name: modelId,
        defaultOn: true,
        parameterDefinitions: [],
        variants: [
          {
            parameterValues: [],
            displayName: `${displayName} / ${modelId}`,
            isMaxMode: false,
            isDefaultMaxConfig: true,
            isDefaultNonMaxConfig: true,
            displayNameOutsidePicker: `${displayName} / ${modelId}`,
            variantStringRepresentation: `${modelId}[]`,
            legacySlug: modelId,
          },
        ],
        legacySlugs: [],
        idAliases: [],
        cloudAgentEffortModes: [],
        modelPickerBadges: [],
        supportsAgent: true,
        degradationStatus: 0,
        supportsThinking: true,
        supportsImages: true,
        supportsMaxMode: true,
        contextTokenLimit: 128000,
        contextTokenLimitForMaxMode: 128000,
        clientDisplayName: `${displayName} / ${modelId}`,
        serverModelName: modelId,
        supportsNonMaxMode: true,
        isRecommendedForBackgroundComposer: false,
        supportsPlanMode: true,
        inputboxShortModelName: modelId,
        supportsSandboxing: true,
        namedModelSectionIndex: 1,
        vendorName: 'custom',
        vendor: { id: 99, displayName: displayName || 'Custom' },
      });
    } else {
      existing.clientDisplayName = `${displayName} / ${modelId}`;
      if (existing.variants && existing.variants[0]) {
        existing.variants[0].displayName = `${displayName} / ${modelId}`;
        existing.variants[0].displayNameOutsidePicker = `${displayName} / ${modelId}`;
      }
    }

    // 启用该模型
    data.aiSettings = data.aiSettings || {};
    const enabledSet = new Set(data.aiSettings.modelOverrideEnabled || []);
    enabledSet.add(modelId);
    data.aiSettings.modelOverrideEnabled = Array.from(enabledSet);

    if (data.featureModelConfigs) {
      if (data.featureModelConfigs.composer) data.featureModelConfigs.composer.defaultModel = modelId;
      if (data.featureModelConfigs.cmdK) data.featureModelConfigs.cmdK.defaultModel = modelId;
    }

    db.prepare('UPDATE ItemTable SET value = ? WHERE key = ?').run(JSON.stringify(data), rowKey);
    db.close();
  } catch {
    /* 数据库被独占锁定时静默跳过 */
  }
}

export function applyCursor(provider, modelId) {
  const file = targets().cursor.file;
  const current = readJson(file);
  current['cursor.models'] = Array.from(new Set([modelId, ...(current['cursor.models'] || [])]));
  current['cursor.currentModel'] = modelId;
  current['cursor.openaiBaseUrl'] = relayProviderUrl(provider.id);
  current['cursor.openaiApiKey'] = provider.apiKey || 'sk-switchlite';
  current['openai.baseUrl'] = relayProviderUrl(provider.id);
  current['openai.apiKey'] = provider.apiKey || 'sk-switchlite';
  current['openai.model'] = modelId;
  writeFileAtomic(file, JSON.stringify(current, null, 2) + '\n');
  syncCursorStateDb(provider, modelId);
}

export function applyGrok(provider, modelId) {
  const file = targets().grok.file;
  const current = readJson(file);
  current.api_base = relayProviderUrl(provider.id);
  current.api_key = provider.apiKey || 'sk-switchlite';
  current.model = modelId;
  current.provider = provider.name;
  writeFileAtomic(file, JSON.stringify(current, null, 2) + '\n');
}

export function dshProviderDisplayName(provider) {
  const name = String(provider.name || '').trim();
  if (name && !name.includes('://') && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name) && !name.startsWith('http')) {
    return name;
  }
  const baseUrl = String(provider.baseUrl || '').toLowerCase();
  if (baseUrl.includes('sensenova.cn')) return '商汤日日新';
  if (baseUrl.includes('qianfan.baidubce.com')) return '百度千帆';
  if (baseUrl.includes('dashscope.aliyuncs.com')) return '阿里云百炼';
  if (baseUrl.includes('deepseek.com')) return 'DeepSeek 官方';
  if (baseUrl.includes('bigmodel.cn')) return '智谱 GLM';
  if (baseUrl.includes('moonshot.cn')) return 'Moonshot Kimi';
  if (baseUrl.includes('siliconflow.cn')) return '硅基流动';
  if (baseUrl.includes('volces.com')) return '火山方舟';
  if (baseUrl.includes('minimaxi.com')) return 'MiniMax';
  if (baseUrl.includes('x.ai')) return 'xAI Grok';
  if (baseUrl.includes('anthropic.com')) return 'Anthropic';
  if (baseUrl.includes('googleapis.com')) return 'Google Gemini';
  return name || '自定义供应商';
}

export function dshProviderKey(provider) {
  const displayName = dshProviderDisplayName(provider);
  let raw = provider.presetId && provider.presetId !== 'custom' ? provider.presetId : displayName;
  if (displayName === '商汤日日新' || displayName.includes('商汤')) raw = 'sensenova';
  else if (displayName === '百度千帆' || displayName.includes('千帆')) raw = 'baidu';
  else if (displayName === '阿里云百炼' || displayName.includes('阿里') || displayName.includes('百炼')) raw = 'aliyun';
  else if (displayName === 'DeepSeek 官方' || displayName.includes('DeepSeek')) raw = 'deepseek';
  else if (displayName === '智谱 GLM' || displayName.includes('智谱') || displayName.includes('GLM')) raw = 'zhipu';
  else if (displayName === 'Moonshot Kimi' || displayName.includes('Kimi')) raw = 'moonshot';
  else if (displayName === '硅基流动') raw = 'siliconflow';
  else if (displayName === '火山方舟' || displayName.includes('火山')) raw = 'volcengine';
  else if (displayName === 'MiniMax') raw = 'minimax';
  else if (displayName === 'xAI Grok' || displayName.includes('Grok')) raw = 'xai';
  else if (displayName === 'Anthropic' || displayName.includes('Claude')) raw = 'anthropic';
  else if (displayName === 'Google Gemini' || displayName.includes('Gemini')) raw = 'gemini';

  const slug = String(raw || 'provider')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  const key = slug || String(provider.id || 'p').replace(/[^a-z0-9]/gi, '').slice(0, 8);
  return `csl_${key}`;
}

async function tryDshRpc(provider, modelId, providerKey, credKey) {
  if (process.env.CCS_HOME_OVERRIDE || process.env.NODE_ENV === 'test') {
    return;
  }
  const directApiKey = provider.apiKey || '';
  const ports = [3080, 52331];

  for (const port of ports) {
    const credsUrl = `http://127.0.0.1:${port}/api/credentials.set`;
    const settingsUrl = `http://127.0.0.1:${port}/api/settings.update`;

    const credsPayload1 = {
      type: 'client-request',
      rpcId: `switchlite-creds-ds-${Date.now()}`,
      method: 'credentials.set',
      payload: {
        ref: 'DEEPSEEK_API_KEY',
        value: directApiKey,
      },
    };
    const credsPayload2 = {
      type: 'client-request',
      rpcId: `switchlite-creds-oa-${Date.now()}`,
      method: 'credentials.set',
      payload: {
        ref: 'OPENAI_API_KEY',
        value: directApiKey,
      },
    };
    const settingsPayload = {
      type: 'client-request',
      rpcId: `switchlite-settings-${Date.now()}`,
      method: 'settings.update',
      payload: {
        ns: 'agent-default-model',
        patch: {
          provider: providerKey,
          model: modelId,
        },
      },
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 600);
      await Promise.all([
        fetch(credsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credsPayload1),
          signal: controller.signal,
        }).catch(() => null),
        fetch(credsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credsPayload2),
          signal: controller.signal,
        }).catch(() => null),
        fetch(settingsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settingsPayload),
          signal: controller.signal,
        }).catch(() => null),
      ]);
      clearTimeout(timer);
    } catch {
      /* 静默重试其他端口 */
    }
  }
}

export function applyDeepSeekHarness(provider, modelId) {
  const home = homeDir();
  const dshDir = path.join(home, '.dsh');
  const dshSettingsFile = path.join(dshDir, 'settings.yaml');
  const dshCredentialsFile = path.join(dshDir, '.credentials.yaml');
  const legacyHarnessFile = path.join(home, '.deepseek', 'harness.json');

  fs.mkdirSync(dshDir, { recursive: true });

  const relayBaseUrl = provider.id ? relayProviderUrl(provider.id) : (provider.baseUrl || '');
  const directBaseUrl = provider.baseUrl || '';
  const directApiKey = provider.apiKey || '';
  const displayName = dshProviderDisplayName(provider);
  const providerKey = dshProviderKey(provider);
  const credKey = 'DEEPSEEK_API_KEY';

  // 读取现有 settings.yaml
  let doc = {};
  if (fs.existsSync(dshSettingsFile)) {
    try {
      doc = YAML.parse(fs.readFileSync(dshSettingsFile, 'utf8')) || {};
    } catch {
      /* 解析失败则从空对象重建 */
    }
  }

  // 1. 初始化 / 继承已有的 llm-pi-ai.providers 字典（类似 OpenCode 多 Provider 架构）
  const existingProviders = doc['llm-pi-ai']?.providers || {};
  const currentProviderEntry = existingProviders[providerKey] || {};
  const existingModels = Array.isArray(currentProviderEntry.models) ? currentProviderEntry.models : [];

  const CHAT_CHANNELS = new Set(['chat', 'completions', 'llm', 'chat-completions', 'text']);
  const NON_CHAT_HINTS = [
    /embed/i, /bge/i, /vector/i, /retriev/i, /rerank/i,
    /ocr/i, /vision/i, /image/i, /pic/i, /draw/i, /art/i, /tts/i, /asr/i, /whisper/i,
    /^pp-/i, /structure/i, /segment/i, /layout/i, /detect/i, /caption/i, /naming/i,
  ];
  const isChatModel = (m) => {
    if (!m || !m.id) return false;
    const id = String(m.id);
    const obj = m;
    if (typeof obj.channel === 'string' && obj.channel.trim()) {
      return CHAT_CHANNELS.has(obj.channel.trim().toLowerCase());
    }
    if (typeof obj.type === 'string' && obj.type.trim()) {
      const t = obj.type.trim().toLowerCase();
      if (t === 'chat' || t === 'llm' || t === 'completions') return true;
      if (t === 'embedding' || t === 'image' || t === 'ocr' || t === 'rerank' || t === 'tts' || t === 'asr') return false;
    }
    return !NON_CHAT_HINTS.some((re) => re.test(id));
  };

  const baseCatalogId = String(modelId).replace(/-\d{4,}$/, '');
  const providerModels = Array.isArray(provider.models) ? provider.models : [];
  const providerChatModels = providerModels.filter(isChatModel);

  const models = [...existingModels];
  const pushModel = (id) => {
    if (!id || models.some((m) => m && m.id === id)) return;
    const known = providerModels.find((m) => m && m.id === id);
    models.push({
      id,
      name: (known && known.name) || id,
      contextWindow: (known && known.contextWindow) || 128000,
      maxTokens: (known && known.maxTokens) || 8192,
      input: ['text'],
    });
  };

  // 1) 增量追加本次用户选中的模型（及其快照基础名）
  pushModel(modelId);
  if (baseCatalogId !== String(modelId)) pushModel(baseCatalogId);

  // 2) 调整顺序：将当前选中的模型排在第一位
  models.sort((a, b) => (a.id === modelId ? -1 : b.id === modelId ? 1 : 0));

  const updatedProviders = {
    ...existingProviders,
    [providerKey]: {
      displayName,
      apiKeyEnv: credKey,
      api: 'openai-completions',
      baseURL: relayBaseUrl,
      models,
    },
  };

  const settingsObj = {
    'agent-default-model': {
      provider: providerKey,
      model: modelId,
      reasoningEffort: 'high',
    },
    'llm-pi-ai': {
      providers: updatedProviders,
    },
    llm: {
      baseUrl: relayBaseUrl,
      base_url: relayBaseUrl,
      model: modelId,
    },
    baseUrl: relayBaseUrl,
    base_url: relayBaseUrl,
    defaultModel: modelId,
    model: modelId,
    provider: displayName,
    updated_at: new Date().toISOString(),
  };

  // 清除旧的单通道 llm-deepseek 命名空间
  delete doc['llm-deepseek'];

  const mergedDoc = { ...doc, ...settingsObj };
  writeFileAtomic(dshSettingsFile, YAML.stringify(mergedDoc) + '\n');

  // 2. 写 profile patch 层 (持久层保留所有厂商分支)
  writeDshProfilePatch(updatedProviders, providerKey, modelId);

  // 3. 写入 ~/.dsh/.credentials.yaml (注入全套标准 Key 变量)
  let credsDoc = { version: 1, refs: {} };
  if (fs.existsSync(dshCredentialsFile)) {
    try {
      const parsed = YAML.parse(fs.readFileSync(dshCredentialsFile, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        credsDoc = { ...parsed, refs: parsed.refs || {} };
      }
    } catch {}
  }
  credsDoc.refs = credsDoc.refs || {};
  credsDoc.refs.DEEPSEEK_API_KEY = directApiKey || 'sk-switchlite';
  credsDoc.refs.OPENAI_API_KEY = directApiKey || 'sk-switchlite';
  credsDoc.refs.API_KEY = directApiKey || 'sk-switchlite';
  writeFileAtomic(dshCredentialsFile, YAML.stringify(credsDoc) + '\n');

  // 4. 兼容写入旧版 ~/.deepseek/harness.json
  try {
    fs.mkdirSync(path.dirname(legacyHarnessFile), { recursive: true });
    const current = readJson(legacyHarnessFile);
    current.base_url = directBaseUrl;
    current.api_key = directApiKey;
    current.model = modelId;
    current.provider_name = displayName;
    current.updated_at = new Date().toISOString();
    writeFileAtomic(legacyHarnessFile, JSON.stringify(current, null, 2) + '\n');
  } catch {
    /* 兼容写入静默 */
  }

  // 5. 若 dsh 正在后台运行，尝试通过 RPC 立即通知热生效
  tryDshRpc(provider, modelId, providerKey, credKey).catch(() => {});
}

export function applyTare(provider, modelId) {
  const file = targets().tare.file;
  const current = readJson(file);
  current.endpoint = relayProviderUrl(provider.id);
  current.apiKey = provider.apiKey || 'sk-switchlite';
  current.model = modelId;
  current.active = true;
  writeFileAtomic(file, JSON.stringify(current, null, 2) + '\n');
}

export function applyQCoder(provider, modelId) {
  const file = targets().qcoder.file;
  const current = readJson(file);
  current.openai_base_url = relayProviderUrl(provider.id);
  current.openai_api_key = provider.apiKey || 'sk-switchlite';
  current.default_model = modelId;
  current.provider = provider.name;
  writeFileAtomic(file, JSON.stringify(current, null, 2) + '\n');
}

export function applyZCode(provider, modelId) {
  const file = targets().zcode.file;
  const current = readJson(file);
  current.baseUrl = relayProviderUrl(provider.id);
  current.apiKey = provider.apiKey || 'sk-switchlite';
  current.model = modelId;
  current.timestamp = new Date().toISOString();
  writeFileAtomic(file, JSON.stringify(current, null, 2) + '\n');
}

export function applyCustomAgent(customTarget, provider, modelId) {
  const t = targets()[customTarget];
  if (!t || !t.file) return;
  const file = t.file;
  const format = t.format || 'json';
  const relayUrl = relayProviderUrl(provider.id);
  const key = provider.apiKey || 'sk-switchlite';

  if (format === 'json') {
    const current = readJson(file);
    // 兼顾各种客户端命名风格 (camelCase / snake_case / nesting)
    current.baseUrl = relayUrl;
    current.base_url = relayUrl;
    current.apiBase = relayUrl;
    current.openaiBaseUrl = relayUrl;
    current.apiKey = key;
    current.api_key = key;
    current.openaiApiKey = key;
    current.model = modelId;
    current.modelId = modelId;
    current.model_name = modelId;
    current.provider = provider.name;
    current.updatedAt = new Date().toISOString();
    writeFileAtomic(file, JSON.stringify(current, null, 2) + '\n');
  } else if (format === 'yaml') {
    const lines = [
      `# SwitchLite Generated Config for ${t.label}`,
      `# Auto-generated at ${new Date().toISOString()}`,
      `base_url: "${relayUrl}"`,
      `api_key: "${key}"`,
      `model: "${modelId}"`,
      `provider: "${provider.name}"`,
      `openai-api-base: "${relayUrl}"`,
      `openai-api-key: "${key}"`,
      `updated_at: "${new Date().toISOString()}"`,
    ];
    writeFileAtomic(file, lines.join('\n') + '\n');
  } else if (format === 'env') {
    const lines = [
      `# SwitchLite Generated Environment Variables for ${t.label}`,
      `OPENAI_BASE_URL="${relayUrl}"`,
      `OPENAI_API_KEY="${key}"`,
      `ANTHROPIC_BASE_URL="${relayUrl}"`,
      `ANTHROPIC_AUTH_TOKEN="${key}"`,
      `MODEL="${modelId}"`,
      `UPDATED_AT="${new Date().toISOString()}"`,
    ];
    writeFileAtomic(file, lines.join('\n') + '\n');
  } else {
    // toml
    const lines = [
      `# SwitchLite Generated Config for ${t.label}`,
      `base_url = "${relayUrl}"`,
      `api_key = "${key}"`,
      `model = "${modelId}"`,
      `provider = "${provider.name}"`,
      `updated_at = "${new Date().toISOString()}"`,
    ];
    writeFileAtomic(file, lines.join('\n') + '\n');
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
    else if (target === 'cursor') applyCursor(provider, modelId);
    else if (target === 'grok') applyGrok(provider, modelId);
    else if (target === 'deepseek_harness') applyDeepSeekHarness(provider, modelId);
    else if (target === 'tare') applyTare(provider, modelId);
    else if (target === 'qcoder') applyQCoder(provider, modelId);
    else if (target === 'zcode') applyZCode(provider, modelId);
    else if (t.custom) applyCustomAgent(target, provider, modelId);
  } catch (err) {
    restoreSnapshots(snaps);
    const e = new Error(`${err.message}（配置已自动还原，未产生半成品改动）`);
    e.cause = err;
    throw e;
  }
  return { target, file: t.file, backup: bak, model: modelId, catalogFile };
}
