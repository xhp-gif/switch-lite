// DeepSeek Harness 配置写入：确保带日期快照后缀的模型 ID 保留完整，
// 且供应商全部模型进入 llm-deepseek.models 目录，DSH 重启后用户所选模型仍可被
// 模型列表看到/选择（不再静默回退到不带后缀的 flash）。
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

const PROVIDER = (over = {}) => ({
  id: 'test-provider-123',
  name: '百度千帆',
  baseUrl: 'https://qianfan.baidubce.com/v2',
  apiKey: 'bce-v3/testkey',
  protocol: 'openai',
  models: [
    { id: 'deepseek-v4-flash-0731' },
    { id: 'deepseek-v4-flash' },
    { id: 'deepseek-v4-pro-0813' },
    { id: 'glm-5.2' },
  ],
  ...over,
});

test('applyDeepSeekHarness 保留模型日期快照后缀并写入 llm-deepseek.models 目录', (t) => {
  const base = tmpHome(t);
  cw.applyDeepSeekHarness(PROVIDER(), 'deepseek-v4-flash-0731');

  const p = path.join(base, '.dsh', 'settings.yaml');
  assert.ok(fs.existsSync(p), 'settings.yaml 应被创建');
  const doc = YAML.parse(fs.readFileSync(p, 'utf8'));

  // 1) 默认模型保留完整 ID
  assert.equal(doc['agent-default-model'].model, 'deepseek-v4-flash-0731', 'agent-default-model 不能丢后缀');
  assert.equal(doc.llm.model, 'deepseek-v4-flash-0731', 'llm.model 不能丢后缀');
  assert.equal(doc.model, 'deepseek-v4-flash-0731', '顶层 model 不能丢后缀');
  assert.equal(doc.defaultModel, 'deepseek-v4-flash-0731', 'defaultModel 不能丢后缀');

  // 2) 模型目录包含完整 ID + 基础 ID（DSH 回退也不会丢）
  const ids = doc['llm-deepseek'].models.map((m) => m.id);
  assert.ok(ids.includes('deepseek-v4-flash-0731'), `llm-deepseek.models 应包含 0731，实际: ${ids.join(',')}`);
  assert.ok(ids.includes('deepseek-v4-flash'), `llm-deepseek.models 应包含基础 ID deepseek-v4-flash，实际: ${ids.join(',')}`);

  // 3) 兼容旧版 harness.json
  const legacy = JSON.parse(fs.readFileSync(path.join(base, '.deepseek', 'harness.json'), 'utf8'));
  assert.equal(legacy.model, 'deepseek-v4-flash-0731');
  assert.equal(legacy.base_url, 'https://qianfan.baidubce.com/v2');
});

test('applyDeepSeekHarness 二次调用不重复添加模型目录条目', (t) => {
  const base = tmpHome(t);
  cw.applyDeepSeekHarness(PROVIDER(), 'deepseek-v4-flash-0731');
  cw.applyDeepSeekHarness(PROVIDER(), 'deepseek-v4-flash-0731');

  const p = path.join(base, '.dsh', 'settings.yaml');
  const doc = YAML.parse(fs.readFileSync(p, 'utf8'));
  const matches = doc['llm-deepseek'].models.filter((m) => m.id === 'deepseek-v4-flash-0731');
  assert.equal(matches.length, 1, '重复调用不应重复追加模型条目');
});

test('模型列表包含供应商全部抓取模型，选中模型排序最前', (t) => {
  const base = tmpHome(t);
  cw.applyDeepSeekHarness(PROVIDER(), 'glm-5.2');

  const doc = YAML.parse(fs.readFileSync(path.join(base, '.dsh', 'settings.yaml'), 'utf8'));
  const ids = doc['llm-deepseek'].models.map((m) => m.id);
  assert.equal(ids[0], 'glm-5.2', '选中模型应在模型目录第一位');
  for (const expected of ['deepseek-v4-flash-0731', 'deepseek-v4-flash', 'deepseek-v4-pro-0813', 'glm-5.2']) {
    assert.ok(ids.includes(expected), `模型目录应包含 ${expected}`);
  }
});

