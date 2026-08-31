import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MatchedVariant, ModelInfo, Preset, PresetVariant, Protocol } from '../types';
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

const normUrl = (u: string) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();

export function QuickConnect({ presets, targetName, busy, onConnect }: Props) {
  const [presetId, setPresetId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [protocol, setProtocol] = useState<Protocol>('openai');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [endpoint, setEndpoint] = useState('');
  const [error, setError] = useState('');
  const [autoHealedUrl, setAutoHealedUrl] = useState('');
  const [matchedVariant, setMatchedVariant] = useState<MatchedVariant | null>(null);

  const preset = presets.find((p) => p.id === presetId) || null;
  const variants: PresetVariant[] = preset?.variants || [];

  // 选择厂商预设时填入默认端点；但若当前 URL 已经是该预设登记过的某个
  // 端点（如粘贴的编程订阅地址、探针自动切换的地址），保留不动
  useEffect(() => {
    if (!preset) {
      setVariantId('');
      return;
    }
    const cur = normUrl(baseUrl);
    const hit = variants.find((v) => normUrl(v.baseUrl) === cur);
    if (hit) {
      setVariantId(hit.id);
    } else {
      setBaseUrl(preset.baseUrl || '');
      setVariantId(variants[0]?.id || '');
      setProtocol(preset.protocol);
    }
    setName(preset.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // 切换按量/订阅端点
  const handleVariantChange = (v: PresetVariant) => {
    if (!preset) return;
    setVariantId(v.id);
    setBaseUrl(v.baseUrl);
    setProtocol(v.protocol || preset.protocol);
    setName((prev) => {
      const isDefaultVariant = variants[0]?.id === v.id;
      const suggested = isDefaultVariant ? preset.name : `${preset.name}（${v.label}）`;
      // 用户没起过自定义名字（还是预设名或带自动后缀）才跟随变体重命名
      return !prev || prev === preset.name || /^.+（.+）$/.test(prev) ? suggested : prev;
    });
  };

  // 当用户输入/粘贴 API Key 或 Base URL 时，进行智能感知推导
  const handleKeyChange = (newKey: string) => {
    setApiKey(newKey);
    const hint = inferFromInput(baseUrl, newKey, presets);
    if (hint) {
      if (hint.protocol) setProtocol(hint.protocol);
      if (hint.presetId && !presetId) setPresetId(hint.presetId);
      if (hint.variantId) setVariantId(hint.variantId);
      if (hint.baseUrl && (!baseUrl || baseUrl.trim() === '')) setBaseUrl(hint.baseUrl);
      if (hint.name && (!name || name.trim() === '')) setName(hint.name);
    }
  };

  const handleUrlChange = (newUrl: string) => {
    setBaseUrl(newUrl);
    setAutoHealedUrl('');
    setMatchedVariant(null);
    const hint = inferFromInput(newUrl, apiKey, presets);
    if (hint) {
      if (hint.protocol) setProtocol(hint.protocol);
      if (hint.presetId && !presetId) setPresetId(hint.presetId);
      if (hint.variantId) setVariantId(hint.variantId);
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
    setMatchedVariant(null);
    try {
      const r = await api.fetchModelsRaw({ baseUrl, apiKey, protocol });
      setModels(r.models);
      setEndpoint(r.endpoint);
      // 探针自动切换到了该厂商的另一个端点（如订阅 key 打按量地址 401 后命中订阅端点）
      if (r.matchedVariant) {
        setMatchedVariant(r.matchedVariant);
        if (r.matchedVariant.presetId) setPresetId(r.matchedVariant.presetId);
        setVariantId(r.matchedVariant.variantId || '');
        if (r.matchedVariant.protocol) setProtocol(r.matchedVariant.protocol);
      }
      if (r.resolvedBaseUrl && normUrl(r.resolvedBaseUrl) !== normUrl(baseUrl)) {
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
        {variants.length > 0 && (
          <div className="field wide">
            <span>接入方式（按量 / 订阅端点不同，key 不能混用）</span>
            <div className="variant-row">
              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`variant-chip${variantId === v.id ? ' active' : ''}`}
                  title={v.desc || v.baseUrl}
                  disabled={busy || loading}
                  onClick={() => handleVariantChange(v)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}
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
            {matchedVariant && (
              <>
                （已自动识别<code style={{ color: 'var(--accent)', fontWeight: 650 }}>{matchedVariant.label}</code>端点并校准 Base URL）
              </>
            )}
            {!matchedVariant && autoHealedUrl && `（已自动校准 Base URL）`}
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
    </section>
  );
}
