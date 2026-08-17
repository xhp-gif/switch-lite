import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBaseUrl,
  buildModelCandidates,
  parseModels,
  buildRecommendations,
  discoverModels,
  inferProviderHint,
  resolveBaseFromEndpoint,
} from '../server/registry.js';
import { getPreset } from '../server/presets.js';
import { startMockServer } from './mock-model-server.mjs';

test('normalizeBaseUrl：兼容各种粘贴形式与自动补全 https', () => {
  assert.equal(normalizeBaseUrl('api.deepseek.com'), 'https://api.deepseek.com');
  assert.equal(normalizeBaseUrl('https://api.deepseek.com/'), 'https://api.deepseek.com');
  assert.equal(normalizeBaseUrl('https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1');
  assert.equal(normalizeBaseUrl('https://example.com/v1/chat/completions'), 'https://example.com/v1');
  assert.equal(normalizeBaseUrl('https://example.com/v1/models'), 'https://example.com/v1');
  assert.equal(normalizeBaseUrl('https://example.com/models'), 'https://example.com');
  assert.equal(normalizeBaseUrl(''), '');
});

test('inferProviderHint：API Key 与域名指纹智能识别', () => {
  const baiduKey = inferProviderHint({ apiKey: 'bce-v3/ALTAK-test/123' });
  assert.equal(baiduKey.presetId, 'baidu');
  assert.equal(baiduKey.baseUrl, 'https://qianfan.baidubce.com/v2');

  const antKey = inferProviderHint({ apiKey: 'sk-ant-api03-test' });
  assert.equal(antKey.protocol, 'anthropic');

  const aliyunUrl = inferProviderHint({ url: 'https://dashscope.aliyuncs.com' });
  assert.equal(aliyunUrl.presetId, 'aliyun');
  assert.equal(aliyunUrl.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
});

test('buildModelCandidates：OpenAI 兼容 / Anthropic / Ollama / DashScope', () => {
  const ds = buildModelCandidates('https://api.deepseek.com', 'openai');
  assert.ok(ds.includes('https://api.deepseek.com/models'));
  assert.ok(ds.includes('https://api.deepseek.com/v1/models'));
  assert.ok(ds.includes('https://api.deepseek.com/api/v1/models'));
  assert.ok(ds.includes('https://api.deepseek.com/v2/models'));

  assert.deepEqual(buildModelCandidates('https://api.anthropic.com/v1', 'anthropic'), [
    'https://api.anthropic.com/v1/models',
  ]);
  const dash = buildModelCandidates('https://dashscope.aliyuncs.com/api/v1', 'openai');
  assert.ok(dash.includes('https://dashscope.aliyuncs.com/compatible-mode/v1/models'));
  const ollama = buildModelCandidates('http://localhost:11434', 'openai');
  assert.ok(ollama.includes('http://localhost:11434/api/tags'));
});

test('parseModels：OpenAI / Anthropic / Gemini / Ollama 响应格式', () => {
  assert.deepEqual(parseModels({ data: [{ id: 'a' }, { id: 'b' }] }, 'openai'), [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(parseModels({ data: [{ id: 'claude-sonnet-4' }] }, 'anthropic'), [{ id: 'claude-sonnet-4' }]);
  assert.deepEqual(parseModels({ models: [{ name: 'models/gemini-2.5-pro' }] }, 'gemini'), [{ id: 'gemini-2.5-pro' }]);
  assert.deepEqual(parseModels({ models: [{ name: 'llama3.1:latest' }] }, 'openai'), [{ id: 'llama3.1:latest' }]);
  // 去重
  assert.deepEqual(parseModels({ data: [{ id: 'a' }, { id: 'a' }] }, 'openai'), [{ id: 'a' }]);
});

test('buildRecommendations：预设系列 + 自动归类', () => {
  const preset = getPreset('aliyun');
  const fetched = [
    { id: 'deepseek-v4-pro' },
    { id: 'glm-5.2' },
    { id: 'kimi/kimi-k3' },
    { id: 'qwen3.8-max' },
    { id: 'text-embedding-v4' },
    { id: 'gpt-4o' },
  ];
  const series = buildRecommendations(fetched, preset);
  assert.equal(series[0].series, 'DeepSeek');
  assert.equal(series[0].items.find((i) => i.id === 'deepseek-v4-pro').available, true);
  assert.equal(series[0].items.find((i) => i.id === 'deepseek-v3').available, false);
  assert.ok(series.some((s) => s.series === 'OpenAI' && s.items.some((i) => i.id === 'gpt-4o')));
});

test('discoverModels：mock OpenAI 兼容服务端到端', async (t) => {
  const mock = await startMockServer();
  t.after(() => mock.close());

  const ok = await discoverModels({
    baseUrl: 'http://127.0.0.1:18999/v1',
    apiKey: 'sk-test-123',
    protocol: 'openai',
  });
  assert.ok(ok.models.length >= 5);
  assert.equal(ok.endpoint, 'http://127.0.0.1:18999/v1/models');

  await assert.rejects(
    () => discoverModels({ baseUrl: 'http://127.0.0.1:18999/v1', apiKey: 'bad-key', protocol: 'openai' }),
    /API Key/,
  );
});
