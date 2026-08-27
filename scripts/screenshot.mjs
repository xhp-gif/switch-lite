// 开发辅助：无头打开 SwitchLite 页面并截图（临时工具）
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

const out = arg('out', path.join(__dirname, '..', 'ui-preview.png'));
const width = Number(arg('width', '1180'));
const height = Number(arg('height', '800'));
const logFile = arg('log', path.join(os.tmpdir(), 'switchlite-shot.log'));
const action = arg('action', '');

const log = (msg) => {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch {
    /* ignore */
  }
};

log('start');

app.disableHardwareAcceleration();
const guard = setTimeout(() => {
  log('timeout');
  app.exit(2);
}, 30000);

let serverInstance;

app.whenReady().then(async () => {
  log('ready');
  const server = createApp();
  const PORT = 4198;
  await new Promise((resolve) => {
    serverInstance = server.listen(PORT, '127.0.0.1', resolve);
  });
  log('server listening on ' + PORT);

  const win = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  log('window created');
  await win.loadURL(`http://127.0.0.1:${PORT}`);
  log('loaded');
  await new Promise((r) => setTimeout(r, 1200));

  if (action === 'edit_modal') {
    // Click on the first edit button
    await win.webContents.executeJavaScript(`(() => {
      const editBtns = [...document.querySelectorAll('.btn')].filter((b) => b.textContent.includes('编辑'));
      if (editBtns.length > 0) editBtns[0].click();
    })()`);
    await new Promise((r) => setTimeout(r, 800));
  } else if (action === 'edit_modal_all') {
    await win.webContents.executeJavaScript(`(() => {
      const editBtns = [...document.querySelectorAll('.btn')].filter((b) => b.textContent.includes('编辑'));
      if (editBtns.length > 0) editBtns[0].click();
    })()`);
    await new Promise((r) => setTimeout(r, 600));
    await win.webContents.executeJavaScript(`(() => {
      const tabs = [...document.querySelectorAll('.tab')].filter((t) => t.textContent.includes('全部'));
      if (tabs.length > 0) tabs[0].click();
    })()`);
    await new Promise((r) => setTimeout(r, 400));
  } else if (action === 'quick_fetch') {
    // Fill URL and Key and fetch
    await win.webContents.executeJavaScript(`(() => {
      const inputs = document.querySelectorAll('.form-grid input');
      if (inputs.length >= 2) {
        inputs[0].value = 'https://api.deepseek.com';
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await new Promise((r) => setTimeout(r, 500));
  }

  const image = await win.webContents.capturePage();
  log('captured');
  fs.writeFileSync(out, image.toPNG());
  console.log(`saved ${out} (${width}x${height})`);
  log('saved');
  if (serverInstance) serverInstance.close();
  clearTimeout(guard);
  app.exit(0);
}).catch((err) => {
  console.error(err);
  log('error: ' + (err && err.message ? err.message : String(err)));
  if (serverInstance) serverInstance.close();
  clearTimeout(guard);
  app.exit(1);
});
