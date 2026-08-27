// DeepSeek Harness 配置写入：验证 llm-pi-ai 多厂商多模型增量管理、
// 独立 BaseURL 隔离、快照后缀保留以及 cordis.patch.yml 持久层。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

const cw = await import('../server/configWriter.js');

function tmpHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-dsh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.CCS_HOME_OVERRIDE = dir;
  return dir;
}

const PROVIDER_BAIDU = (over = {}) => ({
  id: 'baidu-provider-id',
  name: '百度千帆',
  presetId: 'baidu',
  baseUrl: 'https://qianfan.baidubce.com/v2',
  apiKey: 'bce-v3/testkey',
  protocol: 'openai',
  models: [
    { id: 'deepseek-v4-flash-0731' },
    { id: 'deepseek-v4-flash' },
    { id: 'deepseek-v4-pro-0813' },
  ],
  ...over,
});

const PROVIDER_SENSENOVA = (over = {}) => ({
  id: 'sensenova-provider-id',
  name: '商汤日日新',
  presetId: 'custom',
  baseUrl: 'https://token.sensenova.cn/v1',
  apiKey: 'sk-sensenova-testkey',
  protocol: 'openai',
  models: [
    { id: 'glm-5.2' },
    { id: 'glm-5.3' },
  ],
  ...over,
});

test('applyDeepSeekHarness 保留模型日期快照后缀并写入 llm-pi-ai.providers 目录', (t) => {
  const base = tmpHome(t);
  cw.applyDeepSeekHarness(PROVIDER_BAIDU(), 'deepseek-v4-flash-0731');

  const p = path.join(base, '.dsh', 'settings.yaml');
  assert.ok(fs.existsSync(p), 'settings.yaml 应被创建');
  const doc = YAML.parse(fs.readFileSync(p, 'utf8'));

  // 1) 默认模型指向对应 providerKey 与完整 model ID
  const providerKey = cw.dshProviderKey(PROVIDER_BAIDU());
  assert.equal(doc['agent-default-model'].provider, providerKey);
  assert.equal(doc['agent-default-model'].model, 'deepseek-v4-flash-0731');
  assert.equal(doc.llm.model, 'deepseek-v4-flash-0731');
  assert.equal(doc.model, 'deepseek-v4-flash-0731');

  // 2) llm-pi-ai.providers 中包含该厂商条目与完整 ID + 基础 ID
  assert.ok(doc['llm-pi-ai']?.providers?.[providerKey], '应包含该厂商配置');
  const providerEntry = doc['llm-pi-ai'].providers[providerKey];
  assert.equal(providerEntry.displayName, '百度千帆');
  assert.equal(providerEntry.api, 'openai-completions');
  const ids = providerEntry.models.map((m) => m.id);
  assert.ok(ids.includes('deepseek-v4-flash-0731'), `应包含 0731，实际: ${ids.join(',')}`);
  assert.ok(ids.includes('deepseek-v4-flash'), `应包含基础 ID deepseek-v4-flash，实际: ${ids.join(',')}`);

  // 3) 凭据文件写入
  const credsFile = path.join(base, '.dsh', '.credentials.yaml');
  assert.ok(fs.existsSync(credsFile), '.credentials.yaml 应被创建');
  const creds = YAML.parse(fs.readFileSync(credsFile, 'utf8'));
  assert.equal(creds.refs.DEEPSEEK_API_KEY, 'bce-v3/testkey');
});

