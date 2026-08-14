export type Protocol = 'openai' | 'anthropic' | 'gemini';
export type Target = 'claude' | 'codex' | 'gemini' | 'opencode' | 'hermes';

export interface RecommendedModel {
  id: string;
  available: boolean;
}

export interface RecommendedSeries {
  series: string;
  note: string;
  items: RecommendedModel[];
}

export interface PresetRecommended {
  series: string;
  note: string;
  models: string[];
}

export interface Preset {
  id: string;
  name: string;
  baseUrl: string;
  anthropicUrl?: string;
  protocol: Protocol;
  wireApi: string;
  auth: string;
  hugeCatalog?: boolean;
  description?: string;
  recommended?: PresetRecommended[];
}

export interface ModelInfo {
  id: string;
}

export interface Provider {
  id: string;
  name: string;
  presetId: string;
  target: Target;
  baseUrl: string;
  anthropicUrl?: string;
  apiKey: string;
  protocol: Protocol;
  wireApi: string;
  selectedModel?: string;
  models: ModelInfo[];
  fetchedAt?: string;
  lastFetchError?: string;
  lastApplied?: { target: Target; at: string };
  lastSpeedtest?: { at: string; ok: boolean; latencyMs: number; error?: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface FetchResult {
  models: ModelInfo[];
  endpoint: string;
  count: number;
  attempts: { url: string; status: number; ok: boolean; error?: string | null }[];
}

export interface ConfigStatusEntry {
  file: string;
  exists: boolean;
  mtime?: string;
  backups: string[];
}

export interface Settings {
  active: Partial<Record<Target, string | null>>;
  failover?: boolean;
}

export interface RelayStatus {
  ok: boolean;
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  uptimeSec: number;
  port: number;
  origin: string;
  autostart: boolean;
  autostartSupported: boolean;
}

export interface HistoryEntry {
  model: string;
  providerId: string;
  providerName: string;
  available: boolean;
  at: string;
}

export interface UsageEvent {
  ts: string;
  providerId: string;
  providerName: string;
  target: Target | '';
  model: string;
  input: number;
  output: number;
  total: number;
  cached?: number;
  durationMs?: number;
  status?: number;
  ok?: boolean;
  source?: 'session';
  retried?: boolean;
  failoverFrom?: string;
  failoverTo?: string;
}

export interface UsageProviderStat {
  providerId: string;
  name: string;
  target: Target | '';
  requests: number;
  input: number;
  output: number;
  total: number;
  cached: number;
  errors: number;
}

export interface UsageModelStat {
  model: string;
  provider: string;
  requests: number;
  input: number;
  output: number;
  total: number;
  cached: number;
  errors: number;
}

export interface UsageDayStat {
  date: string;
  requests: number;
  input: number;
  output: number;
  total: number;
}

export interface UsageSummary {
  days: number;
  totals: {
    requests: number;
    input: number;
    output: number;
    total: number;
    cached: number;
    errors: number;
    avgDurationMs: number;
  };
  byProvider: UsageProviderStat[];
  byModel: UsageModelStat[];
  daily: UsageDayStat[];
  recent: UsageEvent[];
}
