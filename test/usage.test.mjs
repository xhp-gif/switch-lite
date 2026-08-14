import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendUsage, summarizeUsage, clearUsage, readUsage } from '../server/usage.js';
import { extractUsage, relayProviderUrl, needsToolStrip, stripUnsupportedTools } from '../server/relay.js';

test('用量存储：追加 -> 聚合 -> 清空', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-usage-'));
  process.env.CCS_LITE_HOME = tmp;
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  appendUsage({ providerId: 'p1', providerName: 'DeepSeek', target: 'codex', model: 'deepseek-chat', input: 100, output: 50, total: 150, cached: 80, durationMs: 1200, status: 200, ok: true });
  appendUsage({ providerId: 'p1', providerName: 'DeepSeek', target: 'codex', model: 'deepseek-reasoner', input: 200, output: 300, total: 500, cached: 0, durationMs: 2800, status: 200, ok: true });
  appendUsage({ providerId: 'p2', providerName: 'GLM', target: 'claude', model: 'glm-5.2', input: 0, output: 0, total: 0, durationMs: 400, status: 429, ok: false });

  const events = readUsage();
  assert.equal(events.length, 3);
  assert.ok(events[0].ts, '每条记录应带时间戳');

  const s = summarizeUsage(0); // 0 = 全部
  assert.equal(s.totals.requests, 3);
  assert.equal(s.totals.input, 300);
  assert.equal(s.totals.output, 350);
  assert.equal(s.totals.total, 650);
  assert.equal(s.totals.cached, 80, '缓存 token 应被聚合');
  assert.equal(s.totals.errors, 1);
  assert.equal(s.totals.avgDurationMs, Math.round((1200 + 2800 + 400) / 3), '平均耗时应按请求数平均');

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
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":120,"output_tokens":45,"total_tokens":165,"input_tokens_details":{"cached_tokens":96}}}}',
    '',
  ].join('\n');
  const u = extractUsage('openai', '/v2/responses', '{"model":"qwen3.8-max"}', sse);
  assert.equal(u.input, 120);
  assert.equal(u.output, 45);
  assert.equal(u.total, 165);
  assert.equal(u.cached, 96, 'Responses API 的缓存 token 应被提取');
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
    'data: {"type":"message_start","message":{"usage":{"input_tokens":77,"output_tokens":1,"cache_read_input_tokens":50}}}',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","delta":{"text":"..."}}',
    'event: message_delta',
    'data: {"type":"message_delta","usage":{"output_tokens":156}}',
  ].join('\n');
  const u = extractUsage('anthropic', '/v1/messages', '{"model":"claude-sonnet-4"}', sse);
  assert.equal(u.input, 77);
  assert.equal(u.output, 156);
  assert.equal(u.cached, 50, 'Anthropic 的 cache_read_input_tokens 应被提取');
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

test('needsToolStrip：严格网关 + responses 路径（含无前导斜杠的新路由路径）', () => {
  // 回归：新 /p/<id> 路由传入的是 "responses"（不带 /），此前正则不匹配导致千帆报错
  assert.equal(needsToolStrip('https://qianfan.baidubce.com/v2', 'POST', 'responses'), true);
  assert.equal(needsToolStrip('https://qianfan.baidubce.com/v2', 'POST', '/v2/responses'), true);
  assert.equal(needsToolStrip('https://dashscope.aliyuncs.com/compatible-mode/v1', 'POST', 'responses'), true);
  // 非 responses 端点、非严格网关、非 POST 都不剥离
  assert.equal(needsToolStrip('https://qianfan.baidubce.com/v2', 'POST', 'chat/completions'), false);
  assert.equal(needsToolStrip('https://api.deepseek.com', 'POST', 'responses'), false);
  assert.equal(needsToolStrip('https://qianfan.baidubce.com/v2', 'GET', 'responses'), false);
});

test('stripUnsupportedTools：剥离 namespace/custom 工具并降级 tool_choice', () => {
  const body = JSON.stringify({
    model: 'deepseek-v4-pro',
    tools: [
      { type: 'function', name: 'shell' },
      { type: 'namespace', name: 'multi_agent' },
      { type: 'custom', name: 'apply_patch' },
      { type: 'mcp', name: 'fs' },
      { type: 'web_search' },
    ],
    tool_choice: { type: 'function', function: { name: 'multi_agent' } },
  });
  const out = JSON.parse(stripUnsupportedTools(body));
  assert.deepEqual(out.tools.map((t) => t.type), ['function', 'mcp'], '只保留 function/mcp/knowledge_search');
  assert.equal(out.tool_choice, 'auto', '指向被剥工具的 tool_choice 应降级为 auto');
  // 非 JSON 或没有 tools 的请求原样返回
  assert.equal(stripUnsupportedTools('not json'), 'not json');
  assert.equal(stripUnsupportedTools('{"model":"x"}'), '{"model":"x"}');
});

test('stripUnsupportedTools：custom_tool_call 记录转成 function_call，陌生条目丢弃', () => {
  const body = JSON.stringify({
    model: 'glm-4.6',
    input: [
      { type: 'message', role: 'user', content: '改一下代码' },
      { role: 'assistant', content: '好的' }, // 无 type 简写：保留
      { type: 'custom_tool_call', id: 'ctc_1', call_id: 'call_1', name: 'apply_patch', input: '*** Begin Patch\n...\n*** End Patch' },
      { type: 'custom_tool_call_output', call_id: 'call_1', output: 'patched' },
      { type: 'local_shell_call', call_id: 'call_2', action: { command: ['ls'] } },
      { type: 'reasoning', id: 'r1', summary: [] },
      { type: 'function_call', call_id: 'call_3', name: 'shell', arguments: '{}' },
    ],
  });
  const out = JSON.parse(stripUnsupportedTools(body));
  assert.deepEqual(
    out.input.map((i) => i.type || 'shorthand'),
    ['message', 'shorthand', 'function_call', 'function_call_output', 'reasoning', 'function_call'],
    'custom_tool_call(_output) 转换、local_shell_call 丢弃、其余保留',
  );
  const converted = out.input[2];
  assert.equal(converted.call_id, 'call_1');
  assert.equal(converted.name, 'apply_patch');
  assert.equal(converted.arguments, '*** Begin Patch\n...\n*** End Patch');
  assert.equal(out.input[3].output, 'patched');
});
