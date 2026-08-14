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
  const tag = 'v0.4.5';

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
      name: 'SwitchLite v0.4.5',
      body: `### SwitchLite v0.4.5 更新日志

- **内置 Anthropic ↔ OpenAI 双向流式转译引擎**：
  - 彻底打通 VS Code Claude 插件 / Claude Code CLI 调用纯 OpenAI 格式模型（如百度千帆 \`glm-5.2\`、DeepSeek 官方、智谱、Moonshot 等）；
  - 支持 SSE 实时打字机流式输出、Reasoning 思考链转译以及工具调用（Tool Use）；
- **修复 Claude Code 模型可用性检测与白名单拦截**：
  - 中继端新增 \`/models\` 路由模拟拦截，通过 Claude 客户端本地可用性探测；
  - 优化 \`settings.json\` 配置写入逻辑，避免顶层字段与官方模型白名单冲突；
- **设置中新增「本地中继与服务检测」模块**：实时展示中继运行状态与 PID，支持一键「重新检测」与「重启中继」；
- **UI 风格回归 0.3.0 精简版**：紧凑型双行供应商卡片与自适应滚动条；
- **全量 34 项自动化单元与集成测试全部通过**。`,
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
    'SwitchLite Setup 0.4.5.exe',
    'SwitchLite-Portable-0.4.5.exe',
    'latest.yml',
    'SwitchLite Setup 0.4.5.exe.blockmap',
  ];

  for (const file of filesToUpload) {
    const filePath = path.join(releaseDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`[release] Skipping missing file: ${file}`);
      continue;
    }

    const existingAsset = release.assets?.find((a) => a.name === file);
    if (existingAsset) {
      console.log(`[release] Deleting existing asset: ${file} (id: ${existingAsset.id})...`);
      await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${existingAsset.id}`, {
        method: 'DELETE',
        headers,
      });
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
