import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { AGENTS, agentName } from './agents';
import type { Preset, Provider, Settings, Target } from './types';
import { AgentSidebar } from './components/AgentSidebar';
import { AGENT_THEME, AgentIcon } from './components/AgentIcon';
import switchliteIcon from './assets/logos/switchlite.png';
import { QuickConnect, type ConnectForm } from './components/QuickConnect';
import { ProviderCard } from './components/ProviderCard';
import { ProviderEditModal } from './components/ProviderEditModal';
import { SettingsModal } from './components/SettingsModal';
import { Toast } from './components/Toast';

type ToastState = { kind: 'ok' | 'err'; text: string } | null;

function stripSlash(s: string) {
  return s.trim().replace(/\/+$/, '').toLowerCase();
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url || '未设置地址';
  }
}

export default function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [agent, setAgent] = useState<Target>('codex');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast((t) => (t && t.text === text ? null : t)), 4500);
  }, []);

  const refreshProviders = useCallback(async () => {
    setProviders(await api.providers());
  }, []);

  const refreshSettings = useCallback(async () => {
    setSettings(await api.getSettings());
  }, []);

  useEffect(() => {
    api
      .presets()
      .then(setPresets)
      .catch((e) => notify('err', e.message));
    refreshProviders().catch((e) => notify('err', e.message));
    refreshSettings().catch((e) => notify('err', e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = useMemo(() => providers.filter((p) => p.target === agent), [providers, agent]);
  const activeId = settings?.active?.[agent] || null;
  const activeProvider = connected.find((p) => p.id === activeId) || null;
  const currentAgent = AGENTS.find((a) => a.id === agent) || AGENTS[0];
  const presetOf = useCallback((p: Provider) => presets.find((x) => x.id === p.presetId) || null, [presets]);

  // 快速接入：保存（或复用）供应商 -> 写入 Agent 配置 -> 设为当前
  const handleConnect = async (form: ConnectForm, modelId: string) => {
    setBusy(true);
    try {
      const baseUrl = form.baseUrl.trim();
      const name = form.name.trim() || presets.find((p) => p.id === form.presetId)?.name || hostOf(baseUrl);
      const patch: Partial<Provider> = {
        target: agent,
        presetId: form.presetId || 'custom',
        name,
        baseUrl,
        apiKey: form.apiKey,
        protocol: form.protocol,
        selectedModel: modelId,
      };
      let provider = providers.find((p) => p.target === agent && stripSlash(p.baseUrl) === stripSlash(baseUrl));
      provider = provider ? await api.updateProvider(provider.id, patch) : await api.createProvider(patch);
      const r = await api.applyConfig(provider.id, agent, modelId);
      await Promise.all([refreshProviders(), refreshSettings()]);
      notify('ok', `已接入 ${agentName(agent)}：${modelId}（${r.file}）`);
    } catch (e: unknown) {
      notify('err', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 把已保存的供应商设为当前并写入配置
  const handleSetActive = async (providerId: string) => {
    const p = providers.find((x) => x.id === providerId);
    if (!p) return;
    if (!p.selectedModel) {
      notify('err', `「${p.name}」还没有选择模型，请先编辑并获取模型`);
      return;
    }
    setBusy(true);
    try {
      const r = await api.applyConfig(p.id, agent, p.selectedModel);
      await Promise.all([refreshProviders(), refreshSettings()]);
      notify('ok', `已切换为当前：${p.selectedModel}（${r.file}）`);
    } catch (e: unknown) {
      notify('err', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleEditSave = async (patch: Partial<Provider>) => {
    if (!editing) return;
    try {
      const updated = await api.updateProvider(editing.id, patch);
      await refreshProviders();
      setEditing(updated);
      notify('ok', '已保存');
    } catch (e: unknown) {
      notify('err', (e as Error).message);
    }
  };

  const handleEditFetch = async () => {
    if (!editing) return;
    try {
      const r = await api.fetchModels(editing.id);
      await refreshProviders();
      setEditing(r.provider);
      notify('ok', `获取成功：${r.count} 个模型（${r.endpoint}）`);
    } catch (e: unknown) {
      notify('err', (e as Error).message);
    }
  };

  const handleDelete = async (providerId: string) => {
    const p = providers.find((x) => x.id === providerId);
    if (!p) return;
    if (!window.confirm(`确定删除供应商「${p.name}」？`)) return;
    try {
      await api.deleteProvider(providerId);
      if (activeId === providerId) await api.setActive(agent, null);
      await Promise.all([refreshProviders(), refreshSettings()]);
      notify('ok', '已删除');
    } catch (e: unknown) {
      notify('err', (e as Error).message);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={switchliteIcon} alt="" />
          <span>SwitchLite</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-agent">
            <AgentIcon id={agent} size={17} />
            <span>{currentAgent.name}</span>
          </span>
          <span className="hint">选择 Agent → 填 Base URL 和 API Key → 自动获取模型 → 一键接入</span>
        </div>
      </header>

      <div className="body">
        <AgentSidebar
          providers={providers}
          settings={settings}
          selected={agent}
          onSelect={setAgent}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <main className="main" key={agent}>
          <section className="agent-head">
            <div className="agent-head-main">
              <span className="agent-head-icon" style={{ background: AGENT_THEME[agent].tile }}>
                <AgentIcon id={agent} size={32} />
              </span>
              <div>
                <h1>{currentAgent.name}</h1>
                <span className="agent-desc">{currentAgent.desc}</span>
                <span className="hint">{currentAgent.configFile} · 写入前自动备份</span>
              </div>
            </div>
            {activeProvider && (
              <div className="agent-current">
                <span className="label">当前模型</span>
                <code>{activeProvider.selectedModel || '未选择'}</code>
              </div>
            )}
          </section>

          <QuickConnect presets={presets} targetName={currentAgent.name} busy={busy} onConnect={handleConnect} />

          <section className="card">
            <div className="card-head">
              <h3>已接入的供应商</h3>
              <span className="count">{connected.length} 个</span>
            </div>
            {connected.length ? (
              <div className="provider-list">
                {connected.map((p) => (
                  <ProviderCard
                    key={p.id}
                    provider={p}
                    preset={presetOf(p)}
                    active={p.id === activeId}
                    busy={busy}
                    onSetActive={handleSetActive}
                    onEdit={setEditing}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">
                <svg viewBox="0 0 48 48" width="46" height="46" aria-hidden="true">
                  <rect x="3" y="3" width="42" height="42" rx="11" fill="currentColor" opacity="0.08" />
                  <line x1="16" y1="21" x2="29" y2="21" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  <path d="M 29 16.5 L 35.5 21 L 29 25.5 Z" fill="currentColor" />
                  <line x1="32" y1="27" x2="19" y2="27" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  <path d="M 19 22.5 L 12.5 27 L 19 31.5 Z" fill="currentColor" />
                </svg>
                <span>还没有接入的供应商，在上方填入 Base URL 和 API Key 即可完成接入</span>
              </div>
            )}
          </section>
        </main>
      </div>

      {editing && (
        <ProviderEditModal provider={editing} busy={busy} onSave={handleEditSave} onFetch={handleEditFetch} onClose={() => setEditing(null)} />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} onError={(t) => notify('err', t)} />}
      <Toast toast={toast} />
    </div>
  );
}
