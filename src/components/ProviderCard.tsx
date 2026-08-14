import type { Preset, Provider } from '../types';

interface Props {
  provider: Provider;
  preset: Preset | null;
  active: boolean;
  busy: boolean;
  speedtesting: boolean;
  onSetActive: (id: string) => void;
  onSpeedtest: (id: string) => void;
  onEdit: (p: Provider) => void;
  onDelete: (id: string) => void;
}

export function ProviderCard({ provider, preset, active, busy, speedtesting, onSetActive, onSpeedtest, onEdit, onDelete }: Props) {
  const st = provider.lastSpeedtest;
  return (
    <div className={`provider-card ${active ? 'active' : ''}`}>
      <div className="pc-main">
        <div className="pc-top">
          <span className="pc-name">{provider.name}</span>
          {preset && <span className="tag">{preset.name}</span>}
          {active && <span className="tag accent">当前</span>}
          {speedtesting ? (
            <span className="tag speed">测速中…</span>
          ) : st ? (
            <span
              className={`tag speed ${st.ok ? (st.latencyMs < 300 ? 'fast' : st.latencyMs < 1000 ? 'mid' : 'slow') : 'dead'}`}
              title={st.ok ? `${new Date(st.at).toLocaleString()} 测得` : st.error || '连接失败'}
            >
              {st.ok ? `${st.latencyMs}ms` : '不可达'}
            </span>
          ) : null}
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
        <button className="btn ghost" disabled={speedtesting} onClick={() => onSpeedtest(provider.id)} title="测试 API 端点响应速度（非模型推理速度）">
          测速
        </button>
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
