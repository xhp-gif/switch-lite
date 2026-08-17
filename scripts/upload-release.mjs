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

- **智能 URL 自动补全与 API Key 指纹感知**：
  - 自动识别纯域名补齐 \`https://\`，自动清洗 \`/chat/completions\` 等动作路径；
  - 根据 Key 前缀（如 \`bce-v3/\`、\`sk-ant-\`、\`AIza\`、\`sk-or-v1-\`）与域名特征自动感知厂商与协议；
- **端点探针自适应扫描与 Base URL 自动校准 (Self-Healing)**：
  - 探测多候选端点，成功命中后自动将 Base URL 修正并持久化为有效版本路径，彻底避免 404；
- **「编辑供应商」内嵌模型选择器与手动模型 ID 兜底接入**：
  - 点击「保存并重新获取」即刻在弹窗内展开可用模型列表；
  - 针对关闭了 \`/models\` 接口的网关，支持直接手动填入任意模型 ID 极简直连；
- **中继健壮性增强与容错兜底**：
  - 自动将千帆等厂商的 \`/v1\` 路径纠偏为 \`/v2\`；
  - 增加已删除/过期供应商 ID 自动回退至活跃供应商机制，规避 Claude Code 缓存导致 502；
  - Claude Auto 模式三档路由统一对齐主模型，解决分类器打杂任务报错。`,
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
