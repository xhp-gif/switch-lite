export type Protocol = 'openai' | 'anthropic' | 'gemini';
export type BuiltinTarget =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'opencode'
  | 'hermes'
  | 'cursor'
  | 'grok'
  | 'deepseek_harness'
  | 'tare'
  | 'qcoder'
  | 'zcode';

export type Target = BuiltinTarget | string;

export interface CustomAgent {
  id: string;
  name: string;
  icon: string;
  desc: string;
  configFile: string;
  format?: 'json' | 'toml' | 'yaml' | 'env';
  custom?: boolean;
}

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

// 同厂商多端点变体：按量 API 与编程订阅的 URL/协议可能不同
export interface PresetVariant {
  id: string;
  label: string;
  desc?: string;
  baseUrl: string;
  protocol?: Protocol;
  wireApi?: string;
}

// 探针自动切换命中的端点变体
export interface MatchedVariant {
  presetId?: string | null;
  variantId?: string | null;
  label?: string;
  baseUrl?: string;
  protocol?: Protocol;
  wireApi?: string | null;
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
  variants?: PresetVariant[];
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
  resolvedBaseUrl?: string;
  matchedVariant?: MatchedVariant | null;
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
