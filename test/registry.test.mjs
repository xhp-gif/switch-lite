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
  variantEndpointsFor,
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

test('normalizeBaseUrl：放行登记过的按量/订阅端点，未登记路径才纠偏', () => {
  // 智谱编程订阅端点必须原样保留（曾被打错包纠偏成按量地址）
  assert.equal(normalizeBaseUrl('https://open.bigmodel.cn/api/coding/paas/v4'), 'https://open.bigmodel.cn/api/coding/paas/v4');
  // Anthropic 兼容入口及其版本子路径
  assert.equal(normalizeBaseUrl('https://open.bigmodel.cn/api/anthropic'), 'https://open.bigmodel.cn/api/anthropic');
  assert.equal(normalizeBaseUrl('https://open.bigmodel.cn/api/anthropic/v1'), 'https://open.bigmodel.cn/api/anthropic/v1');
  // Kimi For Coding 端点；裸域名回退到默认（订阅）端点
  assert.equal(normalizeBaseUrl('https://api.kimi.com/coding/v1'), 'https://api.kimi.com/coding/v1');
  assert.equal(normalizeBaseUrl('api.kimi.com'), 'https://api.kimi.com/coding/v1');
  // 未登记的路径与裸域名纠偏到厂商默认端点
  assert.equal(normalizeBaseUrl('https://open.bigmodel.cn'), 'https://open.bigmodel.cn/api/paas/v4');
  assert.equal(normalizeBaseUrl('https://open.bigmodel.cn/v4'), 'https://open.bigmodel.cn/api/paas/v4');
  // 旧纠偏行为保持：千帆必须 /v2，dashscope 兼容 /apps/anthropic
  assert.equal(normalizeBaseUrl('https://qianfan.baidubce.com/v1'), 'https://qianfan.baidubce.com/v2');
  assert.equal(normalizeBaseUrl('https://dashscope.aliyuncs.com/apps/anthropic'), 'https://dashscope.aliyuncs.com/apps/anthropic');
});

test('inferProviderHint：端点变体（订阅/Anthropic 兼容路径）识别', () => {
  const kimiCoding = inferProviderHint({ url: 'https://api.kimi.com/coding/v1' });
  assert.equal(kimiCoding.presetId, 'moonshot');
  assert.equal(kimiCoding.variantId, 'coding');
  assert.equal(kimiCoding.protocol, 'anthropic');

  const glmCoding = inferProviderHint({ url: 'https://open.bigmodel.cn/api/coding/paas/v4' });
  assert.equal(glmCoding.presetId, 'zhipu');
  assert.equal(glmCoding.variantId, 'coding');
  assert.equal(glmCoding.protocol, 'openai');

  const glmAnthropic = inferProviderHint({ url: 'https://open.bigmodel.cn/api/anthropic' });
  assert.equal(glmAnthropic.variantId, 'coding-anthropic');
  assert.equal(glmAnthropic.protocol, 'anthropic');

  const glmApi = inferProviderHint({ url: 'https://open.bigmodel.cn/api/paas/v4' });
  assert.equal(glmApi.variantId, 'api');
  assert.equal(glmApi.protocol, 'openai');
});

test('variantEndpointsFor：列出同厂商其它已登记端点', () => {
  const alts = variantEndpointsFor('https://open.bigmodel.cn/api/paas/v4');
  assert.ok(alts.some((v) => v.baseUrl === 'https://open.bigmodel.cn/api/coding/paas/v4' && v.protocol === 'openai'));
  assert.ok(alts.some((v) => v.baseUrl === 'https://open.bigmodel.cn/api/anthropic' && v.protocol === 'anthropic'));
  // 不含自身
  assert.ok(!alts.some((v) => v.baseUrl === 'https://open.bigmodel.cn/api/paas/v4'));
  // 未登记的厂商返回空
  assert.deepEqual(variantEndpointsFor('https://example.com/v1'), []);
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

test('discoverModels：key 被拒时自动探测订阅端点并切换', async (t) => {
  const mock = await startMockServer(18998);
  t.after(() => mock.close());

  // 按量端点 401（key 为订阅专用），传入的变体端点用同一把 key 命中
  const r = await discoverModels({
    baseUrl: 'http://127.0.0.1:18998/locked/v1',
    apiKey: 'sk-test-123',
    protocol: 'openai',
    variants: [
      { presetId: 'acme', variantId: 'coding', label: '编程订阅', baseUrl: 'http://127.0.0.1:18998/coding/v1', protocol: 'openai' },
    ],
  });
  assert.equal(r.resolvedBaseUrl, 'http://127.0.0.1:18998/coding/v1');
  assert.equal(r.matchedVariant.variantId, 'coding');
  assert.equal(r.matchedVariant.baseUrl, 'http://127.0.0.1:18998/coding/v1');
  assert.ok(r.models.some((m) => m.id === 'glm-4.7'));
  // attempts 里保留了被拒的按量端点记录
  assert.ok(r.attempts.some((a) => a.url === 'http://127.0.0.1:18998/locked/v1/models' && a.status === 401));

  // 变体端点也全部失败时，报错说明已尝试过备选端点
  await assert.rejects(
    () =>
      discoverModels({
        baseUrl: 'http://127.0.0.1:18998/locked/v1',
        apiKey: 'sk-test-123',
        protocol: 'openai',
        variants: [
          { presetId: 'acme', variantId: 'coding', label: '编程订阅', baseUrl: 'http://127.0.0.1:18998/locked2/v1', protocol: 'openai' },
        ],
      }),
    /API Key 无效.*已自动尝试/,
  );
});
