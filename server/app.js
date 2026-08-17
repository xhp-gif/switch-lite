import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VENDOR_PRESETS, getPreset } from './presets.js';
import { discoverModels, authFor, inferProviderHint } from './registry.js';
import * as storage from './storage.js';
import { applyConfig, configStatus } from './configWriter.js';
import { summarizeUsage, clearUsage, readUsage } from './usage.js';
import { syncSessionLogs, resetSessionSync } from './sessionLogs.js';
import { speedtestProvider } from './speedtest.js';
import { getRelayAutostart, setRelayAutostart } from './autostart.js';
import { relayHealth, ensureRelay, restartRelay } from './relayLauncher.js';
import { RELAY_PORT, RELAY_ORIGIN } from './relay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');

// 检测原版 CC Switch 是否在运行：它会持续回写 Codex 配置，
// 与 SwitchLite 同时使用时会把刚写入的配置覆盖掉。
function ccSwitchRunning() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    execFile('tasklist', ['/FI', 'IMAGENAME eq cc-switch.exe', '/NH'], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(/cc-switch\.exe/i.test(stdout));
    });
  });
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  // 启动时先合并历史遗留的重复供应商，避免列表混乱
  storage.mergeDuplicateProviders();

  // 会话日志回填：启动时全量增量一次，之后每 60s 增量扫描。
  // 双通道统计：中继计量为主，Agent 本地日志兜底（中继停机/接入前历史不留空洞）。
  try {
    syncSessionLogs();
    const timer = setInterval(() => {
      try {
        syncSessionLogs();
      } catch {
        /* best-effort */
      }
    }, 60_000);
    timer.unref?.();
  } catch {
    /* 日志解析失败不影响主服务 */
  }

  app.get('/api/health', async (req, res) => {
    res.json({ ok: true, version: '0.4.6', ccSwitchRunning: await ccSwitchRunning() });
  });

  app.get('/api/presets', (req, res) => {
    res.json(VENDOR_PRESETS);
  });

  app.get('/api/settings', (req, res) => {
    res.json(storage.getSettings());
  });

  app.put('/api/settings', (req, res) => {
    res.json(storage.updateSettings(req.body || {}));
  });

  app.put('/api/settings/active', (req, res) => {
    const { target, providerId } = req.body || {};
    if (!['claude', 'codex', 'gemini', 'opencode', 'hermes'].includes(target)) {
      return res.status(400).json({ error: '未知 Agent' });
    }
    if (providerId && !storage.getProvider(providerId)) {
      return res.status(404).json({ error: '供应商不存在' });
    }
    res.json(storage.setActiveProvider(target, providerId || null));
  });

  app.get('/api/providers', (req, res) => {
    res.json(storage.listProviders());
  });

  app.post('/api/providers', (req, res) => {
    const provider = storage.createProvider(req.body || {});
    res.status(201).json(provider);
  });

  app.put('/api/providers/:id', (req, res) => {
    const provider = storage.updateProvider(req.params.id, req.body || {});
    if (!provider) return res.status(404).json({ error: '供应商不存在' });
    res.json(provider);
  });

  app.delete('/api/providers/:id', (req, res) => {
    const ok = storage.removeProvider(req.params.id);
    if (!ok) return res.status(404).json({ error: '供应商不存在' });
    res.json({ ok: true });
  });

  // 智能推导供应商预设与协议
  app.post('/api/infer', (req, res) => {
    const { url = '', apiKey = '' } = req.body || {};
    res.json(inferProviderHint({ url, apiKey }) || {});
  });

  // 直接按 URL 试抓模型（未保存的供应商也可用）
  app.post('/api/fetch-models', async (req, res) => {
    try {
      const { baseUrl, apiKey = '', protocol = 'openai' } = req.body || {};
      const result = await discoverModels({ baseUrl, apiKey, protocol });
      res.json({ ...result, count: result.models.length });
    } catch (err) {
      res.status(400).json({ error: err.message, attempts: err.attempts || null, manualFallback: err.manualFallback || false });
    }
  });

  app.post('/api/providers/:id/fetch-models', async (req, res) => {
    const provider = storage.getProvider(req.params.id);
    if (!provider) return res.status(404).json({ error: '供应商不存在' });
    try {
      const result = await discoverModels({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey || '',
        protocol: provider.protocol,
      });
      const updated = storage.updateProvider(provider.id, {
        baseUrl: result.resolvedBaseUrl || provider.baseUrl,
        models: result.models,
        fetchedAt: new Date().toISOString(),
        lastFetchError: null,
      });
      res.json({ provider: updated, ...result, count: result.models.length });
    } catch (err) {
      const updated = storage.updateProvider(provider.id, { lastFetchError: err.message });
      res.status(400).json({ error: err.message, attempts: err.attempts || null, provider: updated, manualFallback: err.manualFallback || false });
    }
  });

  // 测速：对模型列表端点做热身+计时 GET，结果存到 provider.lastSpeedtest
  app.post('/api/providers/:id/speedtest', async (req, res) => {
    const provider = storage.getProvider(req.params.id);
    if (!provider) return res.status(404).json({ error: '供应商不存在' });
    const result = await speedtestProvider(provider);
    const updated = storage.updateProvider(provider.id, {
      lastSpeedtest: { at: new Date().toISOString(), ok: result.ok, latencyMs: result.latencyMs, error: result.error || null },
    });
    res.json({ ...result, provider: updated });
  });

  // 一键测全部
  app.post('/api/speedtest', async (req, res) => {
    const providers = storage.listProviders();
    const entries = await Promise.allSettled(
      providers.map(async (p) => {
        const result = await speedtestProvider(p);
        storage.updateProvider(p.id, {
          lastSpeedtest: { at: new Date().toISOString(), ok: result.ok, latencyMs: result.latencyMs, error: result.error || null },
        });
        return { id: p.id, ...result };
      }),
    );
    const results = {};
    for (const e of entries) {
      if (e.status === 'fulfilled') results[e.value.id] = e.value;
    }
    res.json({ results, providers: storage.listProviders() });
  });

  app.post('/api/config/apply', async (req, res) => {
    try {
      const { providerId, target, modelId } = req.body || {};
      const provider = storage.getProvider(providerId);
      if (!provider) return res.status(404).json({ error: '供应商不存在' });
      const mid = modelId || provider.selectedModel;
      const result = applyConfig({ target, provider, modelId: mid });
      storage.updateProvider(providerId, {
        selectedModel: mid,
        lastApplied: { target, at: new Date().toISOString() },
      });
      storage.setActiveProvider(target, providerId);
      storage.recordHistory(target, providerId, mid);
      const ccRunning = await ccSwitchRunning();
      res.json({
        ...result,
        warning: ccRunning
          ? '检测到原版 CC Switch 正在运行，它会把 Codex 配置改回去。请先完全退出 CC Switch（托盘图标 → 退出）再使用。'
          : null,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 切换历史：接入记录 + 中继实际调用记录，按模型去重
  app.get('/api/history', (req, res) => {
    const target = String(req.query.target || '');
    if (!['claude', 'codex', 'gemini', 'opencode', 'hermes'].includes(target)) {
      return res.status(400).json({ error: '未知 Agent' });
    }
    res.json({ history: storage.getHistory(target, readUsage()) });
  });

  app.get('/api/config/status', (req, res) => {
    res.json(configStatus());
  });

  // 用量看板：days=7/30/0(全部)；查询前机缘性做一次日志增量同步（不阻塞，失败静默）
  app.get('/api/usage/summary', (req, res) => {
    try {
      syncSessionLogs();
    } catch {
      /* best-effort */
    }
    const days = Number(req.query.days ?? 7);
    res.json(summarizeUsage(Number.isFinite(days) && days >= 0 ? days : 7));
  });

  app.delete('/api/usage', (req, res) => {
    clearUsage();
    resetSessionSync(); // 标记全部日志已读，避免清空后历史又被回填
    res.json({ ok: true });
  });

  // 开机自动启动中继（Windows Run 键）
  app.get('/api/relay/autostart', async (req, res) => {
    res.json(await getRelayAutostart());
  });

  app.put('/api/relay/autostart', async (req, res) => {
    try {
      res.json(await setRelayAutostart(!!req.body?.enabled));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 中继状态检测与控制
  app.get('/api/relay/status', async (req, res) => {
    const health = await relayHealth(800);
    const autostart = await getRelayAutostart();
    const running = Boolean(health && health.ok);
    res.json({
      ok: true,
      running,
      pid: health?.pid || null,
      startedAt: health?.startedAt ? new Date(health.startedAt).toISOString() : null,
      uptimeSec: health?.startedAt ? Math.max(0, Math.floor((Date.now() - health.startedAt) / 1000)) : 0,
      port: RELAY_PORT,
      origin: RELAY_ORIGIN,
      autostart: autostart.supported ? autostart.enabled : false,
      autostartSupported: autostart.supported,
    });
  });

  app.post('/api/relay/restart', async (req, res) => {
    try {
      const result = await restartRelay();
      const health = await relayHealth(1000);
      const running = Boolean(health && health.ok);
      res.json({
        ok: running,
        status: result.status,
        pid: health?.pid || null,
        startedAt: health?.startedAt ? new Date(health.startedAt).toISOString() : null,
        uptimeSec: health?.startedAt ? Math.max(0, Math.floor((Date.now() - health.startedAt) / 1000)) : 0,
        port: RELAY_PORT,
        origin: RELAY_ORIGIN,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/relay/start', async (req, res) => {
    try {
      const result = await ensureRelay();
      const health = await relayHealth(1000);
      const running = Boolean(health && health.ok);
      res.json({
        ok: running,
        status: result.status,
        pid: health?.pid || null,
        startedAt: health?.startedAt ? new Date(health.startedAt).toISOString() : null,
        uptimeSec: health?.startedAt ? Math.max(0, Math.floor((Date.now() - health.startedAt) / 1000)) : 0,
        port: RELAY_PORT,
        origin: RELAY_ORIGIN,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use((err, req, res, next) => {
    if (err) {
      res.status(400).json({ error: err.message || '请求错误' });
      return;
    }
    next();
  });

  return app;
}
