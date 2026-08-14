// 切换历史：接入记录 + 用量记录合并，按模型去重
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-hist-'));
process.env.CCS_LITE_HOME = tmp;

const storage = await import('../server/storage.js');

test('切换历史：按模型去重、最新在前、已删除供应商标记不可用、用量补充', (t) => {
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const p1 = storage.createProvider({ name: '千帆', target: 'codex', baseUrl: 'http://a/v1', apiKey: 'k1', protocol: 'openai' });
  const p2 = storage.createProvider({ name: 'GLM', target: 'codex', baseUrl: 'http://b/v1', apiKey: 'k2', protocol: 'openai' });

  storage.recordHistory('codex', p1.id, 'deepseek-v4-pro');
  storage.recordHistory('codex', p2.id, 'glm-5.2');
  storage.recordHistory('codex', p1.id, 'deepseek-v4-pro'); // 重复：应提到最前且只有一条

  const usage = [
    { ts: '2026-08-14T01:00:00Z', target: 'codex', providerId: p1.id, model: 'deepseek-v4-flash', total: 10 },
    { ts: '2026-08-14T02:00:00Z', target: 'codex', providerId: 'deleted-id', providerName: '已删厂商', model: 'old-model', total: 10 },
    { ts: '2026-08-14T03:00:00Z', target: 'claude', providerId: p1.id, model: 'claude-x', total: 10 }, // 别的 Agent，不应出现
  ];

  const h = storage.getHistory('codex', usage);
  assert.deepEqual(
    h.map((x) => x.model),
    ['deepseek-v4-pro', 'glm-5.2', 'old-model', 'deepseek-v4-flash'],
    '同一模型只留一条，接入记录优先于用量补充',
  );
  assert.equal(h[0].providerName, '千帆');
  assert.equal(h.find((x) => x.model === 'old-model').available, false, '已删除供应商的历史标记不可用');
  assert.equal(h.find((x) => x.model === 'old-model').providerName, '已删厂商');
  assert.equal(h.find((x) => x.model === 'deepseek-v4-flash').available, true);
});
