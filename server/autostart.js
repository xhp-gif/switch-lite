// 开机自动启动中继（Windows 注册表 Run 键）：
// 注册后每次登录系统都会以完全静默（无黑框、无弹窗）模式拉起中继，不开 SwitchLite 窗口 Agent 也能用。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { standalonePath } from './relayLauncher.js';

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const VALUE_NAME = 'SwitchLiteRelay';

export function autostartSupported() {
  return process.platform === 'win32';
}

function ensureSilentVbs() {
  const home = process.env.CCS_LITE_HOME || path.join(os.homedir(), '.cc-switch-lite');
  fs.mkdirSync(home, { recursive: true });
  const vbsPath = path.join(home, 'silent-relay.vbs');

  const exec = process.execPath;
  const isElectron = !!process.versions.electron;
  // 桌面版：SwitchLite.exe --relay-only；网页版（node 运行）：node.exe relay-standalone.js
  const cmd = isElectron ? `""${exec}"" --relay-only` : `""${exec}"" ""${standalonePath()}""`;

  const vbsContent = [
    `' SwitchLite Silent Relay Autostart (No Window / No Popup)`,
    `Set WshShell = CreateObject("WScript.Shell")`,
    `WshShell.Run "${cmd}", 0, False`,
    `Set WshShell = Nothing`,
  ].join('\r\n');

  fs.writeFileSync(vbsPath, vbsContent, 'utf8');
  return vbsPath;
}

function autostartCommand() {
  // 使用 Windows 原生无窗宿主 wscript.exe 执行静默 VBS 脚本（0=隐藏运行）
  const vbs = ensureSilentVbs();
  return `wscript.exe "${vbs}"`;
}

function reg(args) {
  return new Promise((resolve, reject) => {
    execFile('reg', args, { timeout: 5000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

export async function getRelayAutostart() {
  if (!autostartSupported()) return { supported: false, enabled: false };
  try {
    const out = await reg(['query', RUN_KEY, '/v', VALUE_NAME]);
    return { supported: true, enabled: String(out).includes(VALUE_NAME) };
  } catch {
    return { supported: true, enabled: false };
  }
}

export async function setRelayAutostart(enabled) {
  if (!autostartSupported()) throw new Error('仅支持 Windows');
  if (enabled) {
    await reg(['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', autostartCommand(), '/f']);
  } else {
    try {
      await reg(['delete', RUN_KEY, '/v', VALUE_NAME, '/f']);
    } catch {
      /* 本就不存在 */
    }
  }
  return getRelayAutostart();
}
