import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { APP_VERSION, agentName } from '../agents';
import { getTheme, setTheme, type ThemeMode } from '../theme';
import type { RelayStatus, Target, UsageDayStat, UsageSummary } from '../types';

interface Props {
  onClose: () => void;
  onError: (text: string) => void;
}

type Section = 'appearance' | 'usage';

const THEME_OPTIONS: { id: ThemeMode; name: string; desc: string }[] = [
  { id: 'light', name: '浅色', desc: '明亮界面' },
  { id: 'dark', name: '深色', desc: '暗色界面' },
  { id: 'system', name: '跟随系统', desc: '随系统自动切换' },
];

const RANGE_OPTIONS = [
  { days: 7, name: '近 7 天' },
  { days: 30, name: '近 30 天' },
  { days: 0, name: '全部' },
];

const DONUT_PALETTE = ['#5b5bd6', '#8b7ff0', '#38bdf8', '#34d399', '#f5a623', '#f472b6', '#98a2b8'];

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(1) + 'k';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'k';
  return String(n);
}

function fmtDur(ms: number) {
  if (!ms) return '—';
  return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : Math.round(ms) + 'ms';
}

function fmtUptime(sec: number) {
  if (!sec || sec < 60) return `${sec || 0} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr} 小时 ${remMin} 分钟`;
}

function fmtTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function shortDate(date: string) {
  return date.slice(5); // MM-DD
}

function agentLabel(target: Target | '') {
  return target ? agentName(target as Target) : '—';
}

/** 按模型聚合的环图数据：前 6 名 + 其他合并 */
function useDonut(summary: UsageSummary | null) {
  return useMemo(() => {
    if (!summary || !summary.byModel.length) return { segments: [], gradient: 'var(--tabs-bg)' };
    const top = summary.byModel.slice(0, 6);
    const rest = summary.byModel.slice(6);
    const restTotal = rest.reduce((s, m) => s + m.total, 0);
    const items = restTotal > 0 ? [...top, { model: '其他', provider: '', requests: rest.reduce((s, m) => s + m.requests, 0), input: 0, output: 0, total: restTotal, cached: 0, errors: 0 }] : top;
    const totalAll = items.reduce((s, m) => s + m.total, 0) || 1;
    let acc = 0;
    const segments = items.map((m, i) => {
      const pct = (m.total / totalAll) * 100;
      const seg = { ...m, color: DONUT_PALETTE[i % DONUT_PALETTE.length], from: acc, to: acc + pct };
      acc += pct;
      return seg;
    });
    const gradient = `conic-gradient(${segments.map((s) => `${s.color} ${s.from.toFixed(2)}% ${s.to.toFixed(2)}%`).join(', ')})`;
    return { segments, gradient };
  }, [summary]);
}

