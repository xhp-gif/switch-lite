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

#### 分类器修复（Claude Code auto 模式）
- 精准识别 auto 模式安全分类器 sidechain 请求，本地秒回 \`<block>no</block>\`，与模型/供应商无关——换 DeepSeek / Kimi / GLM 等任意模型都不再报 "Wait a moment and then try this action again"；
- 修复中继转译流的 \`message_delta.usage\` 缺 \`input_tokens\` 导致 Claude Code 内部崩溃、分类器整会话熔断的问题；
- 识别只看系统提示词，不再扫描会话历史，彻底避免误劫持正常对话（v0.5.0 引入的回归）。

#### 中继健壮性与安全
- 上游响应头超时 90s（\`CCS_RELAY_HEADER_TIMEOUT\` 可调）：挂死网关不再让请求无限悬挂，可正常触发故障转移；
- 清理逐跳/编码头，修复 chunked 请求构造出非法上游请求、gzip 响应破坏协议转译的问题；
- \`npm start\` 网页版改绑 \`127.0.0.1\`（管理 API 含 Key，不再暴露局域网）；
- \`/models\` 只返回供应商真实模型，去掉硬编码 claude-*/glm-* 名单。

#### 协议适配器
- finish_reason 后迟到的 usage chunk 不再丢失（用量看板 input 不再为 0）；
- 图片与文本合成单条多部分消息并保留块顺序；\`tool_choice\` / \`stop_sequences\` 正确映射。

#### Codex 配置保护
- 切换供应商不再删除 \`[mcp_servers]\` 配置段；
- \`auth.json\` 合并写入 \`OPENAI_API_KEY\`，保留 ChatGPT OAuth 登录态；
- \`.bak\` 备份自动清理，每个文件只保留最近 5 份。

#### Gemini 回归
- 恢复 Gemini CLI 为可用目标（v0.4.8 起误丢），官方四角星渐变图标加入「官方支持库」按需启用。

#### 其他
- \`/api/health\` 版本号改读 package.json；\`PUT /api/settings/active\` 支持全部新 Agent 与自定义 Agent；
- 会话日志回填只消费完整行，不再丢失正在写入的事件。`,
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
