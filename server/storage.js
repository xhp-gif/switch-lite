import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPreset } from './presets.js';
import { normalizeBaseUrl } from './registry.js';

function homeDir() {
  return process.env.CCS_LITE_HOME ? path.resolve(process.env.CCS_LITE_HOME) : path.join(os.homedir(), '.cc-switch-lite');
}

function filePath() {
  return path.join(homeDir(), 'providers.json');
}

function ensureDir() {
  fs.mkdirSync(homeDir(), { recursive: true });
}

export function listProviders() {
  try {
    if (!fs.existsSync(filePath())) return [];
    const data = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    const list = Array.isArray(data) ? data : [];
    return list.map((p) => ({ ...p, target: TARGETS.includes(p.target) ? p.target : 'codex' }));
  } catch (err) {
    console.error('[storage] 读取 providers.json 失败:', err.message);
    return [];
  }
}

const TARGETS = ['claude', 'codex', 'gemini', 'opencode', 'hermes'];

export function saveProviders(list) {
  ensureDir();
  const tmp = `${filePath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  if (fs.existsSync(filePath())) fs.rmSync(filePath());
  fs.renameSync(tmp, filePath());
}

export function getProvider(id) {
  return listProviders().find((p) => p.id === id) || null;
}

const UPDATE_KEYS = [
  'name',
  'presetId',
  'baseUrl',
  'anthropicUrl',
  'apiKey',
  'protocol',
  'wireApi',
  'target',
  'selectedModel',
  'models',
  'fetchedAt',
  'lastFetchError',
  'lastApplied',
  'lastSpeedtest',
];

export function createProvider(body = {}) {
  const preset = getPreset(body.presetId) || getPreset('custom');
  const baseUrl = normalizeBaseUrl(body.baseUrl || preset.baseUrl || '');
  const target = TARGETS.includes(body.target) ? body.target : 'codex';
  const list = listProviders();
  // 同一 Agent 下相同 URL 视为同一供应商：复用而不是重复创建（防止双击/并发产生重复记录）
  const existing = baseUrl
    ? list.find((p) => p.target === target && p.baseUrl && normalizeBaseUrl(p.baseUrl) === baseUrl)
    : null;
  if (existing) {
    const updated = updateProvider(existing.id, { ...body, baseUrl });
    return { ...updated, reused: true };
  }
  const provider = {
    id: crypto.randomUUID(),
    name: String(body.name || preset.name || '未命名供应商'),
    presetId: body.presetId || 'custom',
    baseUrl,
    anthropicUrl: body.anthropicUrl ? normalizeBaseUrl(body.anthropicUrl) : preset.anthropicUrl || '',
    apiKey: String(body.apiKey || ''),
    protocol: body.protocol || preset.protocol || 'openai',
    wireApi: body.wireApi || preset.wireApi || 'chat',
    target,
    selectedModel: String(body.selectedModel || ''),
    models: Array.isArray(body.models) ? body.models : [],
    fetchedAt: body.fetchedAt || null,
    lastFetchError: body.lastFetchError || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  list.push(provider);
  saveProviders(list);
  return provider;
}

export function updateProvider(id, patch = {}) {
  const list = listProviders();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const next = { ...list[idx] };
  for (const key of UPDATE_KEYS) {
    if (key in patch) next[key] = patch[key];
  }
  if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim();
  if (typeof patch.baseUrl === 'string') next.baseUrl = normalizeBaseUrl(patch.baseUrl);
  if (typeof patch.anthropicUrl === 'string') next.anthropicUrl = normalizeBaseUrl(patch.anthropicUrl);
  if (Array.isArray(patch.models)) next.models = patch.models;
  next.updatedAt = new Date().toISOString();
  list[idx] = next;
  saveProviders(list);
  return next;
}

export function removeProvider(id) {
  const list = listProviders();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  saveProviders(next);
  return true;
}

// ---------- 设置：每个 Agent 的当前供应商 ----------

function settingsFilePath() {
  return path.join(homeDir(), 'settings.json');
}

export function getSettings() {
  try {
    if (!fs.existsSync(settingsFilePath())) return { active: {}, failover: true };
    const s = JSON.parse(fs.readFileSync(settingsFilePath(), 'utf8'));
    return {
      ...s,
      active: s.active && typeof s.active === 'object' ? s.active : {},
      failover: s.failover !== false, // 缺省开启
    };
  } catch {
    return { active: {}, failover: true };
  }
}

// 通用设置更新（目前只有 failover 开关；active 走 setActiveProvider）
export function updateSettings(patch = {}) {
  const settings = getSettings();
  if (typeof patch.failover === 'boolean') settings.failover = patch.failover;
  saveSettings(settings);
  return settings;
}

// ---------- 切换历史：按 (target, model) 去重，最新在前 ----------
const HISTORY_CAP = 50;

export function recordHistory(target, providerId, model) {
  if (!target || !model) return;
  const settings = getSettings();
  const history = Array.isArray(settings.history) ? settings.history : [];
  const next = history.filter((h) => !(h.target === target && h.model === model));
  next.unshift({ target, providerId, model, at: new Date().toISOString() });
  settings.history = next.slice(0, HISTORY_CAP);
  saveSettings(settings);
}

// 合并「主动接入记录」与「中继实际调用记录」，按模型去重（同一模型只算一条历史）
export function getHistory(target, usageEvents = []) {
  const settings = getSettings();
  const stored = (Array.isArray(settings.history) ? settings.history : []).filter((h) => h.target === target);
  const providers = listProviders();
  const byId = new Map(providers.map((p) => [p.id, p]));
  const seen = new Set();
  const out = [];
  for (const h of stored) {
    if (seen.has(h.model)) continue;
    seen.add(h.model);
    const p = byId.get(h.providerId);
    out.push({ model: h.model, providerId: h.providerId, providerName: p ? p.name : '（已删除）', available: !!p, at: h.at });
  }
  // 用量事件按时间倒序补充（中继计量到的模型也是“用过”的历史）
  const events = [...usageEvents].filter((e) => e.target === target && e.providerId && e.model).sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  for (const e of events) {
    if (seen.has(e.model)) continue;
    seen.add(e.model);
    const p = byId.get(e.providerId);
    out.push({ model: e.model, providerId: e.providerId, providerName: p ? p.name : e.providerName, available: !!p, at: e.ts });
    if (out.length >= HISTORY_CAP) break;
  }
  return out;
}

function saveSettings(settings) {
  ensureDir();
  const tmp = `${settingsFilePath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  if (fs.existsSync(settingsFilePath())) fs.rmSync(settingsFilePath());
  fs.renameSync(tmp, settingsFilePath());
}

export function setActiveProvider(target, providerId) {
  const settings = getSettings();
  if (providerId) settings.active[target] = providerId;
  else delete settings.active[target];
  saveSettings(settings);
  return settings;
}

// ---------- 启动迁移：合并重复供应商 ----------
// 同 target + 同 baseUrl 视为同一条记录，保留最新一条并合并模型列表，
// 同时把 settings.active 里指向被删除记录的 id 重映射到保留记录。
export function mergeDuplicateProviders() {
  const list = listProviders();
  const groups = new Map();
  for (const p of list) {
    if (!p.baseUrl) continue;
    const key = `${p.target}::${normalizeBaseUrl(p.baseUrl)}`;
    const g = groups.get(key) || [];
    g.push(p);
    groups.set(key, g);
  }
  const remap = new Map();
  const toRemove = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb - ta;
    });
    const keep = group[0];
    const modelMap = new Map();
    for (const p of group) {
      for (const m of Array.isArray(p.models) ? p.models : []) {
        if (m && m.id) modelMap.set(m.id, m);
      }
    }
    const fetchedAt = group.map((p) => p.fetchedAt).filter(Boolean).sort().pop() || keep.fetchedAt || null;
    const idx = list.findIndex((p) => p.id === keep.id);
    if (idx === -1) continue;
    list[idx] = { ...keep, models: [...modelMap.values()], fetchedAt, updatedAt: new Date().toISOString() };
    for (const p of group.slice(1)) {
      remap.set(p.id, keep.id);
      toRemove.push(p.id);
    }
  }
  if (toRemove.length === 0) return { merged: 0, removed: [], remapped: [] };
  saveProviders(list.filter((p) => !toRemove.includes(p.id)));
  const settings = getSettings();
  const remapped = [];
  for (const [target, id] of Object.entries(settings.active || {})) {
    if (id && remap.has(id)) {
      settings.active[target] = remap.get(id);
      remapped.push({ target, from: id, to: remap.get(id) });
    }
  }
  if (remapped.length) saveSettings(settings);
  return { merged: toRemove.length, removed: toRemove, remapped };
}
