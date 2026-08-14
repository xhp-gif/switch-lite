import type { Target } from './types';

export interface Agent {
  id: Target;
  name: string;
  icon: string;
  desc: string;
  configFile: string;
}

export const AGENTS: Agent[] = [
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
    id: 'gemini',
    name: 'Gemini CLI',
    icon: '◆',
    desc: 'Google 官方 CLI，需要 Gemini 协议供应商',
    configFile: '~/.gemini/settings.json',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: '⌬',
    desc: '开源 CLI，支持 OpenAI / Anthropic / Gemini 兼容协议',
    configFile: '~/.config/opencode/opencode.json',
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    icon: 'h',
    desc: 'Nous Research 开源智能体，支持自定义供应商与 MCP',
    configFile: '~/.hermes/config.yaml（Windows 为 %LOCALAPPDATA%\\hermes\\config.yaml）',
  },
];

export const APP_VERSION = '0.4.5';

export function agentName(target: Target) {
  return AGENTS.find((a) => a.id === target)?.name || target;
}
