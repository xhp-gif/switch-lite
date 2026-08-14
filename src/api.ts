import type { ConfigStatusEntry, FetchResult, HistoryEntry, Preset, Provider, Settings, Target, UsageSummary } from './types';

interface ApiError extends Error {
  provider?: Provider;
  attempts?: FetchResult['attempts'];
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || `请求失败 (${res.status})`) as ApiError;
    err.provider = (data as { provider?: Provider }).provider;
    err.attempts = (data as { attempts?: FetchResult['attempts'] }).attempts;
    throw err;
  }
  return data as T;
}

export const api = {
  health: () => req<{ ok: boolean; version: string; ccSwitchRunning?: boolean }>('/api/health'),
  presets: () => req<Preset[]>('/api/presets'),
  providers: () => req<Provider[]>('/api/providers'),
  createProvider: (body: Partial<Provider>) =>
    req<Provider>('/api/providers', { method: 'POST', body: JSON.stringify(body) }),
  updateProvider: (id: string, body: Partial<Provider>) =>
    req<Provider>(`/api/providers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProvider: (id: string) => req<{ ok: boolean }>(`/api/providers/${id}`, { method: 'DELETE' }),
  fetchModels: (id: string) =>
    req<FetchResult & { provider: Provider }>(`/api/providers/${id}/fetch-models`, { method: 'POST' }),
  fetchModelsRaw: (body: { baseUrl: string; apiKey: string; protocol: string }) =>
    req<FetchResult>('/api/fetch-models', { method: 'POST', body: JSON.stringify(body) }),
  applyConfig: (providerId: string, target: Target, modelId: string) =>
    req<{ target: string; file: string; backup: string | null; model: string; warning?: string | null }>('/api/config/apply', {
      method: 'POST',
      body: JSON.stringify({ providerId, target, modelId }),
    }),
  configStatus: () => req<Record<string, ConfigStatusEntry>>('/api/config/status'),
  usageSummary: (days: number) => req<UsageSummary>(`/api/usage/summary?days=${days}`),
  clearUsage: () => req<{ ok: boolean }>('/api/usage', { method: 'DELETE' }),
  getRelayAutostart: () => req<{ supported: boolean; enabled: boolean }>('/api/relay/autostart'),
  setRelayAutostart: (enabled: boolean) =>
    req<{ supported: boolean; enabled: boolean }>('/api/relay/autostart', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  getSettings: () => req<Settings>('/api/settings'),
  setActive: (target: Target, providerId: string | null) =>
    req<Settings>('/api/settings/active', {
      method: 'PUT',
      body: JSON.stringify({ target, providerId }),
    }),
  speedtest: (id: string) =>
    req<{ ok: boolean; latencyMs: number; warning?: string; error?: string; provider: Provider }>(
      `/api/providers/${id}/speedtest`,
      { method: 'POST' },
    ),
  speedtestAll: () => req<{ providers: Provider[] }>('/api/speedtest', { method: 'POST' }),
  updateSettings: (body: Partial<Settings>) => req<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  history: (target: Target) => req<{ history: HistoryEntry[] }>(`/api/history?target=${target}`),
};
