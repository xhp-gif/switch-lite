import fs from 'fs';
import path from 'path';

const releaseDir = path.resolve('release');
if (fs.existsSync(releaseDir)) {
  for (const f of fs.readdirSync(releaseDir)) {
    if (f.endsWith('.7z')) {
      try {
        fs.unlinkSync(path.join(releaseDir, f));
      } catch {
        /* ignore */
      }
    }
  }
}
// 缓冲 1 秒释放文件句柄
await new Promise((r) => setTimeout(r, 1000));
