import { useState, useMemo } from 'react';
import { BUILTIN_AGENTS, CUSTOM_AGENT_PRESETS, type Agent, type CustomAgentPreset } from '../agents';
import { AGENT_THEME, AgentIcon, PRESET_ICONS } from './AgentIcon';
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
  const [showGuide, setShowGuide] = useState(false);

  // 自定义 Agent 表单
  const [selectedPresetId, setSelectedPresetId] = useState<string>('kiro');
  const [customName, setCustomName] = useState('Kiro Agent');
  const [customIcon, setCustomIcon] = useState('kiro');
  const [customConfigFile, setCustomConfigFile] = useState('~/.kiro/config.json');
  const [customFormat, setCustomFormat] = useState<'json' | 'yaml' | 'toml' | 'env'>('json');
  const [customDesc, setCustomDesc] = useState('AWS / 独立 Kiro 智能体助手');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconCategory, setIconCategory] = useState<'all' | 'agent' | 'symbol'>('all');
  const [showPreview, setShowPreview] = useState(false);
  const [adding, setAdding] = useState(false);

  // 当点击推荐模版时自动填入表单
  const handleSelectPreset = (preset: CustomAgentPreset) => {
    setSelectedPresetId(preset.id);
    setCustomName(preset.name);
    setCustomIcon(preset.icon);
    setCustomConfigFile(preset.configFile);
    setCustomFormat(preset.format);
    setCustomDesc(preset.desc);
    setIconPickerOpen(false);
  };

  // 一键直接接入该模版
  const handleQuickAddPreset = async (preset: CustomAgentPreset) => {
    setAdding(true);
    try {
      const res = await api.createCustomAgent({
        name: preset.name,
        icon: preset.icon,
        configFile: preset.configFile,
        format: preset.format,
      });
      onCustomAgentsChange(res.agents);
      onToggleEnabled(res.agent.id);
      onSelectAgent(res.agent.id);
      setTab('custom');
    } catch (err: unknown) {
      onError('接入失败: ' + (err as Error).message);
    } finally {
      setAdding(false);
    }
  };

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
      onSelectAgent(res.agent.id);
      setCustomName('');
      setCustomConfigFile('');
      setTab('custom');
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

  const handleResetForm = () => {
    setSelectedPresetId('');
    setCustomName('');
    setCustomIcon('✦');
    setCustomConfigFile('');
    setCustomFormat('json');
    setCustomDesc('');
  };

  // 过滤后的图标列表
  const filteredIcons = useMemo(() => {
    if (iconCategory === 'all') return PRESET_ICONS;
    return PRESET_ICONS.filter((i) => i.category === iconCategory);
  }, [iconCategory]);

  // 实时生成注入配置预览
  const liveConfigSnippet = useMemo(() => {
    const relayUrl = 'http://127.0.0.1:23789/p/<供应商ID>';
    const sampleKey = 'sk-switchlite-auto-token';
    const sampleModel = 'deepseek-v3 / gpt-4o';
    if (customFormat === 'json') {
      return JSON.stringify(
        {
          baseUrl: relayUrl,
          apiKey: sampleKey,
          model: sampleModel,
          provider: 'DeepSeek / OpenAI',
        },
        null,
        2,
      );
    }
    if (customFormat === 'yaml') {
      return `base_url: "${relayUrl}"\napi_key: "${sampleKey}"\nmodel: "${sampleModel}"\nopenai-api-base: "${relayUrl}"\nopenai-api-key: "${sampleKey}"`;
    }
    if (customFormat === 'env') {
      return `OPENAI_BASE_URL="${relayUrl}"\nOPENAI_API_KEY="${sampleKey}"\nMODEL="${sampleModel}"`;
    }
    return `base_url = "${relayUrl}"\napi_key = "${sampleKey}"\nmodel = "${sampleModel}"`;
  }, [customFormat]);

  const activeTheme =
    AGENT_THEME[customIcon] ||
    AGENT_THEME[customName.toLowerCase()] || {
      tile: 'var(--panel-soft)',
      icon: 'var(--accent)',
      accent: 'var(--accent)',
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
            <p className="muted-text">
              管理侧边栏展示的 AI 助手，或将 Kiro、Aider、Continue 等任意智能体接入 SwitchLite 调度中继
            </p>
          </div>
          <button className="btn ghost icon-only close-btn" onClick={onClose} title="关闭">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                fill="currentColor"
                d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
              />
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
              <span>自定义 / 模版接入</span>
              {customAgents.length > 0 && <span className="seg-badge custom">{customAgents.length}</span>}
            </button>
          </div>
        </div>

        <div className="agent-manage-body">
          {tab === 'builtin' && (
            <div className="builtin-agents-grid">
              {BUILTIN_AGENTS.map((a: Agent) => {
                const isEnabled = enabledAgentIds.includes(a.id);
                const theme = AGENT_THEME[a.id] || { tile: 'var(--panel-soft)' };
                return (
                  <div className={`agent-card-item ${isEnabled ? 'enabled' : 'disabled'}`} key={a.id}>
                    <div className="agent-card-left">
                      <span className="agent-tile small-lux" style={{ background: theme.tile }}>
                        <AgentIcon id={a.id} size={22} />
                      </span>
                      <div className="agent-card-texts">
                        <div className="agent-card-title-row">
                          <span className="agent-card-name">{a.name}</span>
                          <span className="agent-tag builtin">官方内置</span>
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
              {/* 1. 工作原理与极速指南卡片 */}
              <div className="agent-guide-card">
                <div className="guide-head-row" onClick={() => setShowGuide(!showGuide)}>
                  <div className="guide-title-left">
                    <span className="guide-badge-icon">💡</span>
                    <div>
                      <span className="guide-title">什么是 Agent 壳接入？工作原理与使用示例</span>
                      <span className="guide-subtitle">轻松为 Kiro、Aider 等智能体赋予一键切换 DeepSeek/Claude 等模型的能力</span>
                    </div>
                  </div>
                  <button className="guide-toggle-btn" type="button">
                    {showGuide ? '收起指南 ▴' : '展开指南 ▾'}
                  </button>
                </div>

                {showGuide && (
                  <div className="guide-content-body">
                    <div className="guide-steps-grid">
                      <div className="guide-step-item">
                        <span className="step-num">1</span>
                        <div className="step-text">
                          <b>选择模版或填入路径</b>
                          <p>
                            以 <b>Kiro Agent</b> 为例，在下方点击模版自动填入配置路径 <code>~/.kiro/config.json</code>，点击保存并添加到侧栏。
                          </p>
                        </div>
                      </div>
                      <div className="guide-step-item">
                        <span className="step-num">2</span>
                        <div className="step-text">
                          <b>在主界面绑定模型</b>
                          <p>
                            在 SwitchLite 侧边栏选中 <b>Kiro Agent</b>，选择你配置的任意供应商（如 DeepSeek、OpenAI、SiliconFlow）。
                          </p>
                        </div>
                      </div>
                      <div className="guide-step-item">
                        <span className="step-num">3</span>
                        <div className="step-text">
                          <b>一键注入与极速编码</b>
                          <p>
                            点击「接入当前模型」，SwitchLite 会自动将中继地址与 Key 注入 Kiro，打开 Kiro 即可畅享全新模型！
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 2. 热门 Agent 快捷模版 */}
              <div className="agent-templates-section">
                <div className="section-title-row">
                  <span className="section-title">⚡ 推荐 Agent 快捷模版 (点击一键填入)</span>
                  <span className="section-hint">已预设官方推荐路径与专属高清徽标</span>
                </div>
                <div className="template-cards-grid">
                  {CUSTOM_AGENT_PRESETS.map((preset) => {
                    const isSelected = selectedPresetId === preset.id;
                    return (
                      <div
                        key={preset.id}
                        className={`template-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleSelectPreset(preset)}
                      >
                        <div className="template-card-top">
                          <span className="template-icon-tile">
                            <AgentIcon id={preset.icon} fallbackGlyph={preset.icon} size={22} />
                          </span>
                          <div className="template-info">
                            <div className="template-name-row">
                              <span className="template-name">{preset.name}</span>
                              <span className="template-format-badge">{preset.format.toUpperCase()}</span>
                            </div>
                            <span className="template-desc">{preset.desc}</span>
                          </div>
                        </div>
                        <div className="template-card-foot">
                          <code className="template-path-pill" title={preset.configFile}>
                            {preset.configFile}
                          </code>
                          <button
                            type="button"
                            className="btn small ghost primary-text"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleQuickAddPreset(preset);
                            }}
                            title="直接一键接入该模版"
                          >
                            + 一键接入
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. 自定义 / 模版接入配置表单 */}
              <form className="custom-agent-form card-lux" onSubmit={handleAddCustom}>
                <div className="form-head-lux">
                  <div className="form-head-left">
                    <span className="agent-tile small-lux" style={{ background: activeTheme.tile }}>
                      <AgentIcon id={customIcon} fallbackGlyph={customIcon} size={22} />
                    </span>
                    <div>
                      <h4>{customName ? `配置 ${customName}` : '接入新的 Agent 智能体'}</h4>
                      <span className="hint">
                        {customDesc || '配置一次即可在 SwitchLite 侧边栏中随时随地一键秒切模型'}
                      </span>
                    </div>
                  </div>
                  {selectedPresetId && (
                    <span className="preset-selected-tag">
                      当前模版：{CUSTOM_AGENT_PRESETS.find((p) => p.id === selectedPresetId)?.name || '自定义'}
                    </span>
                  )}
                </div>

                <div className="form-row">
                  <div className="form-group flex-2">
                    <label>Agent 名称 *</label>
                    <input
                      type="text"
                      className="input-lux"
                      placeholder="如：Kiro Agent / Aider / My-CLI"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                    />
                  </div>

                  <div className="form-group flex-1">
                    <label>专属图标</label>
                    <div className="icon-selector-field">
                      <button
                        type="button"
                        className="icon-picker-btn"
                        onClick={() => setIconPickerOpen(!iconPickerOpen)}
                        title="点击选择官方图标或 Emoji"
                      >
                        <span className="picker-tile-preview">
                          <AgentIcon id={customIcon} fallbackGlyph={customIcon} size={18} />
                        </span>
                        <span className="picker-label-text">
                          {PRESET_ICONS.find((i) => i.id === customIcon)?.label || customIcon || '选择图标'}
                        </span>
                        <span className="picker-arrow">▾</span>
                      </button>

                      {iconPickerOpen && (
                        <div className="icon-picker-popover">
                          <div className="icon-picker-tabs">
                            <button
                              type="button"
                              className={`icon-tab-btn ${iconCategory === 'all' ? 'active' : ''}`}
                              onClick={() => setIconCategory('all')}
                            >
                              全部
                            </button>
                            <button
                              type="button"
                              className={`icon-tab-btn ${iconCategory === 'agent' ? 'active' : ''}`}
                              onClick={() => setIconCategory('agent')}
                            >
                              Agent 官方徽标
                            </button>
                            <button
                              type="button"
                              className={`icon-tab-btn ${iconCategory === 'symbol' ? 'active' : ''}`}
                              onClick={() => setIconCategory('symbol')}
                            >
                              符号 & Emoji
                            </button>
                          </div>

                          <div className="icon-picker-grid">
                            {filteredIcons.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className={`icon-grid-item ${customIcon === item.id ? 'active' : ''}`}
                                onClick={() => {
                                  setCustomIcon(item.id);
                                  setIconPickerOpen(false);
                                }}
                                title={item.label}
                              >
                                <span className="icon-grid-tile">
                                  <AgentIcon id={item.id} fallbackGlyph={item.id} size={20} />
                                </span>
                                <span className="icon-grid-label">{item.label.split(' ')[0]}</span>
                              </button>
                            ))}
                          </div>

                          <div className="icon-picker-custom-row">
                            <span className="custom-input-label">自定义字符/Emoji:</span>
                            <input
                              type="text"
                              className="input-lux mini"
                              placeholder="粘贴任意 Emoji / 文字"
                              value={customIcon}
                              onChange={(e) => setCustomIcon(e.target.value)}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="form-group flex-1">
                    <label>配置文件格式</label>
                    <select
                      className="select-lux"
                      value={customFormat}
                      onChange={(e) => setCustomFormat(e.target.value as 'json')}
                    >
                      <option value="json">JSON 格式 (.json)</option>
                      <option value="yaml">YAML 格式 (.yaml / .yml)</option>
                      <option value="toml">TOML 格式 (.toml)</option>
                      <option value="env">ENV 格式 (.env)</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <div className="label-with-hint">
                    <label>配置文件路径 (支持 ~ 或绝对路径) *</label>
                    <span className="path-sub-hint">Windows 下 ~ 自动展开为当前用户主目录</span>
                  </div>
                  <input
                    type="text"
                    className="input-lux"
                    placeholder="如：~/.kiro/config.json 或 %APPDATA%\Kiro\User\settings.json"
                    value={customConfigFile}
                    onChange={(e) => setCustomConfigFile(e.target.value)}
                  />

                  {/* 快捷路径快速填入 Chips */}
                  <div className="path-chips-row">
                    <span className="chips-title">快捷填入路径：</span>
                    <button
                      type="button"
                      className="path-chip"
                      onClick={() => setCustomConfigFile('~/.kiro/config.json')}
                    >
                      ~/.kiro/config.json
                    </button>
                    <button
                      type="button"
                      className="path-chip"
                      onClick={() => setCustomConfigFile('~/.aider.conf.yml')}
                    >
                      ~/.aider.conf.yml
                    </button>
                    <button
                      type="button"
                      className="path-chip"
                      onClick={() => setCustomConfigFile('~/.continue/config.json')}
                    >
                      ~/.continue/config.json
                    </button>
                    <button
                      type="button"
                      className="path-chip"
                      onClick={() => setCustomConfigFile('~/.cline/settings.json')}
                    >
                      ~/.cline/settings.json
                    </button>
                  </div>
                </div>

                {/* 注入配置实时预览 */}
                <div className="config-preview-section">
                  <div className="preview-header-row" onClick={() => setShowPreview(!showPreview)}>
                    <span className="preview-title">
                      ⚙️ SwitchLite 自动注入配置预览 ({customFormat.toUpperCase()})
                    </span>
                    <span className="preview-toggle-btn">{showPreview ? '收起 ▴' : '展开查看 ▾'}</span>
                  </div>
                  {showPreview && (
                    <pre className="config-code-preview">
                      <code>{liveConfigSnippet}</code>
                    </pre>
                  )}
                </div>

                <div className="form-actions-lux">
                  <button type="button" className="btn ghost" onClick={handleResetForm}>
                    清空重置
                  </button>
                  <button type="submit" className="btn primary-lux" disabled={adding}>
                    {adding ? '正在接入…' : '保存并添加到侧边栏'}
                  </button>
                </div>
              </form>

              {/* 4. 已添加的自定义 Agent 列表 */}
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
                    <span>暂未添加任何自定义 Agent，选择上方模版或填写表单即可秒级接入</span>
                  </div>
                ) : (
                  customAgents.map((ca) => {
                    const isEnabled = enabledAgentIds.includes(ca.id);
                    const theme =
                      AGENT_THEME[ca.icon] ||
                      AGENT_THEME[ca.id] || {
                        tile: 'var(--panel-soft)',
                      };
                    return (
                      <div className="agent-card-item custom" key={ca.id}>
                        <div className="agent-card-left">
                          <span className="agent-tile small-lux" style={{ background: theme.tile }}>
                            <AgentIcon id={ca.icon || ca.id} fallbackGlyph={ca.icon || '✦'} size={22} />
                          </span>
                          <div className="agent-card-texts">
                            <div className="agent-card-title-row">
                              <span className="agent-card-name">{ca.name}</span>
                              <span className="agent-tag custom">自定义</span>
                              {ca.format && (
                                <span className="agent-format-pill">{ca.format.toUpperCase()}</span>
                              )}
                            </div>
                            <code className="agent-card-path">{ca.configFile}</code>
                          </div>
                        </div>

                        <div className="agent-card-right">
                          <button
                            className="btn ghost small"
                            onClick={() => {
                              onSelectAgent(ca.id);
                              onClose();
                            }}
                            title="立即在侧边栏选择此 Agent"
                          >
                            立即切换
                          </button>
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

