// DeepSeek Harness 配置写入：确保带日期快照后缀的模型 ID 保留完整，
// 且同步进 llm-deepseek.models 目录（否则 DSH 新建会话会静默回退到不带后缀的 flash）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-dsh-'));
process.env.CCS_HOME_OVERRIDE = tmp;

const cw = await import('../server/configWriter.js');

test('applyDeepSeekHarness 保留模型日期快照后缀并写入 llm-deepseek.models 目录', (t) => {
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const provider = {
    id: 'test-provider-123',
    name: '百度千帆',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    apiKey: 'bce-v3/testkey',
    protocol: 'openai',
  };
  cw.applyDeepSeekHarness(provider, 'deepseek-v4-flash-0731');

  const p = path.join(tmp, '.dsh', 'settings.yaml');
  assert.ok(fs.existsSync(p), 'settings.yaml 应被创建');
  const doc = YAML.parse(fs.readFileSync(p, 'utf8'));

  // 1) 默认模型保留完整 ID
  assert.equal(doc['agent-default-model'].model, 'deepseek-v4-flash-0731', 'agent-default-model 不能丢后缀');
  assert.equal(doc.llm.model, 'deepseek-v4-flash-0731', 'llm.model 不能丢后缀');
  assert.equal(doc.model, 'deepseek-v4-flash-0731', '顶层 model 不能丢后缀');
  assert.equal(doc.defaultModel, 'deepseek-v4-flash-0731', 'defaultModel 不能丢后缀');

  // 2) 模型目录包含完整 ID（DSH 建会话不再回退）
  const ids = doc['llm-deepseek'].models.map((m) => m.id);
  assert.ok(ids.includes('deepseek-v4-flash-0731'), `llm-deepseek.models 应包含 0731，实际: ${ids.join(',')}`);

  // 3) 兼容旧版 harness.json
  const legacy = JSON.parse(fs.readFileSync(path.join(tmp, '.deepseek', 'harness.json'), 'utf8'));
  assert.equal(legacy.model, 'deepseek-v4-flash-0731');
  assert.equal(legacy.base_url, 'https://qianfan.baidubce.com/v2');
});

test('applyDeepSeekHarness 二次调用不重复添加模型目录条目', (t) => {
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const provider = {
    id: 'test-provider-456',
    name: '百度千帆',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    apiKey: 'bce-v3/testkey',
    protocol: 'openai',
  };
  cw.applyDeepSeekHarness(provider, 'deepseek-v4-flash-0731');
  cw.applyDeepSeekHarness(provider, 'deepseek-v4-flash-0731');

  const p = path.join(tmp, '.dsh', 'settings.yaml');
  const doc = YAML.parse(fs.readFileSync(p, 'utf8'));
  const matches = doc['llm-deepseek'].models.filter((m) => m.id === 'deepseek-v4-flash-0731');
  assert.equal(matches.length, 1, '重复调用不应重复追加模型条目');
});
