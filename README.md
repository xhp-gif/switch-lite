# SwitchLite（开发代号：cc-switch-lite）

更简洁的 LLM 供应商切换器。目标是对标 cc-switch，但把「根据 URL 自动发现模型」这件事做扎实：

- 先选 Agent（Codex CLI / Claude Code / Gemini CLI / OpenCode / Hermes Agent），再填 Base URL 和 API Key，自动获取模型后一键接入——和 cc-switch 一致的 agent-first 流程，但更少步骤。
- 粘贴任意形式的 Base URL（`https://api.deepseek.com`、`https://xxx/v1`、甚至完整的 `/v1/chat/completions` 地址），自动归一化并尝试候选端点，无需手选协议路径。
- 支持 OpenAI / Anthropic / Gemini 三类协议，内置阿里云百炼、DeepSeek、智谱 GLM、Moonshot Kimi、OpenRouter、硅基流动、火山方舟、Ollama 等预设。
- 阿里云百炼这类模型特别多的厂商，默认展示「推荐」视图（DeepSeek / GLM / Kimi / 通义千问等常用系列），而不是把几百个模型一次性砸给你；需要时切到「全部」。
- 供应商按 Agent 隔离管理，接入即写入对应配置并设为当前，写入前自动备份原文件；**切换是事务式的**——多文件写入任一失败自动全部还原，不会留下"半新半旧"的配置。
- 侧栏「设置」里可切换 浅色 / 深色 / 跟随系统 三种界面主题。
- 所有 Agent 的请求经本地中继（`127.0.0.1:4180`）转发到真实供应商：中继按供应商注入鉴权、为严格网关剥离不兼容工具，并顺带计量每次调用的 token 用量——「设置 → 用量看板」里按厂商 / 模型查看请求数、输入输出 tokens、失败数与最近调用。**中继是独立常驻进程**：SwitchLite 启动时拉起后，即使关闭窗口 Agent 也照常可用、用量持续记录；「设置」里还可开启「开机自动启动中继」（Windows 登录后自动拉起，无需先开 SwitchLite）。
- **故障自动切换**：当前供应商超时 / 限流（429）/ 服务端故障（5xx）时，自动改用同一 Agent 下接入了相同模型的其他供应商；连续失败 3 次的供应商熔断 2 分钟。设置里可关。
- **双通道用量统计**：中继计量为主（含真实耗时、状态码、供应商归属），同时离线解析 Codex / Claude Code / Gemini CLI 的本地会话日志回填——中继停机期间、接入之前的历史也不留空洞，已与中继记录自动去重。OpenCode 用量存于 SQLite，暂不支持回填。
- **测速**：供应商卡片一键测速（对 API 端点热身+计时），卡片上按延迟分色显示，方便选型。
- **Claude 模型路由**：接入时自动写入 `ANTHROPIC_DEFAULT_HAIKU/SONNET/OPUS_MODEL`——统一对齐为用户所选模型，避免打杂任务或 Auto 模式自动猜测未授权小模型报错，兼顾稳定性与兼容性。
- **自动更新**（安装版）：启动时和每 4 小时检查 GitHub Releases，下载完成后提示重启更新；「设置 → 关于」里也可手动检查。便携版不支持原地更新，请下载新版覆盖。

## 快速开始

```bash
npm install
npm run dev
```

打开 http://127.0.0.1:9527 即可使用。生产模式：

```bash
npm run build
npm start          # 访问 http://127.0.0.1:4174
```

## 模型获取的核心思路

`server/registry.js` 是纯逻辑模块，不依赖 UI，可单独测试：

1. **URL 归一化**（`normalizeBaseUrl`）：去掉结尾 `/`、`/models`、`/chat/completions`、`/responses` 等，得到干净的 Base。
2. **候选端点**（`buildModelCandidates`）：
   - OpenAI 兼容：`{base}/models` → `{base}/v1/models` → `{base}/api/v1/models` → `{base}/api/models`
   - Anthropic：`{base}/models`（`x-api-key` 头）
   - Gemini：`{base}/models`（`x-goog-api-key` 头）
   - 本地 Ollama：额外尝试 `{origin}/api/tags`
   - DashScope 原生路径（`/api/v1`）：自动补试 `/compatible-mode/v1/models`
3. **响应解析**（`parseModels`）：兼容 `data[].id`（OpenAI/Anthropic）、`models[].name`（Gemini/Ollama）、`models/` 前缀剥离、去重。
4. **推荐降噪**（`buildRecommendations`）：预设常用系列（deepseek / glm / kimi / qwen / minimax / xiaomi…）+ 抓取结果的按系列自动归类。预设数据在 `server/presets.js`，可以随时增改。

模型请求由 Node 后端发起，不存在浏览器 CORS 问题；API Key 只在你的本机流转。

## 目录结构

