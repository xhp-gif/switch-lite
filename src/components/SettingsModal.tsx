import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { APP_VERSION, agentName } from '../agents';
import { getTheme, setTheme, type ThemeMode } from '../theme';
import type { Target, UsageSummary } from '../types';

interface Props {
  onClose: () => void;
  onError: (text: string) => void;
}

const THEME_OPTIONS: { id: ThemeMode; name: string; desc: string }[] = [
  { id: 'light', name: '浅色', desc: '明亮界面' },
  { id: 'dark', name: '深色', desc: '暗色界面' },
  { id: 'system', name: '跟随系统', desc: '随系统深浅色自动切换' },
];

const RANGE_OPTIONS = [
  { days: 7, name: '近 7 天' },
  { days: 30, name: '近 30 天' },
  { days: 0, name: '全部' },
];

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(1) + 'k';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'k';
  return String(n);
}

function fmtTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function agentLabel(target: Target | '') {
  return target ? agentName(target as Target) : '—';
}

export function SettingsModal({ onClose, onError }: Props) {
  const [tab, setTab] = useState<'general' | 'usage'>('general');
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const loadUsage = useCallback(async (d: number) => {
    setLoading(true);
    try {
      setSummary(await api.usageSummary(d));
    } catch (e: unknown) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    if (tab === 'usage') loadUsage(days);
  }, [tab, days, loadUsage]);

  const pickTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    setTheme(mode);
  };

  const handleClear = async () => {
    if (!window.confirm('确定清空全部用量统计数据？')) return;
    try {
      await api.clearUsage();
      await loadUsage(days);
    } catch (e: unknown) {
      onError((e as Error).message);
    }
  };

  const maxProviderTotal = summary?.byProvider.reduce((m, p) => Math.max(m, p.total), 0) || 0;

  return (
    <div className="modal-mask">
      <div className="modal settings-modal">
        <div className="modal-head">
          <h3>设置</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="settings-tabs">
          <button className={`settings-tab ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>
            通用
          </button>
          <button className={`settings-tab ${tab === 'usage' ? 'active' : ''}`} onClick={() => setTab('usage')}>
            用量看板
          </button>
        </div>

        {tab === 'general' && (
          <div className="settings-body">
            <div className="settings-section">
              <h4>界面主题</h4>
              <div className="theme-options">
                {THEME_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    className={`theme-option ${theme === o.id ? 'active' : ''}`}
                    onClick={() => pickTheme(o.id)}
                  >
                    <span className="theme-option-name">{o.name}</span>
                    <span className="theme-option-desc">{o.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section">
              <h4>关于</h4>
              <div className="settings-info">
                <div className="info-row">
                  <span className="info-label">版本</span>
                  <span>v{APP_VERSION}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">数据目录</span>
                  <code>~/.cc-switch-lite</code>
                </div>
                <div className="info-row">
                  <span className="info-label">本地中继</span>
                  <code>127.0.0.1:4180</code>
                </div>
              </div>
              <div className="alert info">
                各 Agent 的请求经本地中继转发以统计 token 用量。请保持 SwitchLite 运行，关闭后已接入的 Agent 将无法连接供应商。
              </div>
            </div>
          </div>
        )}

        {tab === 'usage' && (
          <div className="settings-body">
            <div className="usage-toolbar">
              <div className="usage-range">
                {RANGE_OPTIONS.map((r) => (
                  <button
                    key={r.days}
                    className={`settings-tab ${days === r.days ? 'active' : ''}`}
                    onClick={() => setDays(r.days)}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
              <div className="usage-actions">
                <button className="btn ghost" disabled={loading} onClick={() => loadUsage(days)}>
                  刷新
                </button>
                <button className="btn ghost danger" onClick={handleClear}>
                  清空统计
                </button>
              </div>
            </div>

            {!summary || summary.totals.requests === 0 ? (
              <div className="empty usage-empty">
                <span>
                  {loading ? '加载中…' : '暂无用量数据。统计在 Agent 发起请求、且 SwitchLite 正在运行时产生（请求经本地中继转发）。'}
                </span>
              </div>
            ) : (
              <>
                <div className="usage-cards">
                  <div className="usage-card">
                    <span className="usage-card-num">{fmtNum(summary.totals.requests)}</span>
                    <span className="usage-card-label">总请求数</span>
                  </div>
                  <div className="usage-card">
                    <span className="usage-card-num">{fmtNum(summary.totals.input)}</span>
                    <span className="usage-card-label">输入 tokens</span>
                  </div>
                  <div className="usage-card">
                    <span className="usage-card-num">{fmtNum(summary.totals.output)}</span>
                    <span className="usage-card-label">输出 tokens</span>
                  </div>
                  <div className="usage-card">
                    <span className={`usage-card-num ${summary.totals.errors ? 'bad' : ''}`}>
                      {fmtNum(summary.totals.errors)}
                    </span>
                    <span className="usage-card-label">失败请求</span>
                  </div>
                </div>

                <div className="settings-section">
                  <h4>按厂商</h4>
                  <div className="usage-table">
                    {summary.byProvider.map((p) => (
                      <div className="usage-row" key={p.providerId || p.name}>
                        <div className="usage-row-head">
                          <span className="usage-name">{p.name}</span>
                          <span className="tag">{agentLabel(p.target)}</span>
                          {p.errors > 0 && <span className="tag danger">{p.errors} 失败</span>}
                        </div>
                        <div className="usage-bar-track">
                          <div
                            className="usage-bar"
                            style={{ width: `${maxProviderTotal ? Math.max(2, (p.total / maxProviderTotal) * 100) : 0}%` }}
                          />
                        </div>
                        <div className="usage-row-nums">
                          <span>{p.requests} 次请求</span>
                          <span>输入 {fmtNum(p.input)}</span>
                          <span>输出 {fmtNum(p.output)}</span>
                          <b>合计 {fmtNum(p.total)}</b>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {summary.byModel.length > 0 && (
                  <div className="settings-section">
                    <h4>按模型</h4>
                    <div className="usage-table">
                      {summary.byModel.map((m) => (
                        <div className="usage-model-row" key={`${m.provider}/${m.model}`}>
                          <code>{m.model}</code>
                          <span className="usage-provider-name">{m.provider}</span>
                          <span className="usage-row-nums">
                            <span>{m.requests} 次</span>
                            <b>{fmtNum(m.total)} tokens</b>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {summary.recent.length > 0 && (
                  <div className="settings-section">
                    <h4>最近调用</h4>
                    <div className="usage-table">
                      {summary.recent.map((e, i) => (
                        <div className={`usage-event-row ${e.ok === false ? 'failed' : ''}`} key={`${e.ts}-${i}`}>
                          <span className="usage-event-time">{fmtTime(e.ts)}</span>
                          <span className="usage-name">{e.providerName}</span>
                          <code>{e.model || '—'}</code>
                          <span className="usage-row-nums">
                            {e.ok === false ? <span className="tag danger">{e.status || '失败'}</span> : <b>{fmtNum(e.total)} tokens</b>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
