// 会话日志解析回填：离线解析各 Agent 的本地会话记录，把 token 用量补进看板。
// 与中继计量互补：中继停机期间、接入 SwitchLite 之前的历史都能覆盖。
// 全部 best-effort：任何文件解析失败都不影响主流程。
//
// 覆盖：Codex（rollout jsonl）、Claude Code（projects jsonl）、Gemini CLI（chats json）。
// OpenCode 用量存在 SQLite，本项目无 sqlite 依赖，暂不支持。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendUsage, readUsage } from './usage.js';

function homeDir() {
  return process.env.CCS_HOME_OVERRIDE ? path.resolve(process.env.CCS_HOME_OVERRIDE) : os.homedir();
}

function liteHome() {
  return process.env.CCS_LITE_HOME ? path.resolve(process.env.CCS_LITE_HOME) : path.join(os.homedir(), '.cc-switch-lite');
}

function syncStateFile() {
  return path.join(liteHome(), 'session-sync.json');
}

const AGENT_LABEL = {
  codex: 'Codex 会话（日志）',
  claude: 'Claude 会话（日志）',
  gemini: 'Gemini 会话（日志）',
};

// ---------- 解析器（纯函数，可单测） ----------

// Codex rollout 行：turn_context 更新当前模型；event_msg/token_count 产出一条事件
export function parseCodexLine(line, state) {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  const ts = rec.timestamp || null;
  if (rec.type === 'turn_context' && rec.payload && typeof rec.payload.model === 'string') {
    state.model = rec.payload.model;
    return null;
  }
  if (rec.type !== 'event_msg' || !rec.payload || rec.payload.type !== 'token_count') return null;
  const u = rec.payload.info && rec.payload.info.last_token_usage;
  if (!u) return null;
  const input = Number(u.input_tokens) || 0;
  const output = (Number(u.output_tokens) || 0) + (Number(u.reasoning_output_tokens) || 0);
  const cached = Number(u.cached_input_tokens) || 0;
  if (!input && !output) return null;
  return { ts, target: 'codex', model: state.model || '', input, output, total: input + output, cached };
}

// Claude projects 行：assistant 消息带 usage
export function parseClaudeLine(line) {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  if (rec.type !== 'assistant' || !rec.message || !rec.message.usage) return null;
  const u = rec.message.usage;
  const input = Number(u.input_tokens) || 0;
  const output = Number(u.output_tokens) || 0;
  const cached = (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);
  if (!input && !output && !cached) return null;
  return {
    ts: rec.timestamp || null,
    target: 'claude',
    model: typeof rec.message.model === 'string' ? rec.message.model : '',
    input,
    output,
    total: input + output,
    cached,
  };
}

// Gemini chats session-*.json：整文件 JSON，messages 里 gemini 消息带 tokens
export function parseGeminiSession(text) {
  let rec;
  try {
    rec = JSON.parse(text);
  } catch {
    return [];
  }
  const messages = Array.isArray(rec.messages) ? rec.messages : [];
  const out = [];
  for (const m of messages) {
    if (!m || !m.tokens) continue;
    const t = m.tokens;
    const input = Number(t.input) || 0;
    const output = (Number(t.output) || 0) + (Number(t.thoughts) || 0);
    const cached = Number(t.cached) || 0;
    if (!input && !output) continue;
    out.push({
      ts: m.timestamp || null,
      target: 'gemini',
      model: typeof m.model === 'string' ? m.model : '',
      input,
      output,
      total: input + output,
      cached,
    });
  }
  return out;
}

// ---------- 文件扫描 ----------

function walk(dir, depth, test, out) {
  if (depth < 0) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth - 1, test, out);
    else if (e.isFile() && test(e.name)) out.push(p);
  }
}

function listSourceFiles() {
  const home = homeDir();
  const files = [];
  // Codex：~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
  walk(path.join(home, '.codex', 'sessions'), 4, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), files);
  // Claude：~/.claude/projects/*/*.jsonl
  walk(path.join(home, '.claude', 'projects'), 2, (n) => n.endsWith('.jsonl'), files);
  // Gemini：~/.gemini/tmp/<hash>/chats/session-*.json
  walk(path.join(home, '.gemini', 'tmp'), 3, (n) => n.startsWith('session-') && n.endsWith('.json'), files);
  return files;
}

function readSyncState() {
  try {
    return JSON.parse(fs.readFileSync(syncStateFile(), 'utf8'));
  } catch {
    return { files: {} };
  }
}

