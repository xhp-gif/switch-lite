import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

async function getToken() {
  return new Promise((resolve, reject) => {
    const p = spawn('git', ['credential', 'fill']);
    p.stdin.write('protocol=https\nhost=github.com\n\n');
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('credential fill failed'));
      const line = out.split('\n').find((l) => l.startsWith('password='));
      resolve(line ? line.replace('password=', '').trim() : '');
    });
  });
}

async function run() {
  const token = await getToken();
  if (!token) throw new Error('No GitHub token found in git credential manager');

  const owner = 'xhp-gif';
  const repo = 'switch-lite';
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const version = pkg.version;
  const tag = `v${version}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'SwitchLite-Release-Script',
    Accept: 'application/vnd.github.v3+json',
  };

  console.log(`[release] Checking release info for ${owner}/${repo} ${tag}...`);
  let releaseRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, { headers });
  let release;
  if (releaseRes.status === 404) {
    console.log(`[release] Creating GitHub Release for ${tag}...`);
    const body = {
      tag_name: tag,
      name: `SwitchLite v${version}`,
      body: `### SwitchLite v${version} 更新日志

#### ⚡ Cursor 内部状态库深度适配（免手动添加模型）
- **自动同步 Cursor 专属状态库 (\`state.vscdb\`)**：使用 Node.js 原生 SQLite 引擎，跨平台（Windows / macOS / Linux）自动定位并更新 Cursor 专属存储；
- **自定义模型自动注入与激活**：一键将选择的供应商模型结构注入至 \`availableDefaultModels2\`，并自动加入 \`aiSettings.modelOverrideEnabled\` 激活列表；
- **自动设为 Composer / Cmd+K 默认模型**：自动同步更新 \`featureModelConfigs\`，无需在 Cursor 设置中每次手动输入添加模型；
- **双通道安全机制**：同步更新 \`settings.json\` 与 \`state.vscdb\`，独占锁定时静默降级保护。

#### 🤖 DeepSeek Harness (DSH) 官方生态深度适配
- **凭据热同步与规范写入**：遵循 DSH \`version: 1\` 标准规范写入 \`~/.dsh/.credentials.yaml\` 与 \`~/.dsh/settings.yaml\`，并提供运行时 RPC（\`/api/credentials.set\` 与 \`/api/settings.update\`）无缝热生效与实时落盘；
- **原生文件夹选择器回退**：解除 Windows 下原生文件夹选择弹窗的静默隐藏限制，并自动提供 PowerShell 原生 \`FolderBrowserDialog\` 稳定回退；
- **全链路工具兼容与用量统计**：DSH 经 SwitchLite 转发后自动完成严格网关工具清洗与鉴权透传，支持深度思考流（Reasoning）与 Token 精准统计。

#### 🎨 官方 Agent 库与交互体验升级
- **大厂质感设计**：官方支持库重构为垂直卡片式下拉面板，去掉横向滚动条，单屏一览无余；
- **官方高精度 SVG 图标库**：扩充包含 Cursor、Grok、Gemini、DeepSeek、Tare、QCoder、ZCode 等在内的全新品牌矢量图标。`,
      draft: false,
      prerelease: false,
    };
    const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    release = await createRes.json();
    console.log(`[release] Created release ID: ${release.id}`);
  } else {
    release = await releaseRes.json();
    console.log(`[release] Found existing release ID: ${release.id}`);
  }

  const uploadUrlTemplate = release.upload_url;
  if (!uploadUrlTemplate) throw new Error(`No upload_url in release response: ${JSON.stringify(release)}`);

  const releaseDir = path.resolve('release');
  const filesToUpload = [
    `SwitchLite Setup ${version}.exe`,
    `SwitchLite-Portable-${version}.exe`,
    'latest.yml',
    `SwitchLite Setup ${version}.exe.blockmap`,
  ];

  for (const file of filesToUpload) {
    const filePath = path.join(releaseDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`[release] Skipping missing file: ${file}`);
      continue;
    }

    // 动态获取最新资产列表并使用归一化文件名匹配（GitHub 会把空格转为点号）
    const assetsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${release.id}/assets`, { headers });
    const assetsList = await assetsRes.json();
    const norm = (s) => String(s || '').toLowerCase().replace(/[\s\.-]+/g, '');
    const existingAsset = Array.isArray(assetsList) ? assetsList.find((a) => norm(a.name) === norm(file)) : null;
    if (existingAsset) {
      console.log(`[release] Deleting existing asset: ${existingAsset.name} (id: ${existingAsset.id})...`);
      await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${existingAsset.id}`, {
        method: 'DELETE',
        headers,
      });
      await new Promise((r) => setTimeout(r, 1000));
    }

    const fileSizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
    console.log(`[release] Uploading ${file} (${fileSizeMb} MB)...`);
    const uploadUrl = uploadUrlTemplate.replace('{?name,label}', '') + `?name=${encodeURIComponent(file)}`;
    const fileBuffer = fs.readFileSync(filePath);
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'SwitchLite-Release-Script',
        'Content-Type': file.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
        'Content-Length': fileBuffer.length,
      },
      body: fileBuffer,
    });
    const uploadResult = await uploadRes.json();
    if (uploadRes.status >= 200 && uploadRes.status < 300) {
      console.log(`[release] ✓ Uploaded ${file} successfully (asset ID: ${uploadResult.id})`);
    } else {
      console.error(`[release] ✗ Failed uploading ${file}:`, uploadResult);
    }
  }

  console.log('[release] All release assets successfully uploaded to GitHub!');
}

run().catch((e) => {
  console.error('[release] Error:', e);
  process.exit(1);
});
