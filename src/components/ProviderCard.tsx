import type { Preset, Provider } from '../types';

interface Props {
  provider: Provider;
  preset: Preset | null;
  active: boolean;
  busy: boolean;
  onSetActive: (id: string) => void;
  onEdit: (p: Provider) => void;
  onDelete: (id: string) => void;
}

export function ProviderCard({ provider, preset, active, busy, onSetActive, onEdit, onDelete }: Props) {
  return (
    <div className={`provider-card ${active ? 'active' : ''}`}>
      <div className="pc-main">
        <div className="pc-top">
          <span className="pc-name">{provider.name}</span>
          {preset && <span className="tag">{preset.name}</span>}
          {active && <span className="tag accent">当前</span>}
        </div>
        <div className="pc-sub">
          <code>{provider.baseUrl || '未设置地址'}</code>
          <span>
            模型：{provider.selectedModel ? <code>{provider.selectedModel}</code> : <span className="muted-text">未选择</span>}
          </span>
          <span>Key：{maskKey(provider.apiKey)}</span>
        </div>
      </div>
      <div className="pc-actions">
        {!active && (
          <button className="btn" disabled={busy || !provider.selectedModel} onClick={() => onSetActive(provider.id)} title={provider.selectedModel ? '' : '请先编辑并选择模型'}>
            设为当前
          </button>
        )}
        <button className="btn ghost" onClick={() => onEdit(provider)}>
          编辑
        </button>
        <button className="btn danger ghost" onClick={() => onDelete(provider.id)}>
          删除
        </button>
      </div>
    </div>
  );
}

function maskKey(key: string) {
  if (!key) return '未填写';
  if (key.length <= 8) return '••••••';
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}
