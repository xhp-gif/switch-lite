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
    desc: '国产热门 DeepSeek 自动化评测与智能体套件',
    configFile: '~/.deepseek/harness.json',
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

export const APP_VERSION = '0.4.9';

export function agentName(target: Target, customAgents: Agent[] = []) {
  const all = [...BUILTIN_AGENTS, ...customAgents];
  return all.find((a) => a.id === target)?.name || target;
}
