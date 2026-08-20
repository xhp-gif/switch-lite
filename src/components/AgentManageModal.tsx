import { useState } from 'react';
import { BUILTIN_AGENTS, type Agent } from '../agents';
import { AGENT_THEME, AgentIcon } from './AgentIcon';
import type { CustomAgent, Target } from '../types';
import { api } from '../api';

interface Props {
  enabledAgentIds: string[];
  customAgents: CustomAgent[];
  onToggleEnabled: (id: string) => void;
  onCustomAgentsChange: (list: CustomAgent[]) => void;
  onSelectAgent: (target: Target) => void;
  onClose: () => void;
  onError: (text: string) => void;
}

export function AgentManageModal({
  enabledAgentIds,
  customAgents,
  onToggleEnabled,
  onCustomAgentsChange,
  onSelectAgent,
  onClose,
  onError,
}: Props) {
  const [tab, setTab] = useState<'builtin' | 'custom'>('builtin');

  // 自定义 Agent 表单
  const [customName, setCustomName] = useState('');
  const [customIcon, setCustomIcon] = useState('✦');
  const [customConfigFile, setCustomConfigFile] = useState('');
  const [customFormat, setCustomFormat] = useState<'json' | 'toml' | 'yaml'>('json');
  const [adding, setAdding] = useState(false);

  const handleAddCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || !customConfigFile.trim()) {
      onError('请填写 Agent 名称与配置文件路径');
      return;
    }
    setAdding(true);
    try {
      const res = await api.createCustomAgent({
        name: customName.trim(),
        icon: customIcon.trim() || '✦',
        configFile: customConfigFile.trim(),
        format: customFormat,
      });
      onCustomAgentsChange(res.agents);
      onToggleEnabled(res.agent.id);
      setCustomName('');
      setCustomConfigFile('');
      setTab('custom');
      onSelectAgent(res.agent.id);
    } catch (err: unknown) {
      onError('添加自定义 Agent 失败: ' + (err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteCustom = async (id: string) => {
    try {
      const res = await api.deleteCustomAgent(id);
      onCustomAgentsChange(res.agents);
    } catch (err: unknown) {
      onError('删除失败: ' + (err as Error).message);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal agent-manage-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-group">
            <div className="modal-badge-title">
              <span className="modal-title-dot" />
              <h3>Agent 智能体管理</h3>
            </div>
            <p className="muted-text">按需定制侧边栏展示的 AI 编程助手，或接入任意新兴国产 Agent</p>
          </div>
          <button className="btn ghost icon-only close-btn" onClick={onClose} title="关闭">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="agent-segmented-wrap">
          <div className="agent-segmented-control">
            <button
              className={`segmented-item ${tab === 'builtin' ? 'active' : ''}`}
              onClick={() => setTab('builtin')}
            >
              <span>官方支持库</span>
              <span className="seg-badge">{BUILTIN_AGENTS.length}</span>
            </button>
            <button
              className={`segmented-item ${tab === 'custom' ? 'active' : ''}`}
              onClick={() => setTab('custom')}
            >
              <span>自定义接入</span>
              {customAgents.length > 0 && <span className="seg-badge custom">{customAgents.length}</span>}
            </button>
          </div>
        </div>

        <div className="agent-manage-body">
          {tab === 'builtin' && (
            <div className="builtin-agents-grid">
              {BUILTIN_AGENTS.map((a: Agent) => {
                const isEnabled = enabledAgentIds.includes(a.id);
                const theme = AGENT_THEME[a.id] || { tile: '#f4f4f6' };
                return (
                  <div className={`agent-card-item ${isEnabled ? 'enabled' : 'disabled'}`} key={a.id}>
                    <div className="agent-card-left">
                      <span className="agent-tile small-lux" style={{ background: theme.tile }}>
                        <AgentIcon id={a.id} size={22} />
                      </span>
                      <div className="agent-card-texts">
                        <div className="agent-card-title-row">
                          <span className="agent-card-name">{a.name}</span>
                          <span className="agent-tag builtin">官方支持</span>
                        </div>
                        <p className="agent-card-desc">{a.desc}</p>
                        <code className="agent-card-path">{a.configFile}</code>
                      </div>
                    </div>

                    <div className="agent-card-right">
                      <label className="switch-label" title={isEnabled ? '已启用（显示在侧边栏）' : '已隐藏'}>
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => onToggleEnabled(a.id)}
                        />
                        <span className="switch-slider" />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'custom' && (
            <div className="custom-agents-section">
              <form className="custom-agent-form card-lux" onSubmit={handleAddCustom}>
                <div className="form-head-lux">
                  <span className="form-icon-pill">➕</span>
                  <div>
                    <h4>接入新的国产 / 自定义 Agent</h4>
                    <span className="hint">配置一次即可在 SwitchLite 中一键秒切模型</span>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group flex-2">
                    <label>Agent 名称 *</label>
                    <input
                      type="text"
                      className="input-lux"
                      placeholder="如：DeepSeek-CLI / QAnywhere"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                    />
                  </div>
                  <div className="form-group flex-1">
                    <label>图标字符</label>
                    <input
                      type="text"
                      className="input-lux"
                      placeholder="✦ / ⚡ / 🤖"
                      value={customIcon}
                      onChange={(e) => setCustomIcon(e.target.value)}
                    />
                  </div>
                  <div className="form-group flex-1">
                    <label>配置格式</label>
                    <select className="select-lux" value={customFormat} onChange={(e) => setCustomFormat(e.target.value as 'json')}>
                      <option value="json">JSON 格式</option>
                      <option value="toml">TOML 格式</option>
                      <option value="yaml">YAML 格式</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>配置文件路径 (支持 ~ 或绝对路径) *</label>
                  <input
                    type="text"
                    className="input-lux"
                    placeholder="如：~/.myagent/config.json 或 D:\tools\myagent\settings.json"
                    value={customConfigFile}
                    onChange={(e) => setCustomConfigFile(e.target.value)}
                  />
                </div>

                <div className="form-actions-lux">
                  <button type="submit" className="btn primary-lux" disabled={adding}>
                    {adding ? '正在接入…' : '保存并添加到侧边栏'}
                  </button>
                </div>
              </form>

              <div className="custom-agents-list">
                <div className="list-head-lux">
                  <h5>已添加的自定义 Agent</h5>
                  <span className="count-pill">{customAgents.length}</span>
                </div>
                {customAgents.length === 0 ? (
                  <div className="empty-lux">
                    <svg viewBox="0 0 24 24" width="32" height="32" opacity="0.3">
                      <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                    </svg>
                    <span>暂未添加任何自定义 Agent，填写上方表单即可秒级接入</span>
                  </div>
                ) : (
                  customAgents.map((ca) => {
                    const isEnabled = enabledAgentIds.includes(ca.id);
                    return (
                      <div className="agent-card-item custom" key={ca.id}>
                        <div className="agent-card-left">
                          <span className="agent-tile small-lux custom-glyph-tile">
                            {ca.icon || '✦'}
                          </span>
                          <div className="agent-card-texts">
                            <div className="agent-card-title-row">
                              <span className="agent-card-name">{ca.name}</span>
                              <span className="agent-tag custom">自定义</span>
                            </div>
                            <code className="agent-card-path">{ca.configFile}</code>
                          </div>
                        </div>

                        <div className="agent-card-right">
                          <label className="switch-label" title={isEnabled ? '显示在侧栏' : '隐藏'}>
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={() => onToggleEnabled(ca.id)}
                            />
                            <span className="switch-slider" />
                          </label>
                          <button
                            className="btn ghost danger small"
                            onClick={() => handleDeleteCustom(ca.id)}
                            title="删除自定义 Agent"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
