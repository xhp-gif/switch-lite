import { useEffect, useState } from 'react';
import type { Protocol, Provider } from '../types';

interface Props {
  provider: Provider;
  busy: boolean;
  onSave: (patch: Partial<Provider>) => Promise<void>;
  onFetch: () => Promise<void>;
  onClose: () => void;
}

export function ProviderEditModal({ provider, busy, onSave, onFetch, onClose }: Props) {
  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [anthropicUrl, setAnthropicUrl] = useState(provider.anthropicUrl || '');
  const [apiKey, setApiKey] = useState(provider.apiKey);
  const [protocol, setProtocol] = useState<Protocol>(provider.protocol);
  const [wireApi, setWireApi] = useState(provider.wireApi);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(provider.name);
    setBaseUrl(provider.baseUrl);
    setAnthropicUrl(provider.anthropicUrl || '');
    setApiKey(provider.apiKey);
    setProtocol(provider.protocol);
    setWireApi(provider.wireApi);
  }, [provider.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = { name, baseUrl, anthropicUrl, apiKey, protocol, wireApi };

  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    try {
      await fn();
    } finally {
      setSaving(false);
    }
  };

  return (
    // 只能用右上角 × 关闭：误点空白处不应丢失正在编辑的内容
    <div className="modal-mask">
      <div className="modal">
        <div className="modal-head">
          <h3>编辑供应商</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

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
              <button className="btn ghost" onClick={() => setShowKey(!showKey)}>
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
            <input value={anthropicUrl} onChange={(e) => setAnthropicUrl(e.target.value)} placeholder="https://dashscope.aliyuncs.com/apps/anthropic" spellCheck={false} />
          </label>
        </div>

        {provider.lastFetchError && (
          <div className="alert error">
            <strong>上次获取失败：</strong>
            {provider.lastFetchError}
          </div>
        )}

        <div className="modal-foot">
          <button className="btn" disabled={busy || saving} onClick={() => run(() => onSave(patch))}>
            保存
          </button>
          <button
            className="btn primary"
            disabled={busy || saving || !baseUrl.trim()}
            onClick={() => run(async () => {
              await onSave(patch);
              await onFetch();
            })}
          >
            保存并重新获取模型
          </button>
        </div>
      </div>
    </div>
  );
}
