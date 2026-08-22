import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyConfig, targets } from '../server/configWriter.js';
import * as storage from '../server/storage.js';
import { getRelayAutostart, setRelayAutostart } from '../server/autostart.js';

test('新 Agent 写入：Cursor / Grok / DeepSeek Harness / Tare / QCoder / ZCode / 自定义 Agent', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'switchlite-agent-test-'));
  process.env.CCS_HOME_OVERRIDE = tmp;
  process.env.CCS_LITE_HOME = tmp;

  const provider = {
    id: 'test-provider-id-999',
    name: '测试供应商',
    baseUrl: 'https://api.test.com/v1',
    apiKey: 'sk-test-key-12345',
    protocol: 'openai',
  };

  // 1. Cursor
  const resCursor = applyConfig({ target: 'cursor', provider, modelId: 'cursor-fast' });
  assert.ok(fs.existsSync(resCursor.file));
  const cursorJson = JSON.parse(fs.readFileSync(resCursor.file, 'utf8'));
  assert.equal(cursorJson['cursor.currentModel'], 'cursor-fast');
  assert.ok(cursorJson['cursor.openaiBaseUrl'].includes('test-provider-id-999'));

  // 2. Grok
  const resGrok = applyConfig({ target: 'grok', provider, modelId: 'grok-2-latest' });
  assert.ok(fs.existsSync(resGrok.file));
  const grokJson = JSON.parse(fs.readFileSync(resGrok.file, 'utf8'));
  assert.equal(grokJson.model, 'grok-2-latest');
  assert.ok(grokJson.api_base.includes('test-provider-id-999'));

  // 3. DeepSeek Harness (dsh settings.yaml + .credentials.yaml + direct upstream)
  const resHarness = applyConfig({ target: 'deepseek_harness', provider, modelId: 'deepseek-v3' });
  assert.ok(fs.existsSync(resHarness.file));
  const settingsYaml = fs.readFileSync(resHarness.file, 'utf8');
  assert.ok(settingsYaml.includes('test-provider-id-999'));
  assert.ok(settingsYaml.includes('model: "deepseek-v3"'));

  const credsFile = path.join(tmp, '.dsh', '.credentials.yaml');
  assert.ok(fs.existsSync(credsFile));
  const credsYaml = fs.readFileSync(credsFile, 'utf8');
  assert.ok(credsYaml.includes('DEEPSEEK_API_KEY: "sk-test-key-12345"'));

  const legacyFile = path.join(tmp, '.deepseek', 'harness.json');
  assert.ok(fs.existsSync(legacyFile));
  const harnessJson = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
  assert.equal(harnessJson.model, 'deepseek-v3');
  assert.equal(harnessJson.base_url, 'https://api.test.com/v1');

  // 4. Tare
  const resTare = applyConfig({ target: 'tare', provider, modelId: 'tare-model' });
  assert.ok(fs.existsSync(resTare.file));
  const tareJson = JSON.parse(fs.readFileSync(resTare.file, 'utf8'));
  assert.equal(tareJson.model, 'tare-model');

  // 5. QCoder
  const resQCoder = applyConfig({ target: 'qcoder', provider, modelId: 'qcoder-v1' });
  assert.ok(fs.existsSync(resQCoder.file));
  const qcoderJson = JSON.parse(fs.readFileSync(resQCoder.file, 'utf8'));
  assert.equal(qcoderJson.default_model, 'qcoder-v1');

  // 6. ZCode
  const resZCode = applyConfig({ target: 'zcode', provider, modelId: 'zcode-pro' });
  assert.ok(fs.existsSync(resZCode.file));
  const zcodeJson = JSON.parse(fs.readFileSync(resZCode.file, 'utf8'));
  assert.equal(zcodeJson.model, 'zcode-pro');

  // 7. 自定义 Agent - Kiro Agent (JSON)
  const kiroTargetId = 'custom_kiro_agent';
  storage.saveCustomAgents([
    {
      id: kiroTargetId,
      name: 'Kiro Agent',
      icon: 'kiro',
      configFile: path.join(tmp, '.kiro', 'config.json'),
      format: 'json',
    },
  ]);
  const resKiro = applyConfig({ target: kiroTargetId, provider, modelId: 'deepseek-v3' });
  assert.ok(fs.existsSync(resKiro.file));
  const kiroJson = JSON.parse(fs.readFileSync(resKiro.file, 'utf8'));
  assert.equal(kiroJson.model, 'deepseek-v3');
  assert.ok(kiroJson.baseUrl.includes('test-provider-id-999'));

  // 8. 自定义 Agent - Aider (YAML)
  const aiderTargetId = 'custom_aider';
  storage.saveCustomAgents([
    {
      id: aiderTargetId,
      name: 'Aider',
      icon: 'aider',
      configFile: path.join(tmp, '.aider.conf.yml'),
      format: 'yaml',
    },
  ]);
  const resAider = applyConfig({ target: aiderTargetId, provider, modelId: 'claude-3-7-sonnet' });
  assert.ok(fs.existsSync(resAider.file));
  const aiderYaml = fs.readFileSync(resAider.file, 'utf8');
  assert.ok(aiderYaml.includes('model: "claude-3-7-sonnet"'));
  assert.ok(aiderYaml.includes('test-provider-id-999'));

  // 9. 自定义 Agent - Devin (TOML)
  const devinTargetId = 'custom_devin';
  storage.saveCustomAgents([
    {
      id: devinTargetId,
      name: 'Devin CLI',
      icon: 'devin',
      configFile: path.join(tmp, '.devin', 'config.toml'),
      format: 'toml',
    },
  ]);
  const resDevin = applyConfig({ target: devinTargetId, provider, modelId: 'gpt-4o' });
  assert.ok(fs.existsSync(resDevin.file));
  const devinToml = fs.readFileSync(resDevin.file, 'utf8');
  assert.ok(devinToml.includes('model = "gpt-4o"'));
  assert.ok(devinToml.includes('test-provider-id-999'));

  // 清理环境
  fs.rmSync(tmp, { recursive: true, force: true });
});

