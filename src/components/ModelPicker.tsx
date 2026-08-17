import { useMemo, useState } from 'react';
import { buildRecommendations } from '../recommend';
import type { ModelInfo, Preset } from '../types';

interface Props {
  models: ModelInfo[];
  preset: Preset | null;
  selectedId?: string;
  actionLabel?: string;
  busy?: boolean;
  onPick: (modelId: string) => void;
}

export function ModelPicker({ models, preset, selectedId, actionLabel, busy, onPick }: Props) {
  const [tab, setTab] = useState<'rec' | 'all'>('rec');
  const [q, setQ] = useState('');

  const series = useMemo(() => buildRecommendations(models, preset), [models, preset]);
  const filteredAll = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return models;
    return models.filter((m) => m.id.toLowerCase().includes(t));
  }, [models, q]);

  return (
    <div className="picker">
      <div className="picker-head">
        <div className="tabs">
          <button className={tab === 'rec' ? 'tab active' : 'tab'} onClick={() => setTab('rec')}>
            推荐
          </button>
          <button className={tab === 'all' ? 'tab active' : 'tab'} onClick={() => setTab('all')}>
            全部（{models.length}）
          </button>
        </div>
        {tab === 'all' && <input className="search" placeholder="搜索模型 ID…" value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>

      {tab === 'rec' && (
        <div className="series-list">
          {!series.length && <div className="empty">没有匹配的常用系列，可到「全部」查看</div>}
          {series.map((s) => (
            <div className="series" key={s.series}>
              <div className="series-head">
                <span className="series-name">{s.series}</span>
                {s.note && <span className="series-note">{s.note}</span>}
              </div>
              <div className="series-items">
                {s.items.map((m) => (
                  <PickRow
                    key={m.id}
                    id={m.id}
                    selected={m.id === selectedId}
                    actionLabel={actionLabel}
                    busy={busy}
                    onPick={onPick}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'all' && (
        <div className="all-list">
          {!filteredAll.length && <div className="empty">没有匹配的模型</div>}
          {filteredAll.map((m) => (
            <PickRow
              key={m.id}
              id={m.id}
              selected={m.id === selectedId}
              actionLabel={actionLabel}
              busy={busy}
              onPick={onPick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PickRow({
  id,
  selected,
  actionLabel,
  busy,
  onPick,
}: {
  id: string;
  selected?: boolean;
  actionLabel?: string;
  busy?: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div className={`model-row ${selected ? 'selected' : ''}`} onClick={() => onPick(id)}>
      <span className="model-id">
        {id}
        {selected && (
          <span className="tag accent" style={{ marginLeft: 8, fontSize: '11px', padding: '1px 6px' }}>
            已选
          </span>
        )}
      </span>
      <span className="model-actions">
        <button
          type="button"
          className={`mini ${selected ? 'accent' : 'primary'}`}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onPick(id);
          }}
        >
          {selected ? '已选择' : (actionLabel || '接入')}
        </button>
      </span>
    </div>
  );
}
