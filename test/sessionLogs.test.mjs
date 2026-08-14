// 会话日志解析回填：解析器、增量同步、与中继记录去重、清空后不回填
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-slhome-'));
const tmpLite = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-sllite-'));
process.env.CCS_HOME_OVERRIDE = tmpHome;
process.env.CCS_LITE_HOME = tmpLite;

const { parseCodexLine, parseClaudeLine, parseGeminiSession, isDuplicateOfRelay, syncSessionLogs, resetSessionSync } = await import(
  '../server/sessionLogs.js'
);
const { appendUsage, readUsage, clearUsage } = await import('../server/usage.js');

test('parseCodexLine：turn_context 记模型，token_count 产事件（含 reasoning/缓存）', () => {
  const state = { model: '' };
  assert.equal(parseCodexLine('{"type":"turn_context","payload":{"model":"deepseek-v4-pro"}}', state), null);
  assert.equal(state.model, 'deepseek-v4-pro');
  const ev = parseCodexLine(
    JSON.stringify({
      timestamp: '2026-08-14T03:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 9000 },
          last_token_usage: { input_tokens: 2894, cached_input_tokens: 96, output_tokens: 313, reasoning_output_tokens: 100, total_tokens: 3307 },
        },
      },
    }),
    state,
  );
  assert.equal(ev.model, 'deepseek-v4-pro');
  assert.equal(ev.input, 2894);
  assert.equal(ev.output, 413, 'reasoning tokens 应计入输出');
  assert.equal(ev.cached, 96);
  assert.equal(parseCodexLine('not json', state), null);
});

test('parseClaudeLine：assistant 消息 usage（含缓存创建/读取）', () => {
  const ev = parseClaudeLine(
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-14T03:00:00.000Z',
      message: {
        id: 'msg_1',
        model: 'glm-5.2',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 200 },
      },
    }),
  );
  assert.equal(ev.model, 'glm-5.2');
  assert.equal(ev.input, 100);
  assert.equal(ev.output, 50);
  assert.equal(ev.cached, 1000);
  assert.equal(parseClaudeLine('{"type":"user","message":{}}'), null);
});

test('parseGeminiSession：gemini 消息 tokens（thoughts 计入输出）', () => {
  const events = parseGeminiSession(
    JSON.stringify({
      messages: [
        { type: 'user', timestamp: '2026-08-14T03:00:00Z' },
        { type: 'gemini', timestamp: '2026-08-14T03:00:05Z', tokens: { input: 500, output: 80, thoughts: 20, cached: 30 } },
      ],
    }),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].target, 'gemini');
  assert.equal(events[0].output, 100);
  assert.equal(events[0].cached, 30);
});

test('isDuplicateOfRelay：同 Agent+模型+90s 窗口+token 差 5% 内', () => {
  const relay = [{ ts: '2026-08-14T03:00:10.000Z', target: 'codex', model: 'm1', total: 1000 }];
  assert.equal(
    isDuplicateOfRelay({ ts: '2026-08-14T03:00:30.000Z', target: 'codex', model: 'm1', total: 1020 }, relay),
    true,
  );
  assert.equal(
    isDuplicateOfRelay({ ts: '2026-08-14T03:05:30.000Z', target: 'codex', model: 'm1', total: 1000 }, relay),
    false,
    '超出 90s 窗口不算重复',
  );
  assert.equal(
    isDuplicateOfRelay({ ts: '2026-08-14T03:00:30.000Z', target: 'codex', model: 'm2', total: 1000 }, relay),
    false,
    '模型不同不算重复',
  );
  assert.equal(
    isDuplicateOfRelay({ ts: '2026-08-14T03:00:30.000Z', target: 'codex', model: 'm1', total: 2000 }, relay),
    false,
    'token 差超 5% 不算重复',
  );
});

test('增量同步全流程：导入 → 二次扫描无重复 → 与中继记录去重 → 清空后不回填', (t) => {
  t.after(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpLite, { recursive: true, force: true });
  });
  clearUsage();

  // 造一份 Codex rollout：一轮 turn（该轮已被中继记录过）+ 一轮历史
  const dir = path.join(tmpHome, '.codex', 'sessions', '2026', '08', '14');
  fs.mkdirSync(dir, { recursive: true });
  const rollout = path.join(dir, 'rollout-test.jsonl');
  const lines = [
    JSON.stringify({ timestamp: '2026-08-14T01:00:00.000Z', type: 'turn_context', payload: { model: 'deepseek-v4-pro' } }),
    JSON.stringify({
      timestamp: '2026-08-14T01:00:30.000Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, output_tokens: 50 } } },
    }),
    JSON.stringify({
      timestamp: '2026-08-14T02:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 200, output_tokens: 80 } } },
    }),
  ];
  fs.writeFileSync(rollout, lines.join('\n') + '\n', 'utf8');

  // 中继已记录过第二轮（02:00 那条）
  appendUsage({
    ts: '2026-08-14T02:00:05.000Z',
    providerId: 'p1',
    providerName: '千帆',
    target: 'codex',
    model: 'deepseek-v4-pro',
    input: 200,
    output: 80,
    total: 280,
    status: 200,
    ok: true,
  });

  const r1 = syncSessionLogs();
  assert.equal(r1.imported, 1, '只有未被中继覆盖的那条应导入');
  assert.equal(r1.duplicates, 1);
  const events = readUsage().filter((e) => e.source === 'session');
  assert.equal(events.length, 1);
  assert.equal(events[0].providerName, 'Codex 会话（日志）');
  assert.equal(events[0].total, 150);
  assert.equal(events[0].ts, '2026-08-14T01:00:30.000Z', '应使用日志自带时间戳');

  // 二次扫描：mtime 未变，零导入
  const r2 = syncSessionLogs();
  assert.equal(r2.imported, 0);

  // 追加新行 → 增量续扫
  fs.appendFileSync(
    rollout,
    JSON.stringify({
      timestamp: '2026-08-14T03:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 5, output_tokens: 5 } } },
    }) + '\n',
    'utf8',
  );
  const r3 = syncSessionLogs();
  assert.equal(r3.imported, 1, '续扫应只导入新增行');
  assert.equal(readUsage().filter((e) => e.source === 'session').length, 2);

  // 清空统计 + 重置同步状态 → 历史不应回填
  clearUsage();
  resetSessionSync();
  const r4 = syncSessionLogs();
  assert.equal(r4.imported, 0, '清空后已读标记生效，历史不回填');
});
