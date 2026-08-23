import type { Target } from './types';

export interface Agent {
  id: Target;
  name: string;
  icon: string;
  desc: string;
  configFile: string;
}

export const BUILTIN_AGENTS: Agent[] = [
  {
    id: 'codex',
    name: 'Codex CLI',
    icon: '⌘',
    desc: 'OpenAI 官方 CLI，支持 chat / responses / anthropic / gemini 协议',
    configFile: '~/.codex/config.toml',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    icon: '✧',
    desc: 'Google 官方 CLI，需要 Gemini 协议供应商（官方 API 或兼容网关）',
    configFile: '~/.gemini/settings.json',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    icon: '✳',
    desc: 'Anthropic 官方 CLI，需要 Anthropic 兼容地址',
    configFile: '~/.claude/settings.json',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    icon: '✦',
    desc: '热门 AI 代码编辑器，无缝将当前中继 API 写入 Cursor 模型设置',
    configFile: '~/.cursor/settings.json（Windows 为 %APPDATA%\\Cursor\\User\\settings.json）',
  },
  {
    id: 'grok',
    name: 'Grok CLI',
    icon: '𝕏',
    desc: 'xAI 官方/社区 CLI 智能体，支持极速代码交互',
    configFile: '~/.grok/config.json',
  },
  {
    id: 'deepseek_harness',
    name: 'DeepSeek Harness',
    icon: '🐳',
    desc: 'DeepSeek 官方/社区 Harness 套件（直连上游 + RPC 实时同步）',
    configFile: '~/.dsh/settings.yaml',
  },
  {
    id: 'tare',
    name: 'Trae / Tare CLI',
    icon: '🤖',
    desc: '字节跳动 Trae AI / 终端轻量代码智能体',
    configFile: '~/.tare/config.json',
  },
  {
    id: 'qcoder',
    name: 'QCoder',
    icon: '🅀',
    desc: '国产极速终端代码智能体助手（通义千问 / 腾讯）',
    configFile: '~/.qcoder/settings.json',
  },
  {
    id: 'zcode',
    name: 'ZCode',
    icon: '🅉',
    desc: '国产代码智能体（智谱 AI / ZCode）',
    configFile: '~/.zcode/config.json',
  },
  {
    id: 'opencode',
    name: 'OpenCode CLI',
    icon: '⌬',
    desc: '开源终端 AI 编程智能体 (Anomaly OpenCode)',
    configFile: '~/.opencode/config.json',
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    icon: 'h',
    desc: 'Nous Research 开源智能体，支持自定义供应商与 MCP',
    configFile: '~/.hermes/config.yaml（Windows 为 %LOCALAPPDATA%\\hermes\\config.yaml）',
  },
];

export const AGENTS = BUILTIN_AGENTS;

export const DEFAULT_ENABLED_AGENTS = ['codex', 'claude', 'cursor', 'grok', 'deepseek_harness', 'opencode'];

export const APP_VERSION = '0.5.3';

export interface CustomAgentPreset {
  id: string;
  name: string;
  icon: string;
  desc: string;
  format: 'json' | 'yaml' | 'toml' | 'env';
  configFile: string;
  exampleConfig: string;
  hint: string;
}

export const CUSTOM_AGENT_PRESETS: CustomAgentPreset[] = [
  {
    id: 'kiro',
    name: 'Kiro Agent',
    icon: 'kiro',
    desc: 'AWS / 独立 Kiro 智能体助手，支持一键模型热切与中继调度',
    format: 'json',
    configFile: '~/.kiro/config.json',
    exampleConfig: '{\n  "baseUrl": "http://127.0.0.1:23789/p/...",\n  "apiKey": "sk-...",\n  "model": "deepseek-v3"\n}',
    hint: '支持 ~/.kiro/config.json 或 %USERPROFILE%\\.kiro\\config.json',
  },
  {
    id: 'aider',
    name: 'Aider',
    icon: 'aider',
    desc: '终端极速 AI 配对编程与自动化代码重构智能体',
    format: 'yaml',
    configFile: '~/.aider.conf.yml',
    exampleConfig: 'openai-api-base: http://127.0.0.1:23789/p/...\nopenai-api-key: sk-...\nmodel: deepseek-v3',
    hint: '支持 ~/.aider.conf.yml 或工作区根目录下的 .aider.conf.yml',
  },
  {
    id: 'continue',
    name: 'Continue',
    icon: 'continue',
    desc: '开源 VS Code / JetBrains 全功能智能编程扩展',
    format: 'json',
    configFile: '~/.continue/config.json',
    exampleConfig: '{\n  "models": [{\n    "title": "SwitchLite",\n    "provider": "openai",\n    "model": "deepseek-v3",\n    "apiBase": "http://127.0.0.1:23789/p/...",\n    "apiKey": "sk-..."\n  }]\n}',
    hint: 'Continue 的全局配置位于 ~/.continue/config.json',
  },
  {
    id: 'cline',
    name: 'Cline (Roo Code)',
    icon: 'cline',
    desc: 'VS Code 自主编码任务执行与终端命令智能体',
    format: 'json',
    configFile: '~/.cline/settings.json',
    exampleConfig: '{\n  "apiProvider": "openai-native",\n  "openAiBaseUrl": "http://127.0.0.1:23789/p/...",\n  "openAiApiKey": "sk-...",\n  "openAiModelId": "deepseek-v3"\n}',
    hint: 'Cline 扩展设置，支持 ~/.cline/settings.json',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    icon: 'windsurf',
    desc: 'Codeium 打造的 Cascade 协同 AI 编辑器',
    format: 'json',
    configFile: '~/.codeium/windsurf/settings.json',
    exampleConfig: '{\n  "openai.baseUrl": "http://127.0.0.1:23789/p/...",\n  "openai.apiKey": "sk-...",\n  "openai.model": "deepseek-v3"\n}',
    hint: 'Windsurf 用户设置目录 ~/.codeium/windsurf/settings.json',
  },
  {
    id: 'devin',
    name: 'Devin CLI',
    icon: 'devin',
    desc: '开源自主软件工程师终端智能体 (OpenDevin)',
    format: 'toml',
    configFile: '~/.devin/config.toml',
    exampleConfig: 'base_url = "http://127.0.0.1:23789/p/..."\napi_key = "sk-..."\nmodel = "deepseek-v3"',
    hint: 'OpenDevin / Devin 命令行客户端配置文件',
  },
  {
    id: 'custom_json',
    name: '通用 JSON 智能体',
    icon: '✦',
    desc: '任意通过 JSON 格式读取 baseUrl / apiKey / model 的智能体外壳',
    format: 'json',
    configFile: '~/.myagent/config.json',
    exampleConfig: '{\n  "baseUrl": "http://127.0.0.1:23789/p/...",\n  "apiKey": "sk-...",\n  "model": "deepseek-v3"\n}',
    hint: '自动解析并写入 baseUrl / apiKey / model 字段',
  },
  {
    id: 'custom_yaml',
    name: '通用 YAML 智能体',
    icon: '⚡',
    desc: '任意通过 YAML 格式读取 baseUrl / apiKey / model 的智能体外壳',
    format: 'yaml',
    configFile: '~/.myagent/config.yaml',
    exampleConfig: 'base_url: "http://127.0.0.1:23789/p/..."\napi_key: "sk-..."\nmodel: "deepseek-v3"',
    hint: '自动生成结构化 YAML 配置',
  },
];

export function agentName(target: Target, customAgents: Agent[] = []) {
  const all = [...BUILTIN_AGENTS, ...customAgents];
  return all.find((a) => a.id === target)?.name || target;
}

