import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ModelInfo, Preset, Protocol } from '../types';
import { ModelPicker } from './ModelPicker';

export interface ConnectForm {
  presetId: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  protocol: Protocol;
}

interface Props {
  presets: Preset[];
  targetName: string;
  busy: boolean;
  onConnect: (form: ConnectForm, modelId: string) => void;
}

export function QuickConnect({ presets, targetName, busy, onConnect }: Props) {
  const [presetId, setPresetId] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [protocol, setProtocol] = useState<Protocol>('openai');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [endpoint, setEndpoint] = useState('');
  const [error, setError] = useState('');

  const preset = presets.find((p) => p.id === presetId) || null;

  useEffect(() => {
    if (preset) {
      setBaseUrl(preset.baseUrl || '');
      setProtocol(preset.protocol);
      setName(preset.name);
    }
  }, [preset]);

  const handleFetch = async () => {
    if (!baseUrl.trim()) return;
    setLoading(true);
    setError('');
    setModels([]);
    setEndpoint('');
    try {
      const r = await api.fetchModelsRaw({ baseUrl, apiKey, protocol });
      setModels(r.models);
      setEndpoint(r.endpoint);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card quick-card">
      <div className="card-head">
        <div className="models-title">
          <h3>快速接入 {targetName}</h3>
          <span className="hint">填 Base URL 和 API Key → 自动获取模型 → 点选模型即完成接入</span>
        </div>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>厂商预设（可选）</span>
          <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            <option value="">自定义</option>
            {presets
              .filter((p) => p.id !== 'custom')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>协议</span>
          <select value={protocol} onChange={(e) => setProtocol(e.target.value as Protocol)}>
            <option value="openai">OpenAI 兼容</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
        <label className="field wide">
          <span>Base URL（含 /v1、/chat/completions 等均可自动归一化）</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com 或 https://xxx/v1"
            spellCheck={false}
          />
        </label>
        <label className="field wide">
          <span>API Key（公开列表 / 本地服务可留空）</span>
          <div className="key-row">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              spellCheck={false}
              autoComplete="off"
            />
            <button className="btn ghost" onClick={() => setShowKey(!showKey)}>
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
        </label>
      </div>

      <div className="card-foot">
        <button className="btn primary" onClick={handleFetch} disabled={busy || loading || !baseUrl.trim()}>
          {loading ? (
            <>
              <span className="spinner" />
              获取中…
            </>
          ) : (
            '根据 URL 获取模型'
          )}
        </button>
        {endpoint && (
          <span className="hint ok-text">
            来自 {endpoint} · 共 {models.length} 个模型
          </span>
        )}
      </div>

      {error && (
        <div className="alert error">
          <strong>获取失败：</strong>
          {error}
        </div>
      )}

      {models.length > 0 && (
        <div className="picker-wrap">
          <ModelPicker models={models} preset={preset} actionLabel={`接入 ${targetName}`} busy={busy} onPick={(id) => onConnect({ presetId, name, baseUrl, apiKey, protocol }, id)} />
        </div>
      )}
    </section>
  );
}
