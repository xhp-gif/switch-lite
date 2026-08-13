// 开机自动启动中继（Windows 注册表 Run 键）：
// 注册后每次登录系统都会以 --relay-only 模式拉起中继，不开 SwitchLite 窗口 Agent 也能用。
import { execFile } from 'node:child_process';
import { standalonePath } from './relayLauncher.js';

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const VALUE_NAME = 'SwitchLiteRelay';

export function autostartSupported() {
  return process.platform === 'win32';
}

function autostartCommand() {
  // 桌面版：exe 以 --relay-only 启动；网页版（node 运行）：直接用 node 跑独立中继脚本
  if (process.versions.electron) return `"${process.execPath}" --relay-only`;
  return `"${process.execPath}" "${standalonePath()}"`;
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
