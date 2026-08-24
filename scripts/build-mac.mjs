// SwitchLite macOS 交叉打包脚本（Windows → macOS .app / .zip）
// 使用官方 electron-packager，产出标准 symlink 结构（Versions/Current -> A），
// 避免旧的手写脚本把符号链接复制成实体导致体积膨胀 ~2 倍。
//
// 用法：
//   node scripts/build-mac.mjs                  # arm64 + x64 都打包
//   node scripts/build-mac.mjs arm64            # 只打 arm64
//   node scripts/build-mac.mjs x64              # 只打 x64
//   node scripts/build-mac.mjs arm64 --upload   # 打包并上传到 GitHub Release
//
// 前置条件：
//   - Windows 需开启「开发者模式」（允许创建符号链接，否则 electron-packager 报 error 1314）
//   - --upload 需要本机 git credential manager 里有 github.com 的凭据

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const APP_NAME = PKG.build?.productName || 'SwitchLite';
const OUT_DIR = path.resolve(ROOT, 'release-mac');
const PACKAGER_OUT = path.join(os.tmpdir(), 'switchlite-packager-' + Date.now());

// ---------- 工具 ----------

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    console.error(`❌ 命令失败: ${cmd} ${args.join(' ')}`);
    if (r.stderr) console.error(r.stderr);
    process.exit(r.status ?? 1);
  }
  return r;
}

// 递归删除（处理符号链接：Windows 下 rmSync 对含 symlink 的目录树会 EPERM）
function rmTree(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return; }
  if (st.isSymbolicLink()) { try { fs.unlinkSync(p); } catch {} return; }
  if (st.isDirectory()) {
    let items = [];
    try { items = fs.readdirSync(p); } catch { return; }
    for (const it of items) rmTree(path.join(p, it));
    try { fs.rmdirSync(p); } catch {}
  } else {
    try { fs.unlinkSync(p); } catch {}
  }
}

// ---------- 1. 构建前端 ----------

function buildFrontend() {
  console.log('\n[1/4] 构建前端 (vite build)...');
  run(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
    cwd: ROOT,
    env: { ...process.env, CI: 'true' },
  });
  console.log('✅ 前端构建完成');
}

// ---------- 2. electron-packager 打包 .app ----------

function packageApp(arch) {
  const outApp = path.join(PACKAGER_OUT, `SwitchLite-darwin-${arch}`, `${APP_NAME}.app`);
  if (fs.existsSync(outApp)) rmTree(outApp);

  console.log(`\n[2/4] electron-packager 打包 darwin ${arch}...`);
  // 与手动验证的命令保持一致（忽略与打包无关的目录，prune devDependencies）
  const args = [
    path.join(ROOT, 'node_modules', '@electron', 'packager', 'bin', 'electron-packager.mjs'),
    ROOT,
    APP_NAME,
    '--platform=darwin',
    `--arch=${arch}`,
    `--out=${PACKAGER_OUT}`,
    '--overwrite',
    '--prune=true',
    '--ignore=^\/(\\.git|test|release|release-mac|_packager|\\.build-tmp|electron-mac-extract|scripts|\\.github|\\.work-tmp)',
    '--ignore=\\.(bak|obsolete)$',
  ];
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`❌ electron-packager 失败 (arch=${arch})`);
    console.error('   提示：Windows 上需要开启「开发者模式」以创建符号链接。');
    process.exit(r.status ?? 1);
  }
  if (!fs.existsSync(outApp)) {
    console.error(`❌ 未找到打包产物: ${outApp}`);
    process.exit(1);
  }
  console.log(`✅ ${APP_NAME}.app (${arch}) 打包完成`);
  return outApp;
}

// ---------- 3. tar 打包 zip（保留符号链接） ----------

async function zipApp(arch) {
  const cwd = path.join(PACKAGER_OUT, `SwitchLite-darwin-${arch}`);
  const zipPath = path.join(OUT_DIR, `${APP_NAME}-${VERSION}-darwin-${arch}.zip`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });

  console.log(`\n[3/4] 打包 zip (tar 保留 symlink)...`);
  const r = spawnSync('tar', ['-a', '-c', '-f', zipPath, `${APP_NAME}.app`], { cwd, encoding: 'utf8', stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    console.error('❌ tar 打包失败');
    process.exit(r.status ?? 1);
  }
  const size = (fs.statSync(zipPath).size / 1048576).toFixed(1);
  console.log(`✅ ${path.basename(zipPath)} (${size} MB)`);
  return zipPath;
}