test('applyDeepSeekHarness 同厂商增量追加新模型且不重复', (t) => {
  const base = tmpHome(t);
  const providerKey = cw.dshProviderKey(PROVIDER_BAIDU());

  // 第一次接入 flash-0731
  cw.applyDeepSeekHarness(PROVIDER_BAIDU(), 'deepseek-v4-flash-0731');
  // 第二次接入 pro-0813
  cw.applyDeepSeekHarness(PROVIDER_BAIDU(), 'deepseek-v4-pro-0813');
  // 第三次重复接入 pro-0813
  cw.applyDeepSeekHarness(PROVIDER_BAIDU(), 'deepseek-v4-pro-0813');

  const p = path.join(base, '.dsh', 'settings.yaml');
  const doc = YAML.parse(fs.readFileSync(p, 'utf8'));
  const models = doc['llm-pi-ai'].providers[providerKey].models;
  const ids = models.map((m) => m.id);

  assert.ok(ids.includes('deepseek-v4-flash-0731'), '应保留此前接入的 0731');
  assert.ok(ids.includes('deepseek-v4-pro-0813'), '应新增 0813');
  assert.equal(ids[0], 'deepseek-v4-pro-0813', '最近选中的模型应排在最前');

  const duplicates = ids.filter((id) => id === 'deepseek-v4-pro-0813');
  assert.equal(duplicates.length, 1, '重复接入不应产生重复模型项');
});

test('多厂商增量共存：先后接入百度千帆与商汤日日新，各自拥有独立 BaseURL', (t) => {
  const base = tmpHome(t);
  const baiduKey = cw.dshProviderKey(PROVIDER_BAIDU());
  const sensenovaKey = cw.dshProviderKey(PROVIDER_SENSENOVA());

  // 先接入百度千帆
  cw.applyDeepSeekHarness(PROVIDER_BAIDU(), 'deepseek-v4-flash-0731');
  // 再接入商汤日日新
  cw.applyDeepSeekHarness(PROVIDER_SENSENOVA(), 'glm-5.2');

  const p = path.join(base, '.dsh', 'settings.yaml');
  const doc = YAML.parse(fs.readFileSync(p, 'utf8'));
  const providers = doc['llm-pi-ai'].providers;

  // 1) 两个厂商共存
  assert.ok(providers[baiduKey], '应保留百度千帆');
  assert.ok(providers[sensenovaKey], '应包含商汤日日新');

  // 2) 各自 BaseURL 互不干扰（绑定各自 provider.id）
  assert.notEqual(providers[baiduKey].baseURL, providers[sensenovaKey].baseURL, '各厂商应有独立 BaseURL 中继路由');
  assert.ok(providers[baiduKey].baseURL.includes('baidu-provider-id'));
  assert.ok(providers[sensenovaKey].baseURL.includes('sensenova-provider-id'));

  // 3) 当前激活模型指向最后接入的商汤
  assert.equal(doc['agent-default-model'].provider, sensenovaKey);
  assert.equal(doc['agent-default-model'].model, 'glm-5.2');
});

test('cordis.patch.yml 持久层完整保留多厂商目录', (t) => {
  const base = tmpHome(t);
  const baiduKey = cw.dshProviderKey(PROVIDER_BAIDU());
  const sensenovaKey = cw.dshProviderKey(PROVIDER_SENSENOVA());

  cw.applyDeepSeekHarness(PROVIDER_BAIDU(), 'deepseek-v4-flash-0731');
  cw.applyDeepSeekHarness(PROVIDER_SENSENOVA(), 'glm-5.2');

  const patchFile = path.join(base, '.dsh', 'profiles', 'web', 'cordis.patch.yml');
  assert.ok(fs.existsSync(patchFile), 'cordis.patch.yml 应被写入');
  const rows = YAML.parse(fs.readFileSync(patchFile, 'utf8'));

  const llmRow = rows.find((r) => r && r.id === 'llm-pi-ai');
  assert.ok(llmRow, 'patch 层应包含 llm-pi-ai 行');
  assert.ok(llmRow.config.providers[baiduKey], 'patch 层应包含百度千帆');
  assert.ok(llmRow.config.providers[sensenovaKey], 'patch 层应包含商汤日日新');

  const admRow = rows.find((r) => r && r.id === 'agent-default-model');
  assert.equal(admRow.config.provider, sensenovaKey);
  assert.equal(admRow.config.model, 'glm-5.2');
});