test('DSH 把 agent-default-model 归一化为基础 ID 后，所选模型仍在模型列表中', (t) => {
  const base = tmpHome(t);
  cw.applyDeepSeekHarness(PROVIDER(), 'deepseek-v4-flash-0731');
  const p = path.join(base, '.dsh', 'settings.yaml');
  let doc = YAML.parse(fs.readFileSync(p, 'utf8'));
  // DSH 会像这样把 agent-default-model 归一化（模拟其 restart 重写）
  doc = { ...doc, 'agent-default-model': { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' } };
  fs.writeFileSync(p, YAML.stringify(doc) + '\n');

  const after = YAML.parse(fs.readFileSync(p, 'utf8'));
  const ids = after['llm-deepseek'].models.map((m) => m.id);
  assert.ok(ids.includes('deepseek-v4-flash-0731'), 'DSH 归一化后 0731 仍在模型目录');
  assert.ok(ids.includes('deepseek-v4-flash'), 'DSH 归一化所需的基础 ID 也在模型目录');
});

test('cordis.patch.yml 持久层保留模型目录，DSH 重启/重写 settings.yaml 后模型仍在', (t) => {
  const base = tmpHome(t);
  cw.applyDeepSeekHarness(PROVIDER(), 'deepseek-v4-flash-0731');

  const patchFile = path.join(base, '.dsh', 'profiles', 'web', 'cordis.patch.yml');
  assert.ok(fs.existsSync(patchFile), 'cordis.patch.yml 应被写入');
  const rows = YAML.parse(fs.readFileSync(patchFile, 'utf8'));
  const llm = rows.find((r) => r && r.id === 'llm-deepseek');
  assert.ok(llm, 'patch 层应包含 llm-deepseek 行');
  const ids = llm.config.models.map((m) => m.id);
  assert.ok(ids.includes('deepseek-v4-flash-0731'), `patch 层模型目录应包含 0731，实际: ${ids.join(',')}`);
  assert.ok(ids.includes('deepseek-v4-flash'), 'patch 层模型目录应包含基础 ID');

  const adm = rows.find((r) => r && r.id === 'agent-default-model');
  assert.ok(adm, 'patch 层应包含 agent-default-model 行');
  assert.equal(adm.config.model, 'deepseek-v4-flash-0731', 'patch 层默认模型保留完整后缀');

  // 模拟 DSH 自己的 Settings 写入：整文档重写 settings.yaml，抹掉 llm-deepseek.models
  const settingsFile = path.join(base, '.dsh', 'settings.yaml');
  const doc = YAML.parse(fs.readFileSync(settingsFile, 'utf8'));
  const stripped = { ...doc, 'llm-deepseek': { baseURL: doc['llm-deepseek'].baseURL } }; // models 被抹掉
  fs.writeFileSync(settingsFile, YAML.stringify(stripped) + '\n');

  // patch 层不受影响，模型仍可被 DSH 选择器看到
  const rows2 = YAML.parse(fs.readFileSync(patchFile, 'utf8'));
  const llm2 = rows2.find((r) => r && r.id === 'llm-deepseek');
  const ids2 = llm2.config.models.map((m) => m.id);
  assert.ok(ids2.includes('deepseek-v4-flash-0731'), 'DSH 重写 settings.yaml 后 patch 层 0731 仍在');
  assert.ok(ids2.includes('deepseek-v4-flash'), 'DSH 重写 settings.yaml 后 patch 层基础 ID 仍在');
});

test('模型目录只保留对话模型，过滤嵌入/OCR/图片等非聊天模型', (t) => {
  const base = tmpHome(t);
  // 造一个混合模型列表：对话 + 嵌入 + OCR + 图片
  const provider = PROVIDER({
    models: [
      { id: 'deepseek-v4-flash-0731' },
      { id: 'deepseek-v4-flash' },
      { id: 'glm-5.2' },
      { id: 'embedding' },
      { id: 'bge-large-zh' },
      { id: 'deepseek-ocr' },
      { id: 'qwen-image' },
      { id: 'pp-structurev3' },
      { id: 'paddleocr-vl-0.9b' },
    ],
  });
  cw.applyDeepSeekHarness(provider, 'deepseek-v4-flash-0731');

  const doc = YAML.parse(fs.readFileSync(path.join(base, '.dsh', 'settings.yaml'), 'utf8'));
  const ids = doc['llm-deepseek'].models.map((m) => m.id);

  // 对话模型保留
  for (const keep of ['deepseek-v4-flash-0731', 'deepseek-v4-flash', 'glm-5.2']) {
    assert.ok(ids.includes(keep), `应保留对话模型 ${keep}`);
  }
  // 非对话模型剔除
  for (const drop of ['embedding', 'bge-large-zh', 'deepseek-ocr', 'qwen-image', 'pp-structurev3', 'paddleocr-vl-0.9b']) {
    assert.ok(!ids.includes(drop), `应过滤非对话模型 ${drop}`);
  }

  // patch 层同样只保留对话模型
  const patchFile = path.join(base, '.dsh', 'profiles', 'web', 'cordis.patch.yml');
  const rows = YAML.parse(fs.readFileSync(patchFile, 'utf8'));
  const llm = rows.find((r) => r && r.id === 'llm-deepseek');
  const patchIds = llm.config.models.map((m) => m.id);
  for (const drop of ['embedding', 'deepseek-ocr']) {
    assert.ok(!patchIds.includes(drop), `patch 层应过滤 ${drop}`);
  }
  assert.ok(patchIds.includes('deepseek-v4-flash-0731'), 'patch 层保留 0731');
});
