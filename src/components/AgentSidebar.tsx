import type { CSSProperties } from 'react';
import { AGENTS } from '../agents';
import type { Provider, Settings, Target } from '../types';
import { AGENT_THEME, AgentIcon } from './AgentIcon';
import switchliteIcon from '../assets/logos/switchlite.png';

interface Props {
  providers: Provider[];
  settings: Settings | null;
  selected: Target;
  onSelect: (target: Target) => void;
  onOpenSettings: () => void;
}

export function AgentSidebar({ providers, settings, selected, onSelect, onOpenSettings }: Props) {
  return (
    <aside className="sidebar agents">
      <div className="side-head">
        <span className="side-brand-mark">
          <img src={switchliteIcon} alt="" />
        </span>
        <span className="side-brand-text">
          <b>SwitchLite</b>
          <span>选择 Agent</span>
        </span>
      </div>

      <div className="side-list">
        {AGENTS.map((a) => {
          const activeId = settings?.active?.[a.id];
          const activeProvider = providers.find((p) => p.id === activeId && p.target === a.id) || null;
          const theme = AGENT_THEME[a.id];
          return (
            <button
              key={a.id}
              className={`side-item agent ${selected === a.id ? 'active' : ''}`}
              onClick={() => onSelect(a.id)}
              style={selected === a.id ? { '--agent-accent': theme.accent } as CSSProperties : undefined}
            >
              <span className="agent-tile" style={{ background: theme.tile }}>
                <AgentIcon id={a.id} size={26} />
              </span>
              <span className="agent-info">
                <span className="agent-name-row">
                  <span className="side-name">{a.name}</span>
                  {activeProvider && <span className="dot on" title="当前已接入" />}
                </span>
                <span className={`side-model ${activeProvider ? '' : 'off'}`}>
                  {activeProvider?.selectedModel || '未接入'}
                </span>
              </span>
              <span className="agent-chevron" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path fill="currentColor" d="M9.3 6.7a1 1 0 011.4 0l5 5a1 1 0 010 1.4l-5 5a1 1 0 01-1.4-1.4L13.6 12 9.3 7.7a1 1 0 010-1z" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>

      <div className="side-foot">
        <button className="settings-btn" onClick={onOpenSettings}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19.4 13c.04-.32.06-.66.06-1s-.02-.68-.06-1l2.1-1.65a.5.5 0 00.12-.64l-2-3.46a.5.5 0 00-.6-.22l-2.49 1a7.3 7.3 0 00-1.73-1l-.38-2.65a.5.5 0 00-.5-.42h-4a.5.5 0 00-.5.42l-.37 2.65c-.63.27-1.2.62-1.73 1l-2.49-1a.5.5 0 00-.6.22l-2 3.46a.5.5 0 00.12.64L4.4 11c-.04.32-.06.66-.06 1s.02.68.06 1l-2.1 1.65a.5.5 0 00-.12.64l2 3.46c.14.24.43.34.68.22l2.49-1c.52.4 1.1.73 1.73 1l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.63-.27 1.2-.62 1.73-1l2.49 1c.25.12.54.02.68-.22l2-3.46a.5.5 0 00-.12-.64L19.4 13zM12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"
            />
          </svg>
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}
