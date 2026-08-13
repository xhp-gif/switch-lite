// SwitchLite 桌面壳：在 Electron 主进程内启动 Web 服务与本地中继，
// 并用原生窗口加载界面。打包后用户无需安装 Node.js。
import { app, BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { startRelay } from '../server/relay.js';
import { ensureRelay } from '../server/relayLauncher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_PORT = Number(process.env.PORT || 4174);
const isSmokeTest = process.argv.includes('--smoke-test');
// 开机自启模式：只跑中继，不开窗口（由「设置 → 开机自动启动中继」注册）
const isRelayOnly = process.argv.includes('--relay-only');

if (isRelayOnly) {
  app.whenReady().then(() => startRelay());
  // 无窗口也要保持进程存活
  app.on('window-all-closed', () => {});
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  }
}

let server;
let win;

async function startServer() {
  const expressApp = createApp();
  const port = isSmokeTest ? 0 : UI_PORT;
  await new Promise((resolve, reject) => {
    server = expressApp.listen(port, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : UI_PORT;
  return `http://127.0.0.1:${actualPort}`;
}

async function main() {
  const url = await startServer();
  if (isSmokeTest) {
    const res = await fetch(url + '/api/health');
    const body = await res.json();
    fs.writeFileSync(
      path.join(os.tmpdir(), 'switchlite-smoke.json'),
      JSON.stringify({ ok: body.ok, url, ccSwitchDetect: typeof body.ccSwitchRunning === 'boolean', argv: process.argv.slice(1) }, null, 2),
      'utf8',
    );
    app.exit(0);
    return;
  }

  try {
    // 中继以独立进程常驻：退出 SwitchLite 后 Agent 仍可使用、用量持续记录
    ensureRelay().then((r) => console.log(`[relay] ${r.status}${r.pid ? ` (pid ${r.pid})` : ''}`));
  } catch (err) {
    console.error('[relay] 启动失败:', err.message);
  }

  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    title: 'SwitchLite',
    autoHideMenuBar: true,
    backgroundColor: '#f6f7fb',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  await win.loadURL(url);
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  if (server) server.close();
});

if (!isRelayOnly) {
  app.whenReady().then(main).catch((err) => {
    dialog.showErrorBox('SwitchLite 启动失败', String(err && err.message ? err.message : err));
    app.exit(1);
  });
}
