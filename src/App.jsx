import { useEffect, useMemo, useRef, useState } from "react";
import { 
  Plus, 
  Settings, 
  Library, 
  BookOpen, 
  History, 
  ChevronLeft, 
  ChevronRight, 
  RotateCcw, 
  GitFork, 
  Sparkles, 
  Send, 
  Download, 
  FileText,
  Zap,
  Loader2,
  Trash2
} from "lucide-react";
import { Modal } from "./components/Modal";
import { StoryTree } from "./components/StoryTree";
import { StoryForm } from "./components/StoryForm";
import { SettingsModal } from "./components/SettingsModal";
import { useAppStore } from "./stores/useAppStore";
import { createId } from "./lib/id";
import { buildPrompt, buildSummaryPrompt, createGeneratedNode, requestCompletion } from "./lib/storyGeneration";
import {
  createDefaultState,
  createEmptyStory,
  emptyStoryDraft,
  getNode,
  getPathToRoot,
  getTemplate,
  loadState,
  persistState,
  countGeneratedNodes,
} from "./lib/storyState";
import { migrateModelConfig, normalizeProviderValue, createProviderFields } from "./lib/providerDefs";

function exportFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const {
    appState, loaded, status, ui, settings,
    setAppState, setLoaded, setStatus, setUI, updateModal, setSettings, toggleSidebar, resetInstruction
  } = useAppStore();

  const [storyDraft, setStoryDraft] = useState(emptyStoryDraft);
  const workspaceRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    loadState().then(next => {
      setAppState({
        ...next,
        activeStoryId: next.activeStoryId ?? next.stories[0]?.id ?? null,
      });
    }).catch(() => {
      setStatus("初始化数据库失败", "error");
      setAppState(createDefaultState());
    }).finally(() => setLoaded(true));
  }, [setAppState, setLoaded, setStatus]);

  useEffect(() => {
    if (loaded) persistState(appState).catch(() => setStatus("保存失败", "error"));
  }, [appState, loaded, setStatus]);

  useEffect(() => {
    if (ui.streamDraft && workspaceRef.current) {
      workspaceRef.current.scrollTo({ top: workspaceRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [ui.streamDraft]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [ui.instruction]);

  const activeStory = useMemo(() => 
    appState.stories.find(s => s.id === appState.activeStoryId) ?? null, 
  [appState]);

  const activePath = useMemo(() => 
    activeStory ? getPathToRoot(activeStory, activeStory.activeNodeId) : [], 
  [activeStory]);

  const activeStreamDraft = ui.streamDraft?.storyId === activeStory?.id ? ui.streamDraft : null;

  const updateActiveStory = (updater) => {
    setAppState(current => ({
      ...current,
      stories: current.stories.map(s => s.id === current.activeStoryId ? updater(structuredClone(s)) : s)
    }));
  };

  const openSettings = () => {
    const config = activeStory ? migrateModelConfig(activeStory.model) : appState.globalModel;
    const provider = normalizeProviderValue(config.provider);
    setSettings({
      provider,
      fields: settings.drafts[provider] ?? createProviderFields(config),
      modelOptions: null,
      testResult: null,
    });
    updateModal("settings", true);
  };

  const generate = async (mode) => {
    if (!activeStory || ui.isGenerating) return;
    const story = structuredClone(activeStory);
    const currentNode = getNode(story, story.activeNodeId);
    const parentId = mode === "rewrite" ? currentNode?.parentId ?? null : story.activeNodeId;
    const branchId = mode === "continue" ? (currentNode?.branchId ?? createId()) : createId();

    if (mode === "rewrite" && !parentId && !story.config.openingPrompt) {
      setStatus("根节点不可重写", "error");
      return;
    }

    setUI({ isGenerating: true, streamDraft: { storyId: story.id, content: "", mode } });
    setStatus("正在生成...", "loading");

    try {
      const payload = buildPrompt(story, mode, ui.instruction);
      const content = await requestCompletion(story.model, payload, (text) => {
        setUI(u => ({ ...u, streamDraft: { ...u.streamDraft, content: text } }));
      });

      const node = createGeneratedNode({ parentId, branchId, content, instruction: ui.instruction, mode });
      if (parentId) {
        const parent = getNode(story, parentId);
        if (parent) parent.childrenIds.push(node.id);
      }
      story.nodes.push(node);
      story.activeNodeId = node.id;
      story.updatedAt = new Date().toISOString();

      setAppState(curr => ({
        ...curr,
        stories: curr.stories.map(s => s.id === story.id ? story : s)
      }));
      resetInstruction();
      setStatus("生成完成", "idle");

      if (story.config.autoSummary && countGeneratedNodes(story) % story.config.summaryEvery === 0) {
        await generateSummary(story, true);
      }
    } catch (e) {
      setStatus(e.message || "生成失败", "error");
    } finally {
      setUI({ isGenerating: false, streamDraft: null });
    }
  };

  const generateSummary = async (target = activeStory, silent = false) => {
    if (!target) return;
    const story = structuredClone(target);
    const { payload, fallback, nodeIndex } = buildSummaryPrompt(story);

    setUI(u => ({ ...u, summaryDraft: { storyId: story.id, content: "" } }));
    if (!silent) setStatus("生成摘要中...", "loading");

    try {
      const content = await requestCompletion(story.model, payload, (text) => {
        setUI(u => ({ ...u, summaryDraft: { ...u.summaryDraft, content: text } }));
      });
      story.summaries.push({
        id: createId(), nodeId: story.activeNodeId, nodeIndex,
        title: `阶段摘要 ${story.summaries.length + 1}`,
        content, source: "AI", createdAt: new Date().toISOString(),
      });
    } catch {
      story.summaries.push({
        id: createId(), nodeId: story.activeNodeId, nodeIndex,
        title: `阶段摘要 ${story.summaries.length + 1}`,
        content: fallback, source: "Fallback", createdAt: new Date().toISOString(),
      });
    } finally {
      story.updatedAt = new Date().toISOString();
      setAppState(curr => ({
        ...curr,
        stories: curr.stories.map(s => s.id === story.id ? story : s)
      }));
      setUI(u => ({ ...u, summaryDraft: null }));
      if (!silent) setStatus("摘要已保存", "idle");
    }
  };

  const renderSidebar = () => (
    <aside className={`sidebar ${ui.sidebarOpen ? "" : "collapsed"}`}>
      <div className="nav-section">
        <div className="nav-section-title">我的作品</div>
        {appState.stories.length ? appState.stories.map(s => (
          <button 
            key={s.id} 
            className={`nav-item ${s.id === appState.activeStoryId ? "active" : ""}`}
            onClick={() => {
              setAppState(curr => ({ ...curr, activeStoryId: s.id }));
              setUI(u => ({ ...u, tabs: { ...u.tabs, main: "timeline" } }));
            }}
          >
            <BookOpen size={16} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
          </button>
        )) : <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '12px' }}>暂无作品</div>}
        <button className="nav-item" onClick={() => updateModal("story", true)} style={{ color: 'var(--accent)' }}>
          <Plus size={16} /> 新建作品
        </button>
      </div>

      <div className="nav-section">
        <div className="nav-section-title">工作区视图</div>
        <button className={`nav-item ${ui.tabs.main === "timeline" ? "active" : ""}`} onClick={() => setUI(u => ({ ...u, tabs: { ...u.tabs, main: "timeline" } }))}>
          <FileText size={16} /> 正文编辑器
        </button>
        <button className={`nav-item ${ui.tabs.main === "inspector" ? "active" : ""}`} onClick={() => setUI(u => ({ ...u, tabs: { ...u.tabs, main: "inspector" } }))}>
          <Zap size={16} /> 详情设定
        </button>
        <button className={`nav-item ${ui.tabs.main === "memory" ? "active" : ""}`} onClick={() => setUI(u => ({ ...u, tabs: { ...u.tabs, main: "memory" } }))}>
          <History size={16} /> 长期记忆
        </button>
        <button className={`nav-item ${ui.tabs.main === "library" ? "active" : ""}`} onClick={() => setUI(u => ({ ...u, tabs: { ...u.tabs, main: "library" } }))}>
          <Library size={16} /> 资料库 & 导出
        </button>
      </div>

      {activeStory && (
        <StoryTree 
          story={activeStory} 
          activeNodeId={activeStory.activeNodeId} 
          onSelect={(id) => {
            updateActiveStory(s => { s.activeNodeId = id; return s; });
            setUI(u => ({ ...u, tabs: { ...u.tabs, main: "timeline" } }));
          }} 
        />
      )}

      <div style={{ marginTop: 'auto', padding: '16px', borderTop: '1px solid var(--border)' }}>
        <button className="nav-item" onClick={openSettings}>
          <Settings size={16} /> 系统设置
        </button>
      </div>
    </aside>
  );

  return (
    <div className="app-container">
      {renderSidebar()}

      <main className="main-content">
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button className="button button-ghost button-icon" onClick={toggleSidebar}>
              {ui.sidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
            </button>
            <h2 className="workspace-title">{activeStory?.title ?? "Novel Flow"}</h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className={`status-indicator ${status.tone}`}>
              <div className="status-dot" />
              <span>{status.label}</span>
            </div>
            <button className="button button-ghost button-icon" title="系统设置" onClick={openSettings}>
              <Settings size={18} />
            </button>
            {activeStory && (
              <button className="button button-ghost button-icon" style={{ color: 'var(--danger)' }} title="删除作品" onClick={() => {
                if (confirm("确认删除当前作品吗？不可撤销。")) {
                  setAppState(curr => {
                    const remaining = curr.stories.filter(s => s.id !== curr.activeStoryId);
                    return { ...curr, stories: remaining, activeStoryId: remaining[0]?.id ?? null };
                  });
                }
              }}>
                <Trash2 size={18} />
              </button>
            )}
          </div>
        </header>

        <div className="workspace" ref={workspaceRef}>
          {ui.tabs.main === "timeline" && (
            <div className="timeline">
              {activeStory ? activePath.map((node, index) => (
                <div key={node.id} className={`node-card ${node.id === activeStory.activeNodeId ? "active" : ""}`}>
                  <div className="node-header">
                    <span>节点 {index + 1} · {node.generationKind}</span>
                    <span style={{ opacity: 0.5 }}>{new Date(node.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="node-body">{node.content}</div>
                  {node.instruction && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', borderLeft: '2px solid var(--accent)', paddingLeft: '12px', marginTop: '8px' }}>
                      指导意见：{node.instruction}
                    </div>
                  )}
                  <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                    <button className="button button-ghost" style={{ height: '24px', fontSize: '11px', padding: '0 8px' }} onClick={() => updateActiveStory(s => { s.activeNodeId = node.id; return s; })}>跳转到此</button>
                  </div>
                </div>
              )) : <div style={{ height: '40vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}><Zap size={48} style={{ opacity: 0.1, marginBottom: '16px' }} /><p>选择一个作品开始创作</p></div>}
              {activeStreamDraft && (
                <div className="node-card active">
                  <div className="node-header">正在生成 {activeStreamDraft.mode}</div>
                  <div className="node-body streaming-text">{activeStreamDraft.content || "..."}</div>
                </div>
              )}
            </div>
          )}

          {ui.tabs.main === "inspector" && activeStory && (
            <StoryForm story={activeStory} templates={appState.templates} onChange={updateActiveStory} />
          )}

          {ui.tabs.main === "memory" && (
            <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
              <h2 style={{ fontSize: '20px', marginBottom: '24px' }}>长期记忆 (摘要)</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {ui.summaryDraft && (
                  <div className="node-card active" style={{ opacity: 0.7 }}>
                    <div className="node-header">正在生成摘要...</div>
                    <div className="node-body" style={{ fontSize: '15px' }}>{ui.summaryDraft.content}</div>
                  </div>
                )}
                {activeStory?.summaries.length ? [...activeStory.summaries].reverse().map(s => (
                  <div key={s.id} style={{ padding: '20px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                    <div className="node-header" style={{ marginBottom: '12px' }}>{s.title} · 节点 {s.nodeIndex}</div>
                    <div style={{ fontSize: '15px', lineHeight: '1.6' }}>{s.content}</div>
                  </div>
                )) : <div className="empty-state">暂无记忆摘要</div>}
              </div>
            </div>
          )}

          {ui.tabs.main === "library" && (
            <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
              <h2 style={{ fontSize: '20px', marginBottom: '24px' }}>资料库与数据管理</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
                {appState.templates.map(t => (
                  <div key={t.id} style={{ padding: '20px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <h3 style={{ margin: 0, fontSize: '15px' }}>{t.name}</h3>
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', flex: 1 }}>{t.style || "无描述"}</p>
                    <button className="button button-primary" onClick={() => {
                      const temp = getTemplate(appState.templates, t.id);
                      updateActiveStory(s => {
                        s.templateId = t.id;
                        s.config = { ...s.config, ...temp };
                        return s;
                      });
                      setUI(u => ({ ...u, tabs: { ...u.tabs, main: "timeline" } }));
                    }}>套用此模板</button>
                  </div>
                ))}
              </div>
              
              <div style={{ marginTop: '40px', display: 'flex', gap: '12px' }}>
                <button className="button" onClick={() => exportFile(`novel-backup.json`, JSON.stringify(appState), 'application/json')}>
                  <Download size={16} /> 导出全量 JSON
                </button>
                <button className="button" onClick={() => exportFile(`${activeStory?.title}.md`, activePath.map(n => n.content).join("\n\n"), 'text/markdown')}>
                  <FileText size={16} /> 导出正文 Markdown
                </button>
              </div>
            </div>
          )}
        </div>

        {activeStory && ui.tabs.main === "timeline" && (
          <div className="bottom-bar">
            <div className="writing-box">
              <div className="writing-box-toolbar">
                <button className="button button-ghost button-icon" title="重写当前节点" disabled={ui.isGenerating} onClick={() => generate("rewrite")}>
                  <RotateCcw size={16} />
                </button>
                <button className="button button-ghost button-icon" title="从这里分叉" disabled={ui.isGenerating} onClick={() => generate("branch")}>
                  <GitFork size={16} />
                </button>
                <button className="button button-ghost button-icon" title="生成剧情摘要" disabled={ui.isGenerating} onClick={() => generateSummary()}>
                  <Sparkles size={16} />
                </button>
              </div>
              <div className="writing-box-input">
                <textarea 
                  ref={textareaRef}
                  rows="1"
                  value={ui.instruction}
                  onChange={(e) => setUI({ instruction: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      generate("continue");
                    }
                  }}
                />
                <button className="button button-primary button-icon" disabled={ui.isGenerating} onClick={() => generate("continue")}>
                  {ui.isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <SettingsModal 
        open={ui.modals.settings}
        activeStory={activeStory}
        provider={settings.provider}
        fields={settings.fields}
        drafts={settings.drafts}
        modelOptions={settings.modelOptions}
        testResult={settings.testResult}
        busy={settings.busy}
        onClose={() => updateModal("settings", false)}
        onProviderChange={v => setSettings({ provider: v })}
        onFieldsChange={f => setSettings({ fields: f })}
        onDraftsChange={d => setSettings({ drafts: d })}
        onModelOptionsChange={m => setSettings({ modelOptions: m })}
        onTestResultChange={r => setSettings({ testResult: r })}
        onBusyChange={b => setSettings({ busy: { ...settings.busy, ...b } })}
        onSave={(f) => {
          if (activeStory) {
            updateActiveStory(s => {
              s.model = { ...s.model, ...f };
              return s;
            });
          }
          setAppState(curr => ({
            ...curr,
            globalModel: { ...curr.globalModel, ...f }
          }));
          updateModal("settings", false);
          setStatus("设置已保存", "idle");
        }}
      />

      {ui.modals.story && (
        <Modal title="创建新作品" onClose={() => updateModal("story", false)}>
          <div className="stack-form">
            <label>作品标题<input value={storyDraft.title} onChange={e => setStoryDraft({...storyDraft, title: e.target.value})} placeholder="例如：月球暗面的低语" /></label>
            <label>题材风格<input value={storyDraft.genre} onChange={e => setStoryDraft({...storyDraft, genre: e.target.value})} placeholder="例如：硬核科幻 / 克苏鲁" /></label>
            <label>开场提示词<textarea rows="4" value={storyDraft.openingPrompt} onChange={e => setStoryDraft({...storyDraft, openingPrompt: e.target.value})} placeholder="描述故事的起点，AI 将基于此生成第一段..." /></label>
            <div style={{ marginTop: '12px' }}>
              <button className="button button-primary" style={{ width: '100%' }} onClick={() => {
                const story = createEmptyStory({ ...storyDraft, model: appState.globalModel });
                setAppState(curr => ({ ...curr, stories: [story, ...curr.stories], activeStoryId: story.id }));
                setStoryDraft(emptyStoryDraft);
                updateModal("story", false);
              }}>开始创作</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