/** Token 使用趋势（输入 / 输出两条线的简易 SVG 图） */
function TrendChart({ daily }: { daily: UsageDayStat[] }) {
  const W = 660;
  const H = 190;
  const padL = 46;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const max = Math.max(1, ...daily.map((d) => Math.max(d.input, d.output)));
  const x = (i: number) => padL + (daily.length === 1 ? iw / 2 : (i / (daily.length - 1)) * iw);
  const y = (v: number) => padT + ih - (v / max) * ih;
  const line = (key: 'input' | 'output') => daily.map((d, i) => `${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const ticks = [0.33, 0.66, 1];
  const labelIdx = [...new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1])];

  return (
    <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Token 使用趋势">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} y1={y(max * t)} x2={W - padR} y2={y(max * t)} className="trend-grid" />
          <text x={padL - 6} y={y(max * t) + 3.5} className="trend-ylabel" textAnchor="end">
            {fmtNum(Math.round(max * t))}
          </text>
        </g>
      ))}
      <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} className="trend-grid strong" />
      <polyline points={line('input')} fill="none" className="trend-line input" />
      <polyline points={line('output')} fill="none" className="trend-line output" />
      {daily.map((d, i) => (
        <g key={d.date}>
          <circle cx={x(i)} cy={y(d.input)} r="2.6" className="trend-dot input" />
          <circle cx={x(i)} cy={y(d.output)} r="2.6" className="trend-dot output" />
        </g>
      ))}
      {labelIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 8} className="trend-xlabel" textAnchor="middle">
          {shortDate(daily[i].date)}
        </text>
      ))}
    </svg>
  );
}

export function SettingsModal({ onClose, onError }: Props) {
  const [section, setSection] = useState<Section>('appearance');
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [autostart, setAutostart] = useState<{ supported: boolean; enabled: boolean } | null>(null);
  const [failover, setFailover] = useState<boolean | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [checkingRelay, setCheckingRelay] = useState(false);
  const [restartingRelay, setRestartingRelay] = useState(false);
  const [relayMessage, setRelayMessage] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<{ state: string; version?: string; percent?: number; message?: string } | null>(null);
  const desktop = typeof window !== 'undefined' ? window.switchliteDesktop : undefined;

  useEffect(() => {
    if (!desktop) return;
    return desktop.onUpdateStatus((s) => setUpdateStatus(s));
  }, [desktop]);

  const checkRelay = useCallback(async () => {
    setCheckingRelay(true);
    setRelayMessage(null);
    try {
      const st = await api.getRelayStatus();
      setRelayStatus(st);
      if (st.running) {
        setRelayMessage(`中继检测正常（端口: ${st.port}，PID: ${st.pid || '已连接'}）`);
      } else {
        setRelayMessage('中继服务未响应，请点击「重启中继」');
      }
    } catch (e: unknown) {
      onError('检测中继失败: ' + (e as Error).message);
    } finally {
      setCheckingRelay(false);
    }
  }, [onError]);

  const handleRestartRelay = useCallback(async () => {
    setRestartingRelay(true);
    setRelayMessage(null);
    try {
      const res = await api.restartRelay();
      const st = await api.getRelayStatus();
      setRelayStatus(st);
      if (res.ok) {
        setRelayMessage(`中继已成功重启并正常运行（PID: ${st.pid || res.pid || '—'}）`);
      } else {
        onError('中继重启后未响应，请查看 ~/.cc-switch-lite/relay.log 日志');
      }
    } catch (e: unknown) {
      onError('重启中继失败: ' + (e as Error).message);
    } finally {
      setRestartingRelay(false);
    }
  }, [onError]);

  useEffect(() => {
    api.getRelayAutostart().then(setAutostart).catch(() => setAutostart(null));
    api
      .getSettings()
      .then((s) => setFailover(s.failover !== false))
      .catch(() => setFailover(null));
    api.getRelayStatus().then(setRelayStatus).catch(() => setRelayStatus(null));
  }, []);

  useEffect(() => {
    if (section === 'appearance') {
      api.getRelayStatus().then(setRelayStatus).catch(() => setRelayStatus(null));
    }
  }, [section]);

  const loadUsage = useCallback(
    async (d: number) => {
      setLoading(true);
      try {
        setSummary(await api.usageSummary(d));
      } catch (e: unknown) {
        onError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    if (section === 'usage') loadUsage(days);
  }, [section, days, loadUsage]);

  const pickTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    setTheme(mode);
  };

  const toggleAutostart = async () => {
    if (!autostart) return;
    try {
      setAutostart(await api.setRelayAutostart(!autostart.enabled));
    } catch (e: unknown) {
      onError((e as Error).message);
    }
  };

  const toggleFailover = async () => {
    if (failover === null) return;
    try {
      const s = await api.updateSettings({ failover: !failover });
      setFailover(s.failover !== false);
    } catch (e: unknown) {
      onError((e as Error).message);
    }
  };

  const checkUpdate = async () => {
    if (!desktop) return;
    setUpdateStatus({ state: 'checking' });
    try {
      const r = await desktop.checkUpdate();
      if (r.state === 'downloaded') setUpdateStatus(r);
    } catch (e: unknown) {
      setUpdateStatus({ state: 'error', message: (e as Error).message });
    }
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

  const donut = useDonut(summary);
  const hasData = !!summary && summary.totals.requests > 0;

  return (
    <div className="modal-mask">
      <div className="modal settings-modal">
        <div className="modal-head">
          <h3>设置</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            <button
              className={`settings-nav-item ${section === 'appearance' ? 'active' : ''}`}
              onClick={() => setSection('appearance')}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path fill="currentColor" d="M12 3a9 9 0 000 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16a5 5 0 005-5c0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
              </svg>
              <span>界面风格</span>
            </button>
            <button
              className={`settings-nav-item ${section === 'usage' ? 'active' : ''}`}
              onClick={() => setSection('usage')}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path fill="currentColor" d="M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z" />
              </svg>
              <span>用量看板</span>
            </button>
          </nav>

          <div className="settings-body">
            {section === 'appearance' && (
              <>
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
                  <div className="section-head-row">
                    <h4>本地中继与服务检测</h4>
                    <div className="section-actions">
                      <button
                        className="btn ghost small"
                        disabled={checkingRelay || restartingRelay}
                        onClick={checkRelay}
                        title="主动向 127.0.0.1:4180 发起健康检测"
                      >
                        {checkingRelay ? '检测中…' : '重新检测'}
                      </button>
                      <button
                        className="btn ghost small"
                        disabled={checkingRelay || restartingRelay}
                        onClick={handleRestartRelay}
                        title="终止旧中继进程并以独立进程重新启动"
                      >
                        {restartingRelay ? '重启中…' : '重启中继'}
                      </button>
                    </div>
                  </div>

                  <div className={`relay-status-card ${relayStatus ? (relayStatus.running ? 'running' : 'stopped') : ''}`}>
                    <div className="relay-status-main">
                      <div className="relay-status-indicator">
                        <span className={`status-dot ${relayStatus?.running ? 'online' : 'offline'}`} />
                        <span className="relay-status-title">
                          {relayStatus ? (relayStatus.running ? '中继服务正常运行中' : '中继服务未连接或异常') : '正在检测中继状态…'}
                        </span>
                      </div>
                      <div className="relay-status-details">
                        <span>中继地址：<code>{relayStatus?.origin || 'http://127.0.0.1:4180'}</code></span>
                        {relayStatus?.running && relayStatus.pid && (
                          <span>进程 PID：<code>{relayStatus.pid}</code></span>
                        )}
                        {relayStatus?.running && relayStatus.uptimeSec > 0 && (
                          <span>运行时长：<code>{fmtUptime(relayStatus.uptimeSec)}</code></span>
                        )}
                      </div>
                    </div>
                  </div>

                  {relayMessage && (
                    <div className={`alert ${relayStatus?.running ? 'info' : 'error'}`}>
                      {relayMessage}
                    </div>
                  )}

                  {relayStatus && !relayStatus.running && !relayMessage && (
                    <div className="alert error">
                      ⚠️ 检测到本地中继（127.0.0.1:4180）未响应！Agent 可能无法正常发起请求。请点击右上角「重启中继」重新拉起服务。
                    </div>
                  )}

                  {autostart?.supported && (
                    <label className="autostart-row">
                      <input type="checkbox" checked={autostart.enabled} onChange={toggleAutostart} />
                      <span>
                        <b>开机自动启动中继</b>
                        <span className="autostart-desc">登录 Windows 后自动拉起中继，无需先打开 SwitchLite</span>
                      </span>
                    </label>
                  )}
                  {failover !== null && (
                    <label className="autostart-row">
                      <input type="checkbox" checked={failover} onChange={toggleFailover} />
                      <span>
                        <b>故障自动切换</b>
                        <span className="autostart-desc">
                          当前供应商超时/限流/故障时，自动改用同一 Agent 下接入了相同模型的其他供应商；连续失败 3 次的供应商会熔断 2 分钟
                        </span>
                      </span>
                    </label>
                  )}
                  <div className="alert info">
                    中继是独立常驻进程：关闭 SwitchLite 窗口后 Agent 照常可用，用量也会持续记录（统计为旁路采集，不影响调用速度），下次打开看板即可查看。
                  </div>
                </div>

                <div className="settings-section">
                  <h4>关于</h4>
                  <div className="settings-info">
                    <div className="info-row">
                      <span className="info-label">版本</span>
                      <span>
                        v{APP_VERSION}
                        {desktop ? (
                          updateStatus?.state === 'downloaded' ? (
                            <button className="btn small" onClick={() => desktop.quitAndInstall()}>
                              重启更新到 v{updateStatus.version}
                            </button>
                          ) : (
                            <button
                              className="btn ghost small"
                              disabled={updateStatus?.state === 'checking' || updateStatus?.state === 'downloading'}
                              onClick={checkUpdate}
                            >
                              {updateStatus?.state === 'checking'
                                ? '检查中…'
                                : updateStatus?.state === 'downloading'
                                  ? `下载中 ${updateStatus.percent ?? 0}%`
                                  : '检查更新'}
                            </button>
                          )
                        ) : null}
                      </span>
                    </div>
                    {updateStatus?.state === 'latest' && (
                      <div className="info-row">
                        <span className="info-label" />
                        <span className="muted-text">已是最新版本</span>
                      </div>
                    )}
                    {updateStatus?.state === 'error' && (
                      <div className="info-row">
                        <span className="info-label" />
                        <span className="muted-text">检查更新失败：{updateStatus.message}</span>
                      </div>
                    )}
                    <div className="info-row">
                      <span className="info-label">数据目录</span>
                      <code>~/.cc-switch-lite</code>
                    </div>
                    <div className="info-row">
                      <span className="info-label">本地中继</span>
                      <code>127.0.0.1:4180</code>
                    </div>
                  </div>
                </div>
              </>
            )}

            {section === 'usage' && (
              <>
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

                {!hasData ? (
                  <div className="empty usage-empty">
                    <span>
                      {loading
                        ? '加载中…'
                        : '暂无用量数据。Agent 发起请求时由本地中继旁路采集（不影响正常调用），有数据后会显示在这里。'}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="usage-cards">
                      <div className="usage-card">
                        <span className="usage-card-label">总请求数</span>
                        <span className="usage-card-num">{fmtNum(summary.totals.requests)}</span>
                        <span className="usage-card-sub">所选范围内</span>
                      </div>
                      <div className="usage-card">
                        <span className="usage-card-label">总 Token</span>
                        <span className="usage-card-num">{fmtNum(summary.totals.total)}</span>
                        <span className="usage-card-sub">
                          输入 {fmtNum(summary.totals.input)} / 输出 {fmtNum(summary.totals.output)}
                          {summary.totals.cached > 0 && ` / 缓存 ${fmtNum(summary.totals.cached)}`}
                        </span>
                      </div>
                      <div className="usage-card">
                        <span className="usage-card-label">失败请求</span>
                        <span className={`usage-card-num ${summary.totals.errors ? 'bad' : ''}`}>
                          {fmtNum(summary.totals.errors)}
                        </span>
                        <span className="usage-card-sub">HTTP 错误或未连通</span>
                      </div>
                      <div className="usage-card">
                        <span className="usage-card-label">平均耗时</span>
                        <span className="usage-card-num">{fmtDur(summary.totals.avgDurationMs)}</span>
                        <span className="usage-card-sub">单次请求</span>
                      </div>
                    </div>

                    <div className="settings-section">
                      <h4>模型分布</h4>
                      <div className="donut-wrap">
                        <div className="donut" style={{ background: donut.gradient }}>
                          <div className="donut-hole">
                            <b>{fmtNum(summary.totals.total)}</b>
                            <span>tokens</span>
                          </div>
                        </div>
                        <div className="donut-table">
                          <div className="donut-row head">
                            <span>模型</span>
                            <span>请求</span>
                            <span>输入</span>
                            <span>输出</span>
                            <span>Token</span>
                          </div>
                          {donut.segments.map((s) => (
                            <div className="donut-row" key={`${s.provider}/${s.model}`}>
                              <span className="donut-model">
                                <i className="donut-dot" style={{ background: s.color }} />
                                <code>{s.model}</code>
                                {s.provider && <span className="donut-provider">{s.provider}</span>}
                              </span>
                              <span>{s.requests}</span>
                              <span>{s.input ? fmtNum(s.input) : '—'}</span>
                              <span>{s.output ? fmtNum(s.output) : '—'}</span>
                              <b>{fmtNum(s.total)}</b>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="settings-section">
                      <h4>Token 使用趋势</h4>
                      <div className="trend-legend">
                        <span>
                          <i className="trend-key input" /> 输入
                        </span>
                        <span>
                          <i className="trend-key output" /> 输出
                        </span>
                      </div>
                      <TrendChart daily={summary.daily} />
                    </div>

                    <div className="settings-section">
                      <h4>按厂商</h4>
                      <div className="donut-table">
                        <div className="donut-row head">
                          <span>供应商</span>
                          <span>请求</span>
                          <span>输入</span>
                          <span>输出</span>
                          <span>Token</span>
                        </div>
                        {summary.byProvider.map((p) => (
                          <div className="donut-row" key={p.providerId || p.name}>
                            <span className="donut-model">
                              <span className="usage-name">{p.name}</span>
                              <span className="tag">{agentLabel(p.target)}</span>
                              {p.errors > 0 && <span className="tag danger">{p.errors} 失败</span>}
                            </span>
                            <span>{p.requests}</span>
                            <span>{fmtNum(p.input)}</span>
                            <span>{fmtNum(p.output)}</span>
                            <b>{fmtNum(p.total)}</b>
                          </div>
                        ))}
                      </div>
                    </div>

                    {summary.recent.length > 0 && (
                      <div className="settings-section">
                        <h4>最近调用</h4>
                        <div className="usage-table">
                          {summary.recent.slice(0, 10).map((e, i) => (
                            <div className={`usage-event-row ${e.ok === false ? 'failed' : ''}`} key={`${e.ts}-${i}`}>
                              <span className="usage-event-time">{fmtTime(e.ts)}</span>
                              <span className="usage-name">
                                {e.providerName}
                                {e.source === 'session' && (
                                  <span className="tag" title="来自 Agent 本地会话日志（回填数据，无耗时/供应商归属）">
                                    日志
                                  </span>
                                )}
                                {e.retried && (
                                  <span className="tag warn" title="该次调用失败，请求已自动转移到备用供应商">
                                    已转移
                                  </span>
                                )}
                                {e.failoverTo && (
                                  <span className="tag accent" title={`主供应商「${e.failoverFrom}」故障，本次由备用供应商完成`}>
                                    备用接管
                                  </span>
                                )}
                              </span>
                              <code>{e.model || '—'}</code>
                              <span className="usage-row-nums">
                                {e.ok === false ? (
                                  <span className="tag danger">{e.status || '失败'}</span>
                                ) : (
                                  <>
                                    <span>{fmtDur(e.durationMs || 0)}</span>
                                    <b>{fmtNum(e.total)} tokens</b>
                                  </>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
