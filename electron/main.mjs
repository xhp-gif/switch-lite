// SwitchLite 桌面壳：在 Electron 主进程内启动 Web 服务与本地中继，
// 并用原生窗口加载界面。打包后用户无需安装 Node.js。
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
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
} else if (!isSmokeTest) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  }
}

let server;
let win;

// ---------- 自动更新（GitHub Releases，仅安装版；便携版不支持原地更新） ----------
const isPortable = !!process.env.PORTABLE_EXECUTABLE_FILE;
const updaterSupported = app.isPackaged && !isPortable && !isSmokeTest && !isRelayOnly;
let updateDownloadedVersion = null;

function updaterLog(line) {
  try {
    const dir = path.join(os.homedir(), '.cc-switch-lite');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'updater.log'), `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch {
    /* 日志失败静默 */
  }
}

function sendUpdateStatus(status) {
  if (win && !win.isDestroyed()) win.webContents.send('switchlite:update-status', status);
}

async function setupUpdater() {
  if (!updaterSupported) return;
  const { autoUpdater } = await import('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.logger = { info: (m) => updaterLog(`info ${m}`), warn: (m) => updaterLog(`warn ${m}`), error: (m) => updaterLog(`error ${m}`), debug: () => {} };

  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    updaterLog(`发现新版本 ${info.version}，开始下载`);
    sendUpdateStatus({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'latest' }));
  autoUpdater.on('download-progress', (p) => sendUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('error', (err) => {
    updaterLog(`更新失败: ${err && err.message}`);
    sendUpdateStatus({ state: 'error', message: err && err.message ? String(err.message) : '检查更新失败' });
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloadedVersion = info.version;
    updaterLog(`v${info.version} 已下载，待重启安装`);
    sendUpdateStatus({ state: 'downloaded', version: info.version });
    dialog
      .showMessageBox(win, {
        type: 'info',
        title: '更新就绪',
        message: `SwitchLite v${info.version} 已下载完成`,
        detail: '重启应用即可完成更新。用量与供应商配置不受影响。',
        buttons: ['立即重启更新', '稍后'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  ipcMain.handle('switchlite:check-update', async () => {
    if (updateDownloadedVersion) return { state: 'downloaded', version: updateDownloadedVersion };
    try {
      await autoUpdater.checkForUpdates();
      return { state: 'checking' };
    } catch (err) {
      return { state: 'error', message: err && err.message ? String(err.message) : '检查更新失败' };
    }
  });
  ipcMain.handle('switchlite:quit-and-install', () => {
    if (updateDownloadedVersion) autoUpdater.quitAndInstall();
  });

  // 启动后检查一次，之后每 4 小时静默复查
  autoUpdater.checkForUpdates().catch((err) => updaterLog(`启动检查失败: ${err && err.message}`));
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4 * 3600 * 1000).unref();
}

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
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.setMenuBarVisibility(false);
  await win.loadURL(url);
  setupUpdater().catch((err) => updaterLog(`updater 初始化失败: ${err && err.message}`));
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
