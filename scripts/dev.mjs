import { spawn } from 'node:child_process';

const children = [];

function run(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  children.push(child);
  return child;
}

run(process.execPath, ['server/index.js']);
run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite']);

function shutdown() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
