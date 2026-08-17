import type { Preset, Protocol } from './types';

export interface InferResult {
  protocol?: Protocol;
  presetId?: string;
  baseUrl?: string;
  name?: string;
  anthropicUrl?: string;
}

export function inferFromInput(url: string, apiKey: string, presets: Preset[] = []): InferResult | null {
  const cleanKey = String(apiKey || '').trim();
  const cleanUrl = String(url || '').trim().toLowerCase();

  // 1. 根据 API Key 指纹推测
  if (cleanKey.startsWith('bce-v3/')) {
    return { protocol: 'openai', presetId: 'baidu', baseUrl: 'https://qianfan.baidubce.com/v2', name: '百度千帆' };
  }
  if (cleanKey.startsWith('sk-ant-')) {
    return { protocol: 'anthropic', presetId: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', name: 'Anthropic' };
  }
  if (cleanKey.startsWith('AIza')) {
    return { protocol: 'gemini', presetId: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', name: 'Google Gemini' };
  }
  if (cleanKey.startsWith('sk-or-v1-')) {
    return { protocol: 'openai', presetId: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', name: 'OpenRouter' };
  }

  // 2. 根据 URL 域名指纹推测
  if (cleanUrl.includes('qianfan.baidubce.com')) {
    return { protocol: 'openai', presetId: 'baidu', baseUrl: 'https://qianfan.baidubce.com/v2', name: '百度千帆' };
  }
  if (cleanUrl.includes('dashscope.aliyuncs.com')) {
    return {
      protocol: 'openai',
      presetId: 'aliyun',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      anthropicUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
      name: '阿里云百炼',
    };
  }
  if (cleanUrl.includes('open.bigmodel.cn')) {
    return { protocol: 'openai', presetId: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', name: '智谱 GLM' };
  }
  if (cleanUrl.includes('api.moonshot.cn')) {
    return { protocol: 'openai', presetId: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1', name: 'Moonshot Kimi' };
  }
  if (cleanUrl.includes('api.deepseek.com')) {
    return { protocol: 'openai', presetId: 'deepseek', baseUrl: 'https://api.deepseek.com', name: 'DeepSeek 官方' };
  }
  if (cleanUrl.includes('api.siliconflow.cn')) {
    return { protocol: 'openai', presetId: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', name: '硅基流动 SiliconFlow' };
  }
  if (cleanUrl.includes('volces.com')) {
    return { protocol: 'openai', presetId: 'volcengine', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', name: '火山方舟 Ark' };
  }
  if (cleanUrl.includes('api.minimaxi.com')) {
    return { protocol: 'openai', presetId: 'minimax', baseUrl: 'https://api.minimaxi.com/v1', name: 'MiniMax' };
  }
  if (cleanUrl.includes('api.x.ai')) {
    return { protocol: 'openai', presetId: 'xai', baseUrl: 'https://api.x.ai/v1', name: 'xAI Grok' };
  }
  if (cleanUrl.includes('generativelanguage.googleapis.com')) {
    return { protocol: 'gemini', presetId: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', name: 'Google Gemini' };
  }
  if (cleanUrl.includes('anthropic.com')) {
    return { protocol: 'anthropic', presetId: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', name: 'Anthropic' };
  }

  return null;
}
