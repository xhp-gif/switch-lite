// 切换失败回滚 + Claude 模型路由
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-rbhome-'));
const tmpLite = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-rblite-'));
process.env.CCS_HOME_OVERRIDE = tmpHome;
process.env.CCS_LITE_HOME = tmpLite;

const { applyConfig } = await import('../server/configWriter.js');

test('切换失败回滚：任一文件写失败，全部已改文件自动还原', (t) => {
  t.after(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpLite, { recursive: true, force: true });
  });

  // 预置：config.toml 有哨兵内容；auth.json 是目录 → writeFileAtomic 必然失败
  const codexDir = path.join(tmpHome, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  const configFile = path.join(codexDir, 'config.toml');
  fs.writeFileSync(configFile, 'personality = "sentinel"\n', 'utf8');
  fs.mkdirSync(path.join(codexDir, 'auth.json')); // 目录占位，写入必炸

  const provider = {
    id: 'rb-1',
    name: 'Rollback Test',
    target: 'codex',
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: 'sk-rb',
    protocol: 'openai',
    models: [{ id: 'm1' }],
  };

  assert.throws(() => applyConfig({ target: 'codex', provider, modelId: 'm1' }), /已自动还原/);

  assert.equal(fs.readFileSync(configFile, 'utf8'), 'personality = "sentinel"\n', 'config.toml 应原样还原');
  assert.ok(!fs.existsSync(path.join(codexDir, 'switch-lite-model-catalog.json')), '新建目录文件应被清理');
  assert.ok(!fs.existsSync(path.join(tmpLite, 'relay.json')), '新建 relay.json 应被清理');
});

test('Claude 模型路由：三档均统一指向主模型，保证 Auto 模式与打杂任务稳定可用', () => {
  const claudeFile = path.join(tmpHome, '.claude', 'settings.json');

  const multi = {
    id: 'cl-multi',
    name: 'Multi',
    target: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-m',
    protocol: 'anthropic',
    models: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }],
  };
  applyConfig({ target: 'claude', provider: multi, modelId: 'deepseek-v4-pro' });
  const s1 = JSON.parse(fs.readFileSync(claudeFile, 'utf8'));
  assert.equal(s1.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'deepseek-v4-pro');
  assert.equal(s1.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'deepseek-v4-pro');
  assert.equal(s1.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-v4-pro', 'Haiku 档应指向主选模型以防冷门模型无权限报错');

  const single = {
    id: 'cl-single',
    name: 'Single',
    target: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-s',
    protocol: 'anthropic',
    models: [{ id: 'only-model' }],
  };
  // 预置旧键，验证归一化删除
  const existing = JSON.parse(fs.readFileSync(claudeFile, 'utf8'));
  existing.env.ANTHROPIC_SMALL_FAST_MODEL = 'legacy-small';
  fs.writeFileSync(claudeFile, JSON.stringify(existing), 'utf8');

  applyConfig({ target: 'claude', provider: single, modelId: 'only-model' });
  const s2 = JSON.parse(fs.readFileSync(claudeFile, 'utf8'));
  assert.equal(s2.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'only-model');
  assert.equal(s2.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'only-model');
  assert.equal(s2.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'only-model', '单模型厂商三档同指主模型');
  assert.ok(!('ANTHROPIC_SMALL_FAST_MODEL' in s2.env), '旧 SMALL_FAST 键应被删除');
});
