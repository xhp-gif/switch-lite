import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ModelInfo, Preset, Protocol } from '../types';
import { ModelPicker } from './ModelPicker';
import { inferFromInput } from '../infer';

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
  const [customModelId, setCustomModelId] = useState('');
  const [autoHealedUrl, setAutoHealedUrl] = useState('');

  const preset = presets.find((p) => p.id === presetId) || null;

  useEffect(() => {
    if (preset) {
      setBaseUrl(preset.baseUrl || '');
      setProtocol(preset.protocol);
      setName(preset.name);
    }
  }, [preset]);

  // 当用户输入/粘贴 API Key 或 Base URL 时，进行智能感知推导
  const handleKeyChange = (newKey: string) => {
    setApiKey(newKey);
    const hint = inferFromInput(baseUrl, newKey, presets);
    if (hint) {
      if (hint.protocol) setProtocol(hint.protocol);
      if (hint.presetId && !presetId) setPresetId(hint.presetId);
      if (hint.baseUrl && (!baseUrl || baseUrl.trim() === '')) setBaseUrl(hint.baseUrl);
      if (hint.name && (!name || name.trim() === '')) setName(hint.name);
    }
  };

  const handleUrlChange = (newUrl: string) => {
    setBaseUrl(newUrl);
    setAutoHealedUrl('');
    const hint = inferFromInput(newUrl, apiKey, presets);
    if (hint) {
      if (hint.protocol) setProtocol(hint.protocol);
      if (hint.presetId && !presetId) setPresetId(hint.presetId);
      if (hint.name && (!name || name.trim() === '')) setName(hint.name);
    }
  };

  const handleFetch = async () => {
    if (!baseUrl.trim()) return;
    setLoading(true);
    setError('');
    setModels([]);
    setEndpoint('');
    setAutoHealedUrl('');
    try {
      const r = await api.fetchModelsRaw({ baseUrl, apiKey, protocol });
      setModels(r.models);
      setEndpoint(r.endpoint);
      if (r.resolvedBaseUrl && r.resolvedBaseUrl !== baseUrl.trim().replace(/\/+$/, '')) {
        setBaseUrl(r.resolvedBaseUrl);
        setAutoHealedUrl(r.resolvedBaseUrl);
      }
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
          <span className="hint">填 Base URL 和 API Key → 自动推测协议与端点 → 点选模型即完成接入</span>
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
          <span>Base URL（支持纯域名或完整 URL，自动补全及探测）</span>
          <input
            value={baseUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="如 api.deepseek.com、qianfan.baidubce.com 或 https://xxx/v1"
            spellCheck={false}
          />
        </label>
        <label className="field wide">
          <span>API Key（根据 Key 前缀自动识别厂商与协议）</span>
          <div className="key-row">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => handleKeyChange(e.target.value)}
              placeholder="sk-… / bce-v3/… / AIza…"
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
              正在探测并获取模型…
            </>
          ) : (
            '获取模型列表'
          )}
        </button>
        {endpoint && (
          <span className="hint ok-text">
            来自 {endpoint} · 共 {models.length} 个可用模型
            {autoHealedUrl && `（已自动校准 Base URL）`}
          </span>
        )}
      </div>

      {error && (
        <div className="alert error" style={{ marginTop: '12px' }}>
          <strong>获取提示：</strong>
          {error}
        </div>
      )}

      {/* 模型选择列表 */}
      {models.length > 0 && (
        <div className="picker-wrap" style={{ marginTop: '14px' }}>
          <ModelPicker
            models={models}
            preset={preset}
            actionLabel={`接入 ${targetName}`}
            busy={busy}
            onPick={(id) => onConnect({ presetId, name, baseUrl, apiKey, protocol }, id)}
          />
        </div>
      )}

      {/* 手动指定模型 ID 兜底输入框 */}
      <div style={{ marginTop: '14px', padding: '12px', background: 'var(--panel-soft)', borderRadius: '10px', border: '1px dashed var(--line)' }}>
        <div style={{ fontSize: '12.5px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>💡</span>
          <strong>手动指定模型接入</strong>
          <span className="hint">（若网关未开放公开模型列表，可直接填入模型 ID）</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            style={{ flex: 1 }}
            placeholder="输入模型 ID，如 deepseek-v3 / glm-5.2 / kimi-k2.5 / gpt-4o"
            value={customModelId}
            onChange={(e) => setCustomModelId(e.target.value)}
            spellCheck={false}
          />
          <button
            className="btn primary"
            disabled={busy || !baseUrl.trim() || !customModelId.trim()}
            onClick={() => onConnect({ presetId, name, baseUrl, apiKey, protocol }, customModelId.trim())}
          >
            直接接入 {targetName}
          </button>
        </div>
      </div>
    </section>
  );
}
