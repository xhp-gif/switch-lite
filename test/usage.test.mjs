import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendUsage, summarizeUsage, clearUsage, readUsage } from '../server/usage.js';
import { extractUsage, relayProviderUrl } from '../server/relay.js';

test('用量存储：追加 -> 聚合 -> 清空', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-usage-'));
  process.env.CCS_LITE_HOME = tmp;
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  appendUsage({ providerId: 'p1', providerName: 'DeepSeek', target: 'codex', model: 'deepseek-chat', input: 100, output: 50, total: 150, status: 200, ok: true });
  appendUsage({ providerId: 'p1', providerName: 'DeepSeek', target: 'codex', model: 'deepseek-reasoner', input: 200, output: 300, total: 500, status: 200, ok: true });
  appendUsage({ providerId: 'p2', providerName: 'GLM', target: 'claude', model: 'glm-5.2', input: 0, output: 0, total: 0, status: 429, ok: false });

  const events = readUsage();
  assert.equal(events.length, 3);
  assert.ok(events[0].ts, '每条记录应带时间戳');

  const s = summarizeUsage(0); // 0 = 全部
  assert.equal(s.totals.requests, 3);
  assert.equal(s.totals.input, 300);
  assert.equal(s.totals.output, 350);
  assert.equal(s.totals.total, 650);
  assert.equal(s.totals.errors, 1);

  assert.equal(s.byProvider.length, 2);
  const p1 = s.byProvider.find((p) => p.providerId === 'p1');
  assert.equal(p1.requests, 2);
  assert.equal(p1.total, 650);
  assert.equal(p1.errors, 0);
  const p2 = s.byProvider.find((p) => p.providerId === 'p2');
  assert.equal(p2.errors, 1, 'HTTP >= 400 应计为失败');

  assert.equal(s.byModel.length, 3);
  assert.equal(s.recent.length, 3);
  assert.equal(s.recent[0].providerName, 'GLM', 'recent 应按时间倒序');
  assert.ok(s.daily.length >= 1);

  // 时间范围过滤：days=1 只含今天（三条都是刚写入的，应全部命中）
  const s1 = summarizeUsage(1);
  assert.equal(s1.totals.requests, 3);

  clearUsage();
  assert.equal(readUsage().length, 0);
  assert.equal(summarizeUsage(0).totals.requests, 0);
});

test('extractUsage：OpenAI Responses API（SSE）', () => {
  const sse = [
    'event: response.created',
    'data: {"type":"response.created","response":{"id":"r1"}}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":120,"output_tokens":45,"total_tokens":165}}}',
    '',
  ].join('\n');
  const u = extractUsage('openai', '/v2/responses', '{"model":"qwen3.8-max"}', sse);
  assert.equal(u.input, 120);
  assert.equal(u.output, 45);
  assert.equal(u.total, 165);
  assert.equal(u.model, 'qwen3.8-max');
});

test('extractUsage：OpenAI Chat Completions（非流式 + 流式 usage chunk）', () => {
  const json = JSON.stringify({ id: 'c1', usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
  const u1 = extractUsage('openai', '/v1/chat/completions', '{"model":"deepseek-chat"}', json);
  assert.equal(u1.input, 10);
  assert.equal(u1.output, 20);
  assert.equal(u1.model, 'deepseek-chat');

  const sse = [
    'data: {"id":"c2","choices":[{"delta":{"content":"hi"}}]}',
    'data: {"id":"c2","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":12}}',
    'data: [DONE]',
  ].join('\n');
  const u2 = extractUsage('openai', '/v1/chat/completions', '{"model":"deepseek-chat"}', sse);
  assert.equal(u2.input, 8);
  assert.equal(u2.output, 12);
});

test('extractUsage：Anthropic Messages（SSE）', () => {
  const sse = [
    'event: message_start',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":77,"output_tokens":1}}}',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","delta":{"text":"..."}}',
    'event: message_delta',
    'data: {"type":"message_delta","usage":{"output_tokens":156}}',
  ].join('\n');
  const u = extractUsage('anthropic', '/v1/messages', '{"model":"claude-sonnet-4"}', sse);
  assert.equal(u.input, 77);
  assert.equal(u.output, 156);
  assert.equal(u.model, 'claude-sonnet-4');
});

test('extractUsage：Gemini（usageMetadata + 从路径取模型）', () => {
  const sse = [
    'data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}',
    'data: {"candidates":[{}],"usageMetadata":{"promptTokenCount":33,"candidatesTokenCount":89,"totalTokenCount":122}}',
  ].join('\n');
  const u = extractUsage('gemini', '/v1beta/models/gemini-2.5-pro:streamGenerateContent', '{}', sse);
  assert.equal(u.input, 33);
  assert.equal(u.output, 89);
  assert.equal(u.model, 'gemini-2.5-pro');

  // 非流式 JSON 单对象
  const json = JSON.stringify({ candidates: [{}], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 } });
  const u2 = extractUsage('gemini', '/v1beta/models/gemini-2.5-flash:generateContent', '{}', json);
  assert.equal(u2.input, 5);
  assert.equal(u2.output, 7);
});

test('extractUsage：无用量时返回 null，解析失败不抛错', () => {
  assert.equal(extractUsage('openai', '/v1/models', '', '{"data":[]}'), null);
  assert.equal(extractUsage('openai', '/v1/chat/completions', '', 'not json at all'), null);
});

test('relayProviderUrl：按供应商生成中转地址', () => {
  assert.match(relayProviderUrl('abc-123'), /^http:\/\/127\.0\.0\.1:\d+\/p\/abc-123$/);
});
