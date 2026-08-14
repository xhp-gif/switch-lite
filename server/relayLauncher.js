// 中继拉起器：确保有一个独立的中继进程在运行。
// - 已有健康中继且代码不比磁盘旧 → 直接复用
// - 中继代码已更新（磁盘文件比运行中的新）→ 结束旧进程后重拉
// - 没有中继 → 以 detached 方式拉起独立进程（主程序退出后中继仍存活）
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RELAY_PORT } from './relay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// relay-standalone.js 的路径；打包进 asar 时 Node 无法直接读取，
// electron-builder 配置 asarUnpack 后改用解包目录。
export function standalonePath() {
  const p = path.join(__dirname, 'relay-standalone.js');
  return p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

export function relayHealth(timeoutMs = 500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: RELAY_PORT, path: '/__health', timeout: timeoutMs }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(text));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 中继实际代码不止入口本身（relay.js / usage.js 等），取 server 目录里最新的 mtime 作比较
function newestServerMtime() {
  try {
    const dir = path.dirname(standalonePath());
    return Math.max(
      ...fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
        .map((f) => fs.statSync(path.join(dir, f)).mtimeMs),
    );
  } catch {
    return 0;
  }
}

// 中继 stdout/stderr 落盘：spawn 崩溃（如模块解析失败）时可在日志里看到原因
function openRelayLog() {
  try {
    const home = process.env.CCS_LITE_HOME || path.join(os.homedir(), '.cc-switch-lite');
    fs.mkdirSync(home, { recursive: true });
    const fd = fs.openSync(path.join(home, 'relay.log'), 'a');
    fs.writeFileSync(fd, `\n--- relay spawn ${new Date().toISOString()} ---\n`);
    return fd;
  } catch {
    return 'ignore';
  }
}

export async function ensureRelay() {
  const script = standalonePath();
  const mtime = newestServerMtime();

  const alive = await relayHealth();
  if (alive && alive.ok && (typeof alive.startedAt !== 'number' || alive.startedAt >= mtime)) {
    return { status: 'running', pid: alive.pid };
  }
  // 运行中的中继比磁盘代码旧：先结束再重拉
  if (alive && alive.pid) {
    try {
      process.kill(alive.pid);
    } catch {
      /* 可能已退出 */
    }
    for (let i = 0; i < 20 && (await relayHealth(200)); i++) await sleep(100);
  }

  const logFd = openRelayLog();
  const stdio = logFd === 'ignore' ? 'ignore' : ['ignore', logFd, logFd];
  const isElectron = !!process.versions.electron;
  const child = isElectron
    ? // Electron 没有独立 Node，用自身以纯 Node 模式跑脚本
      spawn(process.execPath, [script], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        detached: true,
        stdio,
      })
    : spawn(process.execPath, [script], { detached: true, stdio });
  child.unref();
  if (logFd !== 'ignore') fs.closeSync(logFd);

  for (let i = 0; i < 30; i++) {
    await sleep(100);
    const h = await relayHealth(200);
    if (h && h.ok) return { status: 'spawned', pid: h.pid };
  }
  return { status: 'failed' };
}
