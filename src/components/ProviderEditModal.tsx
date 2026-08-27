import { useEffect, useState } from 'react';
import type { Preset, Protocol, Provider } from '../types';
import { ModelPicker } from './ModelPicker';

interface Props {
  provider: Provider;
  preset: Preset | null;
  busy: boolean;
  onSave: (patch: Partial<Provider>) => Promise<void>;
  onFetch: () => Promise<void>;
  onClose: () => void;
}

export function ProviderEditModal({ provider, preset, busy, onSave, onFetch, onClose }: Props) {
  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [anthropicUrl, setAnthropicUrl] = useState(provider.anthropicUrl || '');
  const [apiKey, setApiKey] = useState(provider.apiKey);
  const [protocol, setProtocol] = useState<Protocol>(provider.protocol);
  const [wireApi, setWireApi] = useState(provider.wireApi);
  const [selectedModel, setSelectedModel] = useState(provider.selectedModel || '');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    setName(provider.name);
    setBaseUrl(provider.baseUrl);
    setAnthropicUrl(provider.anthropicUrl || '');
    setApiKey(provider.apiKey);
    setProtocol(provider.protocol);
    setWireApi(provider.wireApi);
    if (provider.selectedModel) {
      setSelectedModel(provider.selectedModel);
    } else if (provider.models && provider.models.length > 0) {
      setSelectedModel(provider.models[0].id);
    }
  }, [provider.id, provider.updatedAt, provider.fetchedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = { name, baseUrl, anthropicUrl, apiKey, protocol, wireApi, selectedModel };

  const handleSaveOnly = async () => {
    setSaving(true);
    try {
      await onSave(patch);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndFetch = async () => {
    setFetching(true);
    try {
      await onSave(patch);
      await onFetch();
    } catch {
      // 错误由 onSave/onFetch 处理并提示 Toast，弹窗内保持打开状态
    } finally {
      setFetching(false);
    }
  };

  return (
    // 只能用右上角 × 关闭：误点空白处不应丢失正在编辑的内容
    <div className="modal-mask">
      <div className="modal provider-edit-modal" style={{ width: '720px' }}>
        <div className="modal-head">
          <div className="modal-title-group">
            <h3>编辑供应商</h3>
            <span className="hint">{name || provider.name || '配置供应商接入参数'}</span>
          </div>
          <button className="icon-btn close-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            <label className="field">
              <span>名称</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
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
              <span>Base URL</span>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
            </label>
            <label className="field wide">
              <span>API Key</span>
              <div className="key-row">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button className="btn ghost" type="button" onClick={() => setShowKey(!showKey)}>
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>
            </label>
            <label className="field">
              <span>Codex Wire API</span>
              <select value={wireApi} onChange={(e) => setWireApi(e.target.value)}>
                <option value="chat">chat</option>
                <option value="responses">responses</option>
                <option value="anthropic">anthropic</option>
                <option value="gemini">gemini</option>
              </select>
            </label>
            <label className="field">
              <span>Anthropic 兼容地址（Claude Code 用）</span>
              <input
                value={anthropicUrl}
                onChange={(e) => setAnthropicUrl(e.target.value)}
                placeholder="https://dashscope.aliyuncs.com/apps/anthropic"
                spellCheck={false}
              />
            </label>
          </div>

          {provider.lastFetchError && (
            <div className="alert error" style={{ marginTop: '14px' }}>
              <strong>上次获取失败：</strong>
              {provider.lastFetchError}
            </div>
          )}

          {/* 模型列表选择区域 */}
          {provider.models && provider.models.length > 0 ? (
            <div className="edit-models-section" style={{ marginTop: '18px', borderTop: '1px dashed var(--line)', paddingTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <strong style={{ fontSize: '13.5px' }}>选择模型</strong>
                  <span className="hint">
                    {selectedModel ? (
                      <>
                        已选模型：<code style={{ color: 'var(--accent)', fontWeight: 650 }}>{selectedModel}</code>
                      </>
                    ) : (
                      <span style={{ color: 'var(--warn)' }}>未选择模型</span>
                    )}
                  </span>
                </div>
                <span className="hint">共 {provider.models.length} 个可用模型</span>
              </div>

              <div className="picker-container-card">
                <ModelPicker
                  models={provider.models}
                  preset={preset}
                  selectedId={selectedModel}
                  actionLabel="选择"
                  busy={busy || saving || fetching}
                  onPick={(modelId) => {
                    setSelectedModel(modelId);
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="hint" style={{ marginTop: '16px', textAlign: 'center', padding: '14px', background: 'var(--panel-soft)', borderRadius: '10px', border: '1px dashed var(--line)' }}>
              💡 点击下方「保存并重新获取模型」可自动拉取并展示该供应商的全部可用模型
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" disabled={busy || saving || fetching} onClick={handleSaveOnly}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            className="btn primary"
            disabled={busy || saving || fetching || !baseUrl.trim()}
            onClick={handleSaveAndFetch}
          >
            {fetching ? (
              <>
                <span className="spinner" />
                正在获取模型…
              </>
            ) : (
              '保存并重新获取模型'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
