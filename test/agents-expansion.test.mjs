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

  // 3. DeepSeek Harness
  const resHarness = applyConfig({ target: 'deepseek_harness', provider, modelId: 'deepseek-v3' });
  assert.ok(fs.existsSync(resHarness.file));
  const harnessJson = JSON.parse(fs.readFileSync(resHarness.file, 'utf8'));
  assert.equal(harnessJson.model, 'deepseek-v3');

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

  // 7. 自定义 Agent
  const customTargetId = 'custom_my_cli_1';
  storage.saveCustomAgents([
    {
      id: customTargetId,
      name: 'My Custom CLI',
      icon: '🤖',
      configFile: path.join(tmp, 'mycli', 'config.json'),
      format: 'json',
    },
  ]);
  const resCustom = applyConfig({ target: customTargetId, provider, modelId: 'custom-model-x' });
  assert.ok(fs.existsSync(resCustom.file));
  const customJson = JSON.parse(fs.readFileSync(resCustom.file, 'utf8'));
  assert.equal(customJson.model, 'custom-model-x');
  assert.ok(customJson.baseUrl.includes('test-provider-id-999'));

  // 清理环境
  fs.rmSync(tmp, { recursive: true, force: true });
});
