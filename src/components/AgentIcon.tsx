import { useId } from 'react';
import type { Target } from '../types';
import hermesIcon from '../assets/logos/hermes.png';

interface Props {
  id: Target;
  size?: number;
  className?: string;
}

// ---- 官方 Codex App 图标（白色圆角方块 + 蓝紫渐变 C 标）----
const CODEX_BG = 'M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z';
const CODEX_GLYPH =
  'M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z';

// ---- 官方 Claude / Anthropic 现行星芒 Logo ----
const CLAUDE_STARBURST =
  'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z';

// ---- 官方 Gemini 四色星（2025 新版 App 图标）----
const GEMINI_PATH =
  'M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z';

// ---- 官方 OpenCode Logo 标记（圆角外框 + 内方块）----
const OPENCODE_PATH = 'M16 6H8v12h8V6zm4 16H4V2h16v20z';

// 每个 Agent 的官方品牌色与底色
export const AGENT_THEME: Record<string, { tile: string; icon: string; accent: string }> = {
  codex: { tile: '#f4f4f6', icon: '#3941FF', accent: '#3941FF' },
  claude: { tile: '#ffffff', icon: '#D97757', accent: '#D97757' },
  gemini: { tile: '#ffffff', icon: '', accent: '#4285F4' },
  opencode: { tile: '#ffffff', icon: '#0B1220', accent: '#0B1220' },
  hermes: { tile: '#ffffff', icon: '', accent: '#0071A9' },
};

export function AgentIcon({ id, size = 24, className }: Props) {
  if (id === 'hermes') {
    return (
      <img
        src={hermesIcon}
        alt="Hermes Agent"
        width={size}
        height={size}
        className={className}
        style={{ borderRadius: '22%', objectFit: 'cover', display: 'block' }}
        draggable={false}
      />
    );
  }

  if (id === 'gemini') {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
        <defs>
          <linearGradient id={`g0-${uid}`} x1="7" x2="11" y1="15.5" y2="12" gradientUnits="userSpaceOnUse">
            <stop stopColor="#08B962" />
            <stop offset="1" stopColor="#08B962" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`g1-${uid}`} x1="8" x2="11.5" y1="5.5" y2="11" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F94543" />
            <stop offset="1" stopColor="#F94543" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`g2-${uid}`} x1="3.5" x2="17.5" y1="13.5" y2="12" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FABC12" />
            <stop offset=".46" stopColor="#FABC12" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={GEMINI_PATH} fill="#3186FF" />
        <path d={GEMINI_PATH} fill={`url(#g0-${uid})`} />
        <path d={GEMINI_PATH} fill={`url(#g1-${uid})`} />
        <path d={GEMINI_PATH} fill={`url(#g2-${uid})`} />
      </svg>
    );
  }

  if (id === 'codex') {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
        <defs>
          <linearGradient id={`codex-${uid}`} x1="12" x2="12" y1="3" y2="21" gradientUnits="userSpaceOnUse">
            <stop stopColor="#B1A7FF" />
            <stop offset=".5" stopColor="#7A9DFF" />
            <stop offset="1" stopColor="#3941FF" />
          </linearGradient>
        </defs>
        <path d={CODEX_BG} fill="#ffffff" />
        <path d={CODEX_GLYPH} fill={`url(#codex-${uid})`} />
      </svg>
    );
  }

  const fill = id === 'claude' ? '#D97757' : AGENT_THEME[id]?.icon || '#0B1220';
  const path = id === 'claude' ? CLAUDE_STARBURST : OPENCODE_PATH;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <path fill={fill} fillRule="evenodd" d={path} />
    </svg>
  );
}
