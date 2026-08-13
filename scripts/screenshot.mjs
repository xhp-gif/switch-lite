// 开发辅助：无头打开 SwitchLite 页面并截图（临时工具）
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

const out = arg('out', path.join(__dirname, '..', 'ui-preview.png'));
const width = Number(arg('width', '1180'));
const height = Number(arg('height', '800'));
const url = arg('url', 'http://127.0.0.1:4174');
const logFile = arg('log', path.join(os.tmpdir(), 'switchlite-shot.log'));
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

app.whenReady().then(async () => {
  log('ready');
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  log('window created');
  await win.loadURL(url);
  log('loaded');
  await new Promise((r) => setTimeout(r, 1500));
  const diag = await win.webContents.executeJavaScript(`(() => {
    const sideItems = [...document.querySelectorAll('.side-item.agent')];
    const svgs = [...document.querySelectorAll('.side-item.agent svg')];
    const active = document.querySelector('.side-item.agent.active');
    const headIcon = document.querySelector('.agent-head-icon svg');
    const main = document.querySelector('.main');
    const card = document.querySelector('.card');
    return {
      title: document.title,
      sideItems: sideItems.map((el) => el.textContent.replace(/\\s+/g, ' ').trim()),
      svgCount: svgs.length,
      hermesImg: (() => {
        const img = document.querySelector('.side-item.agent img');
        return img ? { loaded: img.naturalWidth > 0, size: img.naturalWidth + 'x' + img.naturalHeight } : null;
      })(),
      ccWarning: !!document.querySelector('.cc-switch-warning'),
      brandImg: !!document.querySelector('.brand img'),
      topbarAgent: document.querySelector('.topbar-agent span:last-child')?.textContent || null,
      sideBrandImg: !!document.querySelector('.side-brand-mark img'),
      emptyIcon: !!document.querySelector('.empty svg'),
      activeName: active ? active.querySelector('.side-name')?.textContent : null,
      activeTileBg: active ? getComputedStyle(active.querySelector('.agent-tile')).backgroundColor : null,
      headIcon: headIcon ? headIcon.getAttribute('viewBox') : null,
      mainVisible: main ? main.getBoundingClientRect().height : null,
      cardVisible: card ? card.getBoundingClientRect().height : null,
      bodyOverflow: document.body.scrollHeight > window.innerHeight,
    };
  })()`);
  console.log(JSON.stringify(diag, null, 2));
  log('diag ok');
  if (arg('click', '')) {
    await win.webContents.executeJavaScript(`(() => {
      const el = [...document.querySelectorAll('.side-item.agent')].find((x) => x.textContent.startsWith(${JSON.stringify(arg('click', ''))}));
      el?.click();
      return !!el;
    })()`);
    await new Promise((r) => setTimeout(r, 700));
    const after = await win.webContents.executeJavaScript(`(() => ({
      active: document.querySelector('.side-item.agent.active .side-name')?.textContent,
      h1: document.querySelector('.agent-head h1')?.textContent,
      configHint: document.querySelector('.agent-head .hint')?.textContent,
      quickTitle: document.querySelector('.quick-card h3')?.textContent,
    }))()`);
    console.log('AFTER_CLICK ' + JSON.stringify(after));
    log('click ok');
  }
  const image = await win.webContents.capturePage();
  log('captured');
  fs.writeFileSync(out, image.toPNG());
  console.log(`saved ${out} (${width}x${height})`);
  log('saved');
  clearTimeout(guard);
  app.exit(0);
}).catch((err) => {
  console.error(err);
  log('error: ' + (err && err.message ? err.message : String(err)));
  clearTimeout(guard);
  app.exit(1);
});
