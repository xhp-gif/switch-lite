// 用量统计：中继把每次调用的 token 用量追加到 usage.jsonl，看板按时间范围聚合。
// 存储为 JSONL（每行一条），写入永远 best-effort，失败不影响代理转发。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function homeDir() {
  return process.env.CCS_LITE_HOME ? path.resolve(process.env.CCS_LITE_HOME) : path.join(os.homedir(), '.cc-switch-lite');
}

function usageFile() {
  return path.join(homeDir(), 'usage.jsonl');
}

const MAX_BYTES = 5 * 1024 * 1024; // 超过 5MB 截断保留较新的一半

export function appendUsage(rec) {
  try {
    fs.mkdirSync(homeDir(), { recursive: true });
    fs.appendFileSync(usageFile(), JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n', 'utf8');
    trimIfNeeded();
  } catch (err) {
    console.error('[usage] 写入失败:', err.message);
  }
}

function trimIfNeeded() {
  const file = usageFile();
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size <= MAX_BYTES) return;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    fs.writeFileSync(file, lines.slice(Math.floor(lines.length / 2)).join('\n'), 'utf8');
  } catch (err) {
    console.error('[usage] 截断失败:', err.message);
  }
}

export function readUsage() {
  try {
    if (!fs.existsSync(usageFile())) return [];
    return fs
      .readFileSync(usageFile(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    console.error('[usage] 读取失败:', err.message);
    return [];
  }
}

export function clearUsage() {
  try {
    if (fs.existsSync(usageFile())) fs.rmSync(usageFile());
  } catch (err) {
    console.error('[usage] 清空失败:', err.message);
  }
}

function num(v) {
  return Number.isFinite(v) ? v : 0;
}

// days=0 表示全部时间
export function summarizeUsage(days = 7) {
  const since = days > 0 ? Date.now() - days * 86400_000 : 0;
  const events = readUsage().filter((e) => !since || new Date(e.ts).getTime() >= since);

  const totals = { requests: 0, input: 0, output: 0, total: 0, cached: 0, errors: 0, durationMs: 0, avgDurationMs: 0 };
  const byProvider = new Map();
  const byModel = new Map();
  const byDay = new Map();

  for (const e of events) {
    const input = num(e.input);
    const output = num(e.output);
    const total = num(e.total) || input + output;
    const cached = num(e.cached);
    const durationMs = num(e.durationMs);
    const failed = e.ok === false || (typeof e.status === 'number' && e.status >= 400);

    totals.requests += 1;
    totals.input += input;
    totals.output += output;
    totals.total += total;
    totals.cached += cached;
    totals.durationMs += durationMs;
    if (failed) totals.errors += 1;

    const pKey = e.providerId || e.providerName || 'unknown';
    const p = byProvider.get(pKey) || {
      providerId: e.providerId || '',
      name: e.providerName || '未知供应商',
      target: e.target || '',
      requests: 0,
      input: 0,
      output: 0,
      total: 0,
      cached: 0,
      errors: 0,
    };
    p.requests += 1;
    p.input += input;
    p.output += output;
    p.total += total;
    p.cached += cached;
    if (failed) p.errors += 1;
    byProvider.set(pKey, p);

    const mKey = `${p.name}::${e.model || '未知模型'}`;
    const m = byModel.get(mKey) || {
      model: e.model || '未知模型',
      provider: p.name,
      requests: 0,
      input: 0,
      output: 0,
      total: 0,
      cached: 0,
      errors: 0,
    };
    m.requests += 1;
    m.input += input;
    m.output += output;
    m.total += total;
    m.cached += cached;
    if (failed) m.errors += 1;
    byModel.set(mKey, m);

    const day = String(e.ts || '').slice(0, 10);
    if (day) {
      const d = byDay.get(day) || { date: day, requests: 0, input: 0, output: 0, total: 0 };
      d.requests += 1;
      d.input += input;
      d.output += output;
      d.total += total;
      byDay.set(day, d);
    }
  }

  totals.avgDurationMs = totals.requests ? Math.round(totals.durationMs / totals.requests) : 0;

  const sortByTotal = (a, b) => b.total - a.total || b.requests - a.requests;
  return {
    days,
    totals,
    byProvider: [...byProvider.values()].sort(sortByTotal),
    byModel: [...byModel.values()].sort(sortByTotal),
    daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    recent: events.slice(-20).reverse(),
  };
}
