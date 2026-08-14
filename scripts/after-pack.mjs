// electron-builder afterPack 钩子：
// 本项目 win.signAndEditExecutable=false（避免 electron-builder 下载 winCodeSign 缓存，
// 其解压需要创建符号链接的管理员权限，在国内网络+普通权限下必失败）。
// 代价是 exe 保留 Electron 默认图标与版本信息——这里用 npm 版 rcedit 自己写回。
import path from 'node:path';
import { rcedit } from 'rcedit';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${pkg.build.productName}.exe`);
  await rcedit(exe, {
    icon: path.resolve('build/icon.ico'),
    'version-string': {
      ProductName: pkg.build.productName,
      FileDescription: pkg.description,
      CompanyName: 'xhp-gif',
      LegalCopyright: `Copyright © ${new Date().getFullYear()} xhp-gif`,
    },
    'file-version': pkg.version,
    'product-version': pkg.version,
  });
  console.log(`[after-pack] rcedit 已写入图标与版本信息: ${exe}`);
}