function writeSyncState(state) {
  try {
    fs.mkdirSync(liteHome(), { recursive: true });
    fs.writeFileSync(syncStateFile(), JSON.stringify(state), 'utf8');
  } catch {
    /* 状态写失败下次全量重扫，去重逻辑兜底 */
  }
}

function parserFor(file) {
  if (/rollout-.*\.jsonl$/.test(file)) return 'codex';
  if (/session-.*\.json$/.test(file)) return 'gemini';
  return 'claude';
}

// 与中继记录去重：同 Agent + 同模型 + 时间差 ≤90s + total 差 ≤5% 视为同一次调用
export function isDuplicateOfRelay(event, relayEvents) {
  const t = event.ts ? new Date(event.ts).getTime() : 0;
  if (!t) return false;
  for (const r of relayEvents) {
    if (r.source === 'session') continue;
    if (r.target !== event.target) continue;
    if ((r.model || '') !== (event.model || '')) continue;
    const rt = r.ts ? new Date(r.ts).getTime() : 0;
    if (!rt || Math.abs(rt - t) > 90_000) continue;
    const rt2 = Number(r.total) || 0;
    if (rt2 && event.total) {
      if (Math.abs(rt2 - event.total) / Math.max(rt2, event.total) <= 0.05) return true;
    } else if (rt2 === event.total) {
      return true;
    }
  }
  return false;
}

/**
 * 扫描并导入增量用量。返回 {imported, duplicates, files}。
 * 每个 jsonl 按字节偏移续扫；gemini json 整文件重读、按已导入条数跳过。
 */
export function syncSessionLogs() {
  const state = readSyncState();
  state.files = state.files || {};
  const relayEvents = readUsage();
  let imported = 0;
  let duplicates = 0;
  let files = 0;

  for (const file of listSourceFiles()) {
    files += 1;
    const kind = parserFor(file);
    const prev = state.files[file] || { mtimeMs: 0, offset: 0, count: 0 };
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    // 文件未变 → 跳过
    if (prev.mtimeMs === stat.mtimeMs) continue;

    try {
      if (kind === 'gemini') {
        const events = parseGeminiSession(fs.readFileSync(file, 'utf8'));
        for (const ev of events.slice(prev.count || 0)) {
          if (isDuplicateOfRelay(ev, relayEvents)) duplicates += 1;
          else {
            appendEvent(ev);
            imported += 1;
          }
        }
        state.files[file] = { mtimeMs: stat.mtimeMs, offset: 0, count: events.length };
        continue;
      }

      // jsonl：按偏移续读；文件被截断/重写则从头再来
      let offset = prev.offset || 0;
      if (offset > stat.size || stat.mtimeMs < prev.mtimeMs) offset = 0;
      const buf = fs.readFileSync(file);
      const text = buf.subarray(offset).toString('utf8');
      const lines = text.split('\n');
      const stateInFile = { model: offset > 0 ? prev.model || '' : '' };
      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = kind === 'codex' ? parseCodexLine(line, stateInFile) : parseClaudeLine(line);
        if (!ev) continue;
        if (isDuplicateOfRelay(ev, relayEvents)) duplicates += 1;
        else {
          appendEvent(ev);
          imported += 1;
        }
      }
      state.files[file] = { mtimeMs: stat.mtimeMs, offset: stat.size, count: 0, model: stateInFile.model || undefined };
    } catch {
      /* 单文件失败不影响其他文件 */
    }
  }

  writeSyncState(state);
  return { imported, duplicates, files };
}

function appendEvent(ev) {
  appendUsage({
    providerId: '',
    providerName: AGENT_LABEL[ev.target] || '会话日志',
    target: ev.target,
    model: ev.model || '未知模型',
    input: ev.input,
    output: ev.output,
    total: ev.total,
    cached: ev.cached,
    durationMs: 0,
    status: 200,
    ok: true,
    source: 'session',
    ts: ev.ts || undefined,
  });
}

// 「清空统计」时调用：把当前所有日志文件标记为已读，避免清空后历史又被回填
export function resetSessionSync() {
  const state = { files: {} };
  for (const file of listSourceFiles()) {
    try {
      const stat = fs.statSync(file);
      state.files[file] = { mtimeMs: stat.mtimeMs, offset: stat.size, count: 0 };
    } catch {
      /* ignore */
    }
  }
  writeSyncState(state);
}