```text
server/
  presets.js        # 供应商预设：URL、协议、鉴权、常用模型
  registry.js       # URL 归一化 + 模型发现 + 推荐分组（核心，可单测）
  storage.js        # 供应商数据持久化（~/.cc-switch-lite/providers.json）
  usage.js          # 用量统计存储与聚合（~/.cc-switch-lite/usage.jsonl）
  sessionLogs.js    # 会话日志回填：解析 Codex/Claude/Gemini 本地会话，增量同步+与中继去重
  speedtest.js      # 供应商测速（热身+计时 GET 模型端点）
  configWriter.js   # 写 Claude Code / Codex CLI 等配置，带自动备份与失败回滚；地址指向本地中继
  hermesConfig.js   # 读写 Hermes Agent 的 config.yaml（YAML，保留注释与其它段）
  relay.js          # 本地中继：/p/<供应商id> 按供应商转发 + 鉴权注入 + 工具剥离 + token 计量
  relayLauncher.js  # 中继拉起器：健康检查 + detached 独立进程（主程序退出后仍存活）
  relay-standalone.js # 中继独立进程入口
  autostart.js      # 开机自动启动中继（Windows Run 键）
  app.js            # Express API
src/                # React + Vite 前端（设置弹窗：主题切换 + 用量看板）
test/               # node:test 单元 + 全链路测试
```

## 配置写入说明

- **Codex（CLI / 桌面端）**：写入 `~/.codex/config.toml` 的 `model`、`model_provider = "custom"` 和 `[model_providers.custom]` 段。固定用 `custom` 这个 ID（与 cc-switch 一致），Codex 才会把不同供应商的会话放在同一个历史列表里。鉴权走 `~/.codex/auth.json` 的 `OPENAI_API_KEY`（写入前自动备份）；请求经本地中继 `127.0.0.1:4180/p/<供应商id>` 转发，中继注入真实 key、为千帆等严格网关剥离 `namespace` / `custom` / `web_search` 工具并计量用量。会保留文件里其它用户配置，只替换我们管理的键。
- **Claude Code**：写入 `~/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL`（指向本地中继）/ `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`，并写入 `ANTHROPIC_DEFAULT_HAIKU/SONNET/OPUS_MODEL` 三档模型路由。供应商必须是 Anthropic 协议，或在「编辑供应商」里填写 Anthropic 兼容地址（如阿里云百炼的 `https://dashscope.aliyuncs.com/apps/anthropic`）。
- **Gemini CLI**：写入 `~/.gemini/settings.json` 的 `model` 与 `env.GEMINI_API_KEY`、`env.GOOGLE_GEMINI_BASE_URL`（指向本地中继），仅支持 Gemini 协议的供应商。
- **OpenCode**：写入 `~/.config/opencode/opencode.json` 的 `provider` 与 `model`，按协议自动选 `@ai-sdk/openai-compatible` / `@ai-sdk/anthropic` / `@ai-sdk/google`，`options.baseURL` 指向本地中继，模型引用为 `provider_id/model_id`，并保留文件里已有的其它 provider。
- **Hermes Agent**：写入 `config.yaml` 的 `model` 段与 `custom_providers` 列表（按供应商名 upsert，不重复追加），`base_url` 指向本地中继。路径解析顺序：`HERMES_HOME` 环境变量 → Windows 默认 `%LOCALAPPDATA%\hermes\config.yaml` / Mac、Linux 默认 `~/.hermes/config.yaml`。写入时保留 `mcp_servers`、`agent`、注释等其它内容。
- 每次写入前都会把原文件备份为 `.bak-时间戳`，可在 `GET /api/config/status` 看到备份列表。
- 早期版本写入的直连配置（不经中继）仍然可用，但不会产生用量统计；重新「接入」一次即切换到中转地址。

## 安全说明与路线图

- 目前 API Key 以明文存在本地 `~/.cc-switch-lite/providers.json`（和 cc-switch 相同量级）。路线图中计划改为系统钥匙串加密。
- 路线图：Claude Desktop 支持、供应商级多模型收藏、模型元数据（上下文长度等）自动补全、API Key 系统钥匙串加密、代码签名。

## 测试

```bash
npm test
```

覆盖：URL 归一化、候选端点、多协议解析、推荐分组、mock 服务端到端获取、配置写入与备份、用量聚合、四种协议的用量解析、中继转发计量全链路。

## 开发与发布流程

改功能 / 界面就在源码里改，然后照下面的流程走：

```bash
# 1) 日常开发：后端 4174 + 前端热更新
npm run dev

# 2) 改完跑自动化测试（后端逻辑保护）
npm test

# 3) 构建前端产物（src/ -> dist/）
npm run build

# 4) 打 Windows 安装包（NSIS 安装版 + 免安装版，输出到 release/）
npm run dist
```

发布新版本给用户前，记得在 `package.json` 里改 `version`（例如 `0.2.0`），安装包文件名会跟着变。

代码目录对应关系：

- `src/` —— 界面（React），改按钮、布局、文案都在这
- `server/` —— 后端逻辑（模型获取、配置写入、供应商管理、中继）
- `electron/main.mjs` —— 桌面壳（一般不用动，只有窗口/启动行为要改时才碰）
- `release/` —— 打包输出：`SwitchLite Setup x.y.z.exe`（安装版）+ `SwitchLite-Portable-x.y.z.exe`（免安装版）

打包后的程序不带任何本机数据（API Key 都存在使用者自己的 `~/.codex` / `~/.cc-switch-lite`），可以放心发给别人。

快速自检打包产物：

```bash
release\SwitchLite-Portable-x.y.z.exe --smoke-test
# 正常的话会在 %TEMP%\switchlite-smoke.json 生成 {"ok": true, ...}
```
