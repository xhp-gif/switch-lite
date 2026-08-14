import { spawn } from 'node:child_process';
import path from 'node:path';

const children = [];

function run(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit' });
  children.push(child);
  return child;
}

run(process.execPath, ['server/index.js']);
run(process.execPath, [path.resolve('node_modules/vite/bin/vite.js')]);

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
