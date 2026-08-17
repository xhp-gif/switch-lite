import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { startMockServer } from './mock-model-server.mjs';

test('API 全链路：供应商 CRUD -> 获取模型 -> 应用配置', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-test-'));
  process.env.CCS_LITE_HOME = tmp;
  process.env.CCS_HOME_OVERRIDE = tmp;
  process.env.HERMES_HOME = path.join(tmp, 'hermes-home');

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const mock = await startMockServer();
  t.after(() => {
    server.close();
    mock.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const post = (url, body) =>
    fetch(base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  // 0. 预置一份带其他配置段的 config.toml，验证合并时保留原段且顶层键在最前
  const codexDir = path.join(tmp, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexDir, 'config.toml'),
    'personality = "test"\n\n[custom_section]\nenabled = true\n\n[mcp_servers.node_repl]\ncommand = "node"\n',
    'utf8',
  );

  // 1. 创建供应商（OpenAI 兼容）
  const createdRes = await post('/api/providers', {
    name: 'Mock 中转',
    presetId: 'custom',
    target: 'codex',
    baseUrl: 'http://127.0.0.1:18999/v1',
    apiKey: 'sk-test-1',
    protocol: 'openai',
    wireApi: 'chat',
  });
  assert.equal(createdRes.status, 201);
  const created = await createdRes.json();
  assert.ok(created.id);
  assert.equal(created.baseUrl, 'http://127.0.0.1:18999/v1');

  // 2. 从 URL 获取模型
  const fetchRes = await post(`/api/providers/${created.id}/fetch-models`, {});
  assert.equal(fetchRes.status, 200);
  const fetched = await fetchRes.json();
  assert.ok(fetched.provider.models.length >= 5);
  assert.equal(fetched.endpoint, 'http://127.0.0.1:18999/v1/models');

  // 3. 选择模型并应用到 Codex CLI
  const modelId = fetched.provider.models[0].id;
  const applyRes = await post('/api/config/apply', { providerId: created.id, target: 'codex', modelId });
  assert.equal(applyRes.status, 200);
  const applied = await applyRes.json();
  assert.ok(applied.file.includes('.codex'));
  const toml = fs.readFileSync(path.join(tmp, '.codex', 'config.toml'), 'utf8');
  assert.ok(toml.includes(`model = "${modelId}"`));
  assert.ok(toml.includes('[model_providers.custom]'), 'Codex 应使用固定 custom 供应商 ID 以统一会话历史');
  assert.ok(toml.includes('wire_api = "responses"'), 'Codex 自定义供应商必须使用 responses 协议');
  assert.ok(toml.includes('web_search = "disabled"'), '第三方网关兼容：应禁用内置 web 搜索工具');
  assert.ok(toml.includes('multi_agent = false'), '第三方网关兼容：应关闭多智能体 namespace 工具');
  assert.ok(toml.includes('requires_openai_auth = true'), 'Codex 应通过 auth.json 提供供应商 key');
  assert.ok(toml.includes('127.0.0.1:4180'), 'Codex 应通过本地中继访问上游');
  const auth = JSON.parse(fs.readFileSync(path.join(tmp, '.codex', 'auth.json'), 'utf8'));
  assert.equal(auth.OPENAI_API_KEY, 'sk-test-1');
  const relay = JSON.parse(fs.readFileSync(path.join(tmp, 'relay.json'), 'utf8'));
  assert.equal(relay.upstream, 'http://127.0.0.1:18999');
  assert.equal(relay.apiKey, 'sk-test-1');
  assert.ok(toml.includes('model_catalog_json'));
  assert.ok(toml.includes('personality = "test"'), '原有顶层键应保留');
  assert.ok(toml.includes('[custom_section]'), '原有配置段应保留');
  assert.ok(!toml.includes('mcp_servers'), '第三方网关兼容：应剥离 MCP 服务器段（其 namespace 工具会被网关拒绝）');
  assert.ok(toml.indexOf('model =') < toml.indexOf('[custom_section]'), 'model 顶层键应位于所有表格之前');
  assert.ok(toml.indexOf('model_provider =') < toml.indexOf('[custom_section]'), 'model_provider 顶层键应位于所有表格之前');
  assert.ok(toml.indexOf('model_catalog_json =') < toml.indexOf('[custom_section]'), 'model_catalog_json 顶层键应位于所有表格之前');
  const catalog = JSON.parse(fs.readFileSync(path.join(tmp, '.codex', 'switch-lite-model-catalog.json'), 'utf8'));
  assert.ok(Array.isArray(catalog.models));
  assert.ok(catalog.models.some((m) => m.slug === modelId));

  // 4. 再次应用，旧的 csl 段应被替换而不是重复
  await post('/api/config/apply', { providerId: created.id, target: 'codex', modelId: fetched.provider.models[1].id });
  const toml2 = fs.readFileSync(path.join(tmp, '.codex', 'config.toml'), 'utf8');
  assert.ok(toml2.includes(`model = "${fetched.provider.models[1].id}"`));
  const providerBlocks = toml2.match(/\[model_providers\.custom\]/g) || [];
  assert.equal(providerBlocks.length, 1);

  // 4.5 应用后该 Agent 的当前供应商应被记录
  const settings = await fetch(`${base}/api/settings`).then((r) => r.json());
  assert.equal(settings.active.codex, created.id);

  // 5. Anthropic 协议供应商才能应用到 Claude Code
  const claudeRes = await post('/api/providers', {
    name: 'Mock Claude',
    presetId: 'custom',
    target: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-test',
    protocol: 'anthropic',
  });
  const claude = await claudeRes.json();
  const claudeApply = await post('/api/config/apply', { providerId: claude.id, target: 'claude', modelId: 'claude-sonnet-4' });
  assert.equal(claudeApply.status, 200);
  const claudeSettings = JSON.parse(fs.readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8'));
  assert.equal(claudeSettings.env.ANTHROPIC_BASE_URL, `http://127.0.0.1:4180/p/${claude.id}`, 'Claude Code 应经本地中继访问上游（按供应商计量用量）');
  assert.equal(claudeSettings.env.ANTHROPIC_MODEL, 'claude-sonnet-4');
  assert.equal(claudeSettings.model, undefined, '不应写顶层 model 字段以防拦截第三方模型名');

  // 6. OpenAI 兼容供应商应用到 Claude Code（经中继自动转译协议）
  const openAIForClaude = await post('/api/config/apply', { providerId: created.id, target: 'claude', modelId });
  assert.equal(openAIForClaude.status, 200);
  const openAIClaudeSettings = JSON.parse(fs.readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8'));
  assert.equal(openAIClaudeSettings.env.ANTHROPIC_BASE_URL, `http://127.0.0.1:4180/p/${created.id}`);

  // 6.5 Gemini CLI：仅 Gemini 协议可写入
  const geminiRes = await post('/api/providers', {
    name: 'Mock Gemini',
    presetId: 'gemini',
    target: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'AIza-test',
    protocol: 'gemini',
  });
  const gemini = await geminiRes.json();
  const geminiApply = await post('/api/config/apply', { providerId: gemini.id, target: 'gemini', modelId: 'gemini-2.5-pro' });
  assert.equal(geminiApply.status, 200);
  const geminiSettings = JSON.parse(fs.readFileSync(path.join(tmp, '.gemini', 'settings.json'), 'utf8'));
  assert.equal(geminiSettings.model, 'gemini-2.5-pro');
  assert.equal(geminiSettings.env.GEMINI_API_KEY, 'AIza-test');
  assert.equal(geminiSettings.env.GOOGLE_GEMINI_BASE_URL, `http://127.0.0.1:4180/p/${gemini.id}`, 'Gemini CLI 应经本地中继访问上游');

  const badGemini = await post('/api/config/apply', { providerId: created.id, target: 'gemini', modelId });
  assert.equal(badGemini.status, 400);
  assert.match((await badGemini.json()).error, /Gemini/);

  // 6.6 清空当前供应商
  await fetch(`${base}/api/settings/active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'codex', providerId: null }),
  });
  const settings2 = await fetch(`${base}/api/settings`).then((r) => r.json());
  assert.ok(!settings2.active.codex);

  // 6.7 OpenCode：写入 provider + model 引用，并保留已有配置
  const ocDir = path.join(tmp, '.config', 'opencode');
  fs.mkdirSync(ocDir, { recursive: true });
  fs.writeFileSync(
    path.join(ocDir, 'opencode.json'),
    JSON.stringify({ provider: { myexisting: { npm: '@ai-sdk/openai-compatible' } }, model: 'myexisting/x' }, null, 2),
  );
  const ocRes = await post('/api/providers', {
    name: 'OpenCode Test',
    presetId: 'custom',
    target: 'opencode',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-oc-1',
    protocol: 'openai',
  });
  const oc = await ocRes.json();
  const ocApply = await post('/api/config/apply', { providerId: oc.id, target: 'opencode', modelId: 'deepseek-chat' });
  assert.equal(ocApply.status, 200);
  const ocConfig = JSON.parse(fs.readFileSync(path.join(ocDir, 'opencode.json'), 'utf8'));
  assert.equal(ocConfig.model, 'opencode-test/deepseek-chat');
  assert.equal(ocConfig.provider['opencode-test'].npm, '@ai-sdk/openai-compatible');
  assert.equal(ocConfig.provider['opencode-test'].options.baseURL, `http://127.0.0.1:4180/p/${oc.id}`, 'OpenCode 应经本地中继访问上游');
  assert.equal(ocConfig.provider['opencode-test'].options.apiKey, 'sk-oc-1');
  assert.ok(ocConfig.provider['opencode-test'].models['deepseek-chat']);
  assert.ok(ocConfig.provider.myexisting, '已有的 provider 应被保留');

  const ocAnthropic = await post('/api/providers', {
    name: 'OC Claude',
    presetId: 'anthropic',
    target: 'opencode',
    apiKey: 'sk-ant-oc',
    protocol: 'anthropic',
  });
  const ocA = await ocAnthropic.json();
  const ocAApply = await post('/api/config/apply', { providerId: ocA.id, target: 'opencode', modelId: 'claude-sonnet-4' });
  assert.equal(ocAApply.status, 200);
  const ocAConfig = JSON.parse(fs.readFileSync(path.join(ocDir, 'opencode.json'), 'utf8'));
  assert.equal(ocAConfig.provider.anthropic.npm, '@ai-sdk/anthropic');
  assert.equal(ocAConfig.model, 'anthropic/claude-sonnet-4');

  // 6.8 Hermes Agent：写入 model + custom_providers，并保留其它段
  const hermesDir = path.join(tmp, 'hermes-home');
  fs.mkdirSync(hermesDir, { recursive: true });
  fs.writeFileSync(
    path.join(hermesDir, 'config.yaml'),
    [
      '# Hermes config',
      'agent:',
      '  max_turns: 50',
      '  reasoning_effort: "high"',
      '',
      'mcp_servers:',
      '  filesystem:',
      '    command: npx',
      '    args: ["-y", "@modelcontextprotocol/server-filesystem"]',
      '',
    ].join('\n'),
    'utf8',
  );
  const hermesRes = await post('/api/providers', {
    name: 'Hermes DeepSeek',
    presetId: 'deepseek',
    target: 'hermes',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-hermes-1',
    protocol: 'openai',
  });
  assert.equal(hermesRes.status, 201);
  const hermes = await hermesRes.json();
  const hermesApply = await post('/api/config/apply', {
    providerId: hermes.id,
    target: 'hermes',
    modelId: 'deepseek-chat',
  });
  assert.equal(hermesApply.status, 200);
  const hermesYaml = fs.readFileSync(path.join(hermesDir, 'config.yaml'), 'utf8');
  assert.ok(hermesYaml.includes('default: deepseek-chat'), 'Hermes model.default 应写入选中模型');
  assert.ok(hermesYaml.includes('provider: deepseek'), 'Hermes model.provider 应指向供应商 key');
  assert.ok(hermesYaml.includes('name: deepseek'), 'custom_providers 应包含供应商');
  assert.ok(hermesYaml.includes('api_key: sk-hermes-1'), 'custom_providers 应写入 API Key');
  assert.ok(hermesYaml.includes(`base_url: http://127.0.0.1:4180/p/${hermes.id}`), 'Hermes base_url 应指向本地中继');
  assert.ok(hermesYaml.includes('mcp_servers:'), 'Hermes 其它段（mcp_servers）应保留');
  assert.ok(hermesYaml.includes('max_turns: 50'), 'Hermes 其它段（agent）应保留');
  assert.ok(hermesYaml.includes('# Hermes config'), 'Hermes 文件注释应保留');

  // 再次应用应更新同一条记录，而不是重复追加
  await post('/api/config/apply', { providerId: hermes.id, target: 'hermes', modelId: 'deepseek-reasoner' });
  const hermesYaml2 = fs.readFileSync(path.join(hermesDir, 'config.yaml'), 'utf8');
  assert.ok(hermesYaml2.includes('default: deepseek-reasoner'));
  assert.equal((hermesYaml2.match(/name: deepseek/g) || []).length, 1, '切换模型不应重复追加供应商');

  // 7. 中继状态接口
  const relayRes = await fetch(`${base}/api/relay/status`).then((r) => r.json());
  assert.equal(relayRes.ok, true);
  assert.equal(typeof relayRes.running, 'boolean');
  assert.equal(relayRes.port, 4180);

  // 8. 删除
  const del = await fetch(`${base}/api/providers/${created.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const list = await fetch(`${base}/api/providers`).then((r) => r.json());
  assert.ok(!list.some((p) => p.id === created.id));
});
