import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { relayProviderUrl } from './relay.js';

/**
 * Hermes Agent 配置文件读写（YAML，累加式供应商管理）。
 *
 * 路径解析顺序与 Hermes / cc-switch 保持一致：
 *   1. HERMES_HOME 环境变量（trim 后非空时优先）
 *   2. 测试注入 CCS_HOME_OVERRIDE（等价于临时 HOME）
 *   3. 平台默认：Windows %LOCALAPPDATA%\hermes，Mac/Linux ~/.hermes
 */
export function hermesDir() {
  const env = process.env.HERMES_HOME;
  if (env && String(env).trim()) {
    return path.resolve(String(env).trim());
  }
  if (process.env.CCS_HOME_OVERRIDE) {
    return path.join(path.resolve(process.env.CCS_HOME_OVERRIDE), '.hermes');
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'hermes');
  }
  return path.join(os.homedir(), '.hermes');
}

export function hermesConfigPath() {
  return path.join(hermesDir(), 'config.yaml');
}

function readDoc(file) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const doc = YAML.parseDocument(raw);
  if (doc.errors.length) {
    throw new Error(`Hermes config.yaml 解析失败：${doc.errors[0].message}`);
  }
  return doc;
}

function ensureRootMap(doc) {
  if (!doc.contents) {
    doc.contents = doc.createNode({});
    return;
  }
  if (!(doc.contents instanceof YAML.YAMLMap)) {
    throw new Error('Hermes config.yaml 顶层结构不是键值对，请检查配置文件');
  }
}

/**
 * 供应商名：与 OpenCode 一样优先用预设 id，其次用显示名，生成稳定 slug。
 * 同一个厂商多次切换会复用同一条 custom_providers 记录，不会无限累积。
 */
export function hermesProviderKey(provider) {
  const raw = provider.presetId && provider.presetId !== 'custom' ? provider.presetId : provider.name;
  const slug = String(raw || 'provider')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'provider';
}

function buildModelsMap(provider, modelId) {
  const map = {};
  const known = Array.isArray(provider.models) ? provider.models.map((m) => m && m.id).filter(Boolean) : [];
  const ids = known.includes(modelId) ? known : [modelId, ...known];
  for (const id of ids) {
    map[id] = { context_length: 200000 };
  }
  return map;
}

/**
 * 写入 Hermes 配置：
 * - 更新顶层 model 段（default / provider，保留其它已有字段）
 * - 按 name 匹配替换或追加 custom_providers 条目
 * - 保留文件里的 mcp_servers、agent、注释等其它内容
 */
export function applyHermes(provider, modelId) {
  const file = hermesConfigPath();
  const doc = readDoc(file);
  ensureRootMap(doc);

  const key = hermesProviderKey(provider);
  let providers = doc.get('custom_providers');
  let idx = -1;
  if (providers instanceof YAML.YAMLSeq) {
    idx = providers.items.findIndex(
      (item) => item instanceof YAML.YAMLMap && item.get('name') === key,
    );
  }

  const entry = {
    name: key,
    // 经本地中继转发（按供应商注入鉴权并计量用量）
    base_url: relayProviderUrl(provider.id),
    api_key: provider.apiKey || '',
    model: modelId,
    models: buildModelsMap(provider, modelId),
  };

  if (idx >= 0) {
    doc.setIn(['custom_providers', idx], entry);
  } else {
    if (!(providers instanceof YAML.YAMLSeq)) {
      doc.set('custom_providers', doc.createNode([]));
      providers = doc.get('custom_providers');
    }
    doc.addIn(['custom_providers'], entry);
  }

  const js = doc.toJS() || {};
  const base = js.model && typeof js.model === 'object' && !Array.isArray(js.model) ? js.model : {};
  doc.setIn(['model'], {
    ...base,
    default: modelId,
    provider: key,
  });

  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = doc.toString();
  if (!text.endsWith('\n')) text += '\n';
  fs.writeFileSync(file, text, 'utf8');
  return { providerKey: key };
}
