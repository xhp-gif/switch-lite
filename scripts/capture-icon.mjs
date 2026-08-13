// 开发辅助：从主图标 build/icon.png 派生网页版 logo（src/assets/logos/switchlite.png）
// 注意：图标主文件是 build/icon.png（源自 exe 内原图重着色），不要再用 SVG 渲染覆盖它。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await sharp(path.join(root, 'build', 'icon.png'))
  .resize(256, 256)
  .png({ compressionLevel: 9 })
  .toFile(path.join(root, 'src', 'assets', 'logos', 'switchlite.png'));
console.log('saved src/assets/logos/switchlite.png');