// ---------- 4. 上传到 GitHub Release ----------

async function getToken() {
  const p = spawnSync('git', ['credential', 'fill'], { cwd: ROOT, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const line = (p.stdout || '').split('\n').find((l) => l.startsWith('password='));
  return line ? line.replace('password=', '').trim() : '';
}

async function uploadAsset(rel, filePath, headers) {
  const fileName = path.basename(filePath);
  const assetsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${rel.id}/assets`, { headers });
  const assetsList = await assetsRes.json();
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s.\-]+/g, '');
  const existing = Array.isArray(assetsList) ? assetsList.find((a) => norm(a.name) === norm(fileName)) : null;
  if (existing) {
    console.log(`[release] 删除旧资产 ${existing.name}...`);
    await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${existing.id}`, { method: 'DELETE', headers });
    await new Promise((r) => setTimeout(r, 1000));
  }
  const buf = fs.readFileSync(filePath);
  const uploadUrl = rel.upload_url.replace('{?name,label}', '') + '?name=' + encodeURIComponent(fileName);
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length },
    body: buf,
  });
  const out = await res.json();
  if (res.status >= 200 && res.status < 300) {
    console.log(`✅ 上传 ${fileName} (${(buf.length / 1048576).toFixed(1)} MB) -> asset id ${out.id}`);
  } else {
    console.error(`❌ 上传 ${fileName} 失败: ${res.status}`, JSON.stringify(out).slice(0, 300));
  }
}

const owner = 'xhp-gif';
const repo = 'switch-lite';

async function uploadAll(zips) {
  console.log('\n[4/4] 上传到 GitHub Release...');
  const token = await getToken();
  if (!token) {
    console.error('❌ 未找到 GitHub 凭据（git credential manager 中无 github.com token）');
    process.exit(1);
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'SwitchLite-Release-Script',
    Accept: 'application/vnd.github+json',
  };
  const tag = `v${VERSION}`;
  let rel = await (await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, { headers })).json();
  if (rel.id == null) {
    console.log(`[release] 创建 Release ${tag}...`);
    rel = await (await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: tag, name: `SwitchLite v${VERSION}`, draft: false, prerelease: false }),
    })).json();
  }
  for (const z of zips) await uploadAsset(rel, z, headers);
  console.log('\n🎉 全部上传完成');
}

// ---------- main ----------

async function main() {
  const argv = process.argv.slice(2);
  const wanted = argv.filter((a) => !a.startsWith('--'));
  const doUpload = argv.includes('--upload');
  const archs = wanted.length ? wanted : ['arm64', 'x64'];
  const valid = new Set(['arm64', 'x64']);
  for (const a of archs) {
    if (!valid.has(a)) {
      console.error(`❌ 不支持的架构: ${a} (可选 arm64 / x64)`);
      process.exit(1);
    }
  }

  console.log(`\n=== SwitchLite macOS 打包 v${VERSION} (${archs.join(' + ')}) ===\n`);
  const start = Date.now();

  buildFrontend();
  const zips = [];
  for (const arch of archs) {
    packageApp(arch);
    const zip = await zipApp(arch);
    zips.push(zip);
  }

  // 清理中间产物（symlink 可能导致 EPERM，失败仅警告）
  if (fs.existsSync(PACKAGER_OUT)) {
    try {
      rmTree(PACKAGER_OUT);
    } catch (e) {
      console.warn('⚠️ 清理中间产物失败（可手动删除 _packager）:', e.message);
    }
  }

  if (doUpload) await uploadAll(zips);

  console.log(`\n✅ 完成，耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`📦 产物目录: ${OUT_DIR}\\`);
  for (const f of fs.readdirSync(OUT_DIR)) {
    const st = fs.statSync(path.join(OUT_DIR, f));
    if (st.isFile()) console.log(`   ${f}  (${(st.size / 1048576).toFixed(1)} MB)`);
  }
}

main().catch((e) => {
  console.error('❌ 脚本错误:', e);
  process.exit(1);
});
