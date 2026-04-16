import { useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "./components/Panel";
import { SettingsModal } from "./components/SettingsModal";
import { Modal } from "./components/Modal";
import { StoryTree } from "./components/StoryTree";
import { StoryForm } from "./components/StoryForm";
import { useAppStore } from "./stores/useAppStore";
import { createId } from "./lib/id";
import { buildPrompt, buildSummaryPrompt, createGeneratedNode, requestCompletion } from "./lib/storyGeneration";
import {
  clamp,
  countGeneratedNodes,
  createDefaultState,
  createEmptyStory,
  emptyStoryDraft,
  emptyTemplateDraft,
  getNode,
  getPathToRoot,
  getTemplate,
  loadState,
  persistState,
} from "./lib/storyState";
import { createProviderFields, migrateModelConfig, normalizeProviderValue } from "./lib/providerDefs";
import { RotateCcw, GitFork, BookOpen, Send, Loader2 } from "lucide-react";

function exportFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const {
    appState,
    loaded,
    status,
    isGenerating,
    instruction,
    streamDraft,
    summaryDraft,
    storyModalOpen,
    templateModalOpen,
    settingsOpen,
    libraryTab,
    inspectorTab,
    mainTab,
    providerDrafts,
    settingsProvider,
    settingsFields,
    settingsModelOptions,
    settingsTestResult,
    settingsBusy,
    setAppState,
    setLoaded,
    setStatus,
    setIsGenerating,
    setInstruction,
    setStreamDraft,
    setSummaryDraft,
    setStoryModalOpen,
    setTemplateModalOpen,
    setSettingsOpen,
    setLibraryTab,
    setInspectorTab,
    setMainTab,
    setProviderDrafts,
    setSettingsProvider,
    setSettingsFields,
    setSettingsModelOptions,
    setSettingsTestResult,
    setSettingsBusy,
  } = useAppStore();

  const [storyDraft, setStoryDraft] = useState(emptyStoryDraft);
  const [templateDraft, setTemplateDraft] = useState(emptyTemplateDraft);
  const timelineRef = useRef(null);
  const summaryRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    loadState()
      .then((nextState) => {
        setAppState({
          ...nextState,
          activeStoryId: nextState.activeStoryId ?? nextState.stories[0]?.id ?? null,
        });
      })
      .catch(() => {
        setStatus({ label: "初始化失败", tone: "error" });
        setAppState(createDefaultState());
      })
      .finally(() => setLoaded(true));
  }, [setAppState, setLoaded, setStatus]);

  useEffect(() => {
    if (!loaded) return;
    persistState(appState).catch(() => {
      setStatus({ label: "保存失败", tone: "error" });
    });
  }, [appState, loaded, setStatus]);

  useEffect(() => {
    if (streamDraft && timelineRef.current) {
      timelineRef.current.scrollTo({ top: timelineRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [streamDraft]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [instruction]);

  const activeStory = useMemo(
    () => appState.stories.find((story) => story.id === appState.activeStoryId) ?? null,
    [appState],
  );
  const activePath = useMemo(
    () => (activeStory ? getPathToRoot(activeStory, activeStory.activeNodeId) : []),
    [activeStory],
  );
  const activeStreamDraft = streamDraft?.storyId === activeStory?.id ? streamDraft : null;
  const activeSummaryDraft = summaryDraft?.storyId === activeStory?.id ? summaryDraft : null;

  function updateActiveStory(updater) {
    setAppState((current) => ({
      ...current,
      stories: current.stories.map((story) =>
        story.id === current.activeStoryId ? updater(structuredClone(story)) : story,
      ),
    }));
  }

  function openSettings() {
    if (!activeStory) return;
    const config = migrateModelConfig(activeStory.model);
    const provider = normalizeProviderValue(config.provider);
    setSettingsProvider(provider);
    setSettingsFields(providerDrafts[provider] ? { ...providerDrafts[provider] } : createProviderFields(config));
    setSettingsModelOptions(null);
    setSettingsTestResult(null);
    setSettingsOpen(true);
  }

  function applyTemplate(templateId) {
    const template = getTemplate(appState.templates, templateId);
    if (!template) return;
    updateActiveStory((story) => {
      story.templateId = templateId;
      story.config.systemPrompt = template.systemPrompt || story.config.systemPrompt;
      story.config.world = template.world || story.config.world;
      story.config.characters = template.characters || story.config.characters;
      story.config.style = template.style || story.config.style;
      story.updatedAt = new Date().toISOString();
      return story;
    });
    setMainTab("timeline");
  }

  async function generate(mode) {
    if (!activeStory || isGenerating) return;
    const story = structuredClone(activeStory);
    const currentNode = getNode(story, story.activeNodeId);
    const parentId = mode === "rewrite" ? currentNode?.parentId ?? null : story.activeNodeId;
    const branchId = mode === "continue" ? currentNode?.branchId ?? createId() : createId();

    if (mode === "rewrite" && !parentId && !story.config.openingPrompt) {
      setStatus({ label: "根节点不可重写", tone: "error" });
      return;
    }

    setIsGenerating(true);
    setStreamDraft({
      storyId: story.id,
      label: mode === "continue" ? "继续" : mode === "branch" ? "分叉" : "重写",
      content: "",
      instruction,
    });
    setStatus({ label: "生成中", tone: "loading" });

    try {
      const payload = buildPrompt(story, mode, instruction);
      const content = await requestCompletion(story.model, payload, (partialText) => {
        setStreamDraft((draft) => (draft ? { ...draft, content: partialText } : draft));
        setStatus({ label: `生成中 (${partialText.length})`, tone: "loading" });
      });

      const node = createGeneratedNode({
        parentId,
        branchId,
        content,
        instruction,
        mode,
      });

      if (parentId) {
        const parent = getNode(story, parentId);
        if (parent) parent.childrenIds.push(node.id);
      }
      story.nodes.push(node);
      story.activeNodeId = node.id;
      story.updatedAt = new Date().toISOString();

      setAppState((current) => ({
        ...current,
        stories: current.stories.map((item) => (item.id === story.id ? story : item)),
      }));
      setInstruction("");

      if (story.config.autoSummary && countGeneratedNodes(story) % story.config.summaryEvery === 0) {
        await generateSummary(story, true);
      }

      setStatus({ label: "完成", tone: "idle" });
      setMainTab("timeline");
    } catch (error) {
      setStatus({ label: error.message || "失败", tone: "error" });
    } finally {
      setIsGenerating(false);
      setStreamDraft(null);
    }
  }

  async function generateSummary(storyParam = activeStory, silent = false) {
    if (!storyParam) return;
    const story = structuredClone(storyParam);
    const { payload, fallback, nodeIndex } = buildSummaryPrompt(story);

    setSummaryDraft({ storyId: story.id, label: `摘要`, content: "" });
    if (!silent) setStatus({ label: "生成摘要中", tone: "loading" });

    try {
      const content = await requestCompletion(story.model, payload, (partialText) => {
        setSummaryDraft((draft) => (draft ? { ...draft, content: partialText } : draft));
      });
      story.summaries.push({
        id: createId(),
        nodeId: story.activeNodeId,
        nodeIndex,
        title: `阶段摘要 ${story.summaries.length + 1}`,
        content,
        source: "AI",
        createdAt: new Date().toISOString(),
      });
    } catch {
      story.summaries.push({
        id: createId(),
        nodeId: story.activeNodeId,
        nodeIndex,
        title: `阶段摘要 ${story.summaries.length + 1}`,
        content: fallback || "暂无摘要。",
        source: "Fallback",
        createdAt: new Date().toISOString(),
      });
    } finally {
      story.updatedAt = new Date().toISOString();
      setAppState((current) => ({
        ...current,
        stories: current.stories.map((item) => (item.id === story.id ? story : item)),
      }));
      setSummaryDraft(null);
      if (!silent) setStatus({ label: "摘要已保存", tone: "idle" });
    }
  }

  function exportJson() {
    exportFile(`novel-flow-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(appState, null, 2), "application/json");
  }

  function exportMarkdown() {
    if (!activeStory) return;
    const markdown = `# ${activeStory.title}\n\n${activePath.map((node, index) => `## 节点 ${index + 1}\n\n${node.content}`).join("\n\n")}`;
    exportFile(`${activeStory.title || "story"}.md`, markdown, "text/markdown");
  }

  async function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const nextState = JSON.parse(await file.text());
    setAppState({
      ...nextState,
      activeStoryId: nextState.activeStoryId ?? nextState.stories?.[0]?.id ?? null,
    });
    setStatus({ label: "导入完成", tone: "idle" });
    event.target.value = "";
  }

  function createStoryFromDraft() {
    const template = getTemplate(appState.templates, storyDraft.templateId);
    const story = createEmptyStory({
      title: storyDraft.title,
      genre: storyDraft.genre,
      templateId: storyDraft.templateId,
      openingPrompt: storyDraft.openingPrompt,
      systemPrompt: template?.systemPrompt,
      world: template?.world,
      characters: template?.characters,
      style: template?.style,
    });
    setAppState((current) => ({
      ...current,
      stories: [story, ...current.stories],
      activeStoryId: story.id,
    }));
    setStoryDraft(emptyStoryDraft);
    setStoryModalOpen(false);
    setMainTab("timeline");
  }

  function createTemplateFromDraft() {
    setAppState((current) => ({
      ...current,
      templates: [
        {
          id: createId(),
          name: templateDraft.name,
          systemPrompt: templateDraft.systemPrompt,
          world: templateDraft.world,
          characters: templateDraft.characters,
          style: templateDraft.style,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        ...current.templates,
      ],
    }));
    setTemplateDraft(emptyTemplateDraft);
    setTemplateModalOpen(false);
    setMainTab("library");
    setLibraryTab("templates");
  }

  function saveSettings(fields) {
    if (!activeStory) return;
    updateActiveStory((story) => {
      story.model = {
        ...story.model,
        provider: fields.provider,
        apiKey: fields.apiKey,
        model: fields.model,
        baseURL: fields.baseURL,
      };
      story.updatedAt = new Date().toISOString();
      return story;
    });
    setStatus({ label: "已保存", tone: "idle" });
    setSettingsOpen(false);
  }

  if (!loaded) {
    return <div className="app-loading">载入中...</div>;
  }

  const renderTimeline = () => (
    <div className="timeline" ref={timelineRef}>
      {activeStory ? activePath.map((node, index) => (
        <article key={node.id} className={`timeline-node ${node.id === activeStory.activeNodeId ? "active" : ""}`}>
          <div className="timeline-node-header">
            <div className="node-meta">节点 {index + 1} · {node.generationKind}</div>
          </div>
          <div className="node-content">{node.content}</div>
          {node.instruction ? <div className="node-meta" style={{ marginTop: '8px', borderTop: '1px solid var(--line)', paddingTop: '8px' }}>意见：{node.instruction}</div> : null}
          <div className="node-actions">
            <button className="button button-ghost" style={{ fontSize: '0.75rem', height: '28px' }} onClick={() => updateActiveStory((story) => { story.activeNodeId = node.id; return story; })}>跳转</button>
          </div>
        </article>
      )) : <div className="empty-state">选择作品开始创作</div>}

      {activeStreamDraft ? (
        <article className="timeline-node active">
          <div className="timeline-node-header">
            <div className="node-meta">正在生成 {activeStreamDraft.label}</div>
          </div>
          <div className="node-content streaming-content">{activeStreamDraft.content || "..."}</div>
        </article>
      ) : null}
    </div>
  );

  const renderLibrary = () => (
    <div className="panel-content">
      <div className="segmented-control">
        <button className={`segment ${libraryTab === "stories" ? "active" : ""}`} onClick={() => setLibraryTab("stories")}>作品</button>
        <button className={`segment ${libraryTab === "templates" ? "active" : ""}`} onClick={() => setLibraryTab("templates")}>模板</button>
      </div>

      {libraryTab === "stories" ? (
        <div className="story-list">
          {appState.stories.length ? [...appState.stories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((story) => (
            <button key={story.id} className={`story-item ${story.id === appState.activeStoryId ? "active" : ""}`} onClick={() => {
              setAppState((current) => ({ ...current, activeStoryId: story.id }));
              setMainTab("timeline");
            }}>
              <span className="story-item-title">{story.title}</span>
              <span className="story-item-meta">{story.genre || "默认"} · {story.nodes.length} 节点</span>
            </button>
          )) : <div className="empty-state">暂无作品</div>}
        </div>
      ) : (
        <div className="template-list">
          {appState.templates.map((template) => (
            <div className="template-item" key={template.id} style={{ padding: '10px', background: 'var(--panel-soft)', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong style={{ fontSize: '0.875rem' }}>{template.name}</strong>
              <button className="button button-ghost" style={{ height: '28px' }} onClick={() => applyTemplate(template.id)}>套用</button>
            </div>
          ))}
        </div>
      )}

      <div className="library-utility">
        <button className="button button-secondary" onClick={exportJson}>导出</button>
        <label className="button button-ghost">
          导入
          <input hidden type="file" accept="application/json" onChange={importJson} />
        </label>
      </div>
    </div>
  );

  const renderInspector = () => (
    <div className="panel-content">
      <div className="segmented-control">
        <button className={`segment ${inspectorTab === "setup" ? "active" : ""}`} onClick={() => setInspectorTab("setup")}>设定</button>
        <button className={`segment ${inspectorTab === "branches" ? "active" : ""}`} onClick={() => setInspectorTab("branches")}>分支</button>
        <button className={`segment ${inspectorTab === "memory" ? "active" : ""}`} onClick={() => setInspectorTab("memory")}>记忆</button>
      </div>

      <div style={{ marginTop: '16px' }}>
        {inspectorTab === "setup" && (activeStory ? <StoryForm story={activeStory} templates={appState.templates} onChange={(nextStory) => updateActiveStory(() => nextStory)} /> : <div className="empty-state">未选择作品</div>)}
        {inspectorTab === "branches" && (activeStory ? <StoryTree story={activeStory} activeNodeId={activeStory.activeNodeId} onSelect={(nodeId) => {
          updateActiveStory((story) => { story.activeNodeId = nodeId; return story; });
          setMainTab("timeline");
        }} /> : <div className="empty-state">未选择作品</div>)}
        {inspectorTab === "memory" && (
          <div className="summary-list">
            {activeSummaryDraft && (
              <article className="timeline-node" style={{ opacity: 0.7 }}>
                <div className="node-meta">生成摘要中...</div>
                <div className="node-content streaming-content">{activeSummaryDraft.content}</div>
              </article>
            )}
            {activeStory?.summaries.length ? [...activeStory.summaries].reverse().map((s) => (
              <article key={s.id} className="timeline-node">
                <div className="node-meta">{s.title} · 节点 {s.nodeIndex}</div>
                <div className="node-content" style={{ fontSize: '0.875rem' }}>{s.content}</div>
              </article>
            )) : <div className="empty-state">暂无摘要</div>}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="site-frame">
      <main className="page-shell">
        <section className="workspace-topbar">
          <h1 className="workspace-title">{activeStory?.title ?? "Novel Flow"}</h1>
          <div className="workspace-topbar-actions">
            <button className="button button-ghost" onClick={() => setStoryModalOpen(true)}>新建</button>
            <button className="button button-ghost" onClick={openSettings}>设置</button>
            <div className={`status-pill ${status.tone}`}>{status.label}</div>
          </div>
        </section>

        <section className="workspace-grid">
          <div className="stage">
            <Panel 
              title={
                <div className="segmented-control" style={{ border: 'none', background: 'transparent', padding: 0 }}>
                  <button className={`segment ${mainTab === "timeline" ? "active" : ""}`} onClick={() => setMainTab("timeline")} style={{ height: '32px', padding: '0 16px' }}>正文</button>
                  <button className={`segment ${mainTab === "library" ? "active" : ""}`} onClick={() => setMainTab("library")} style={{ height: '32px', padding: '0 16px' }}>资料库</button>
                  <button className={`segment ${mainTab === "inspector" ? "active" : ""}`} onClick={() => setMainTab("inspector")} style={{ height: '32px', padding: '0 16px' }}>检查器</button>
                </div>
              }
            >
              {mainTab === "timeline" && <div className="panel-content">{renderTimeline()}</div>}
              {mainTab === "library" && renderLibrary()}
              {mainTab === "inspector" && renderInspector()}
            </Panel>
          </div>
        </section>
      </main>

      {/* Fixed Writing Bar */}
      <div className="writing-bar-container">
        <div className="writing-bar">
          <div className="writing-toolbar">
            <button 
              className="button button-ghost button-icon" 
              title="重写" 
              disabled={!activeStory || isGenerating}
              onClick={() => generate("rewrite")}
            >
              <RotateCcw size={18} />
            </button>
            <button 
              className="button button-ghost button-icon" 
              title="分叉" 
              disabled={!activeStory || isGenerating}
              onClick={() => generate("branch")}
            >
              <GitFork size={18} />
            </button>
            <button 
              className="button button-ghost button-icon" 
              title="生成摘要" 
              disabled={!activeStory || isGenerating}
              onClick={() => generateSummary()}
            >
              <BookOpen size={18} />
            </button>
          </div>
          <div className="writing-input-area">
            <textarea 
              ref={textareaRef}
              rows="1" 
              value={instruction} 
              onChange={(e) => setInstruction(e.target.value)} 
              placeholder="在此输入指导意见..."
              disabled={!activeStory || isGenerating}
            />
            <button 
              className="button button-primary button-icon" 
              disabled={!activeStory || isGenerating}
              onClick={() => generate("continue")}
            >
              {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        activeStory={activeStory}
        provider={settingsProvider}
        fields={settingsFields}
        drafts={providerDrafts}
        modelOptions={settingsModelOptions}
        testResult={settingsTestResult}
        busy={settingsBusy}
        onClose={() => setSettingsOpen(false)}
        onProviderChange={setSettingsProvider}
        onFieldsChange={setSettingsFields}
        onDraftsChange={setProviderDrafts}
        onModelOptionsChange={setSettingsModelOptions}
        onTestResultChange={setSettingsTestResult}
        onBusyChange={setSettingsBusy}
        onSave={saveSettings}
      />

      {storyModalOpen && (
        <Modal title="新建作品" onClose={() => setStoryModalOpen(false)}>
          <label>标题<input value={storyDraft.title} onChange={(e) => setStoryDraft({...storyDraft, title: e.target.value})} /></label>
          <label>开场提示<textarea rows="3" value={storyDraft.openingPrompt} onChange={(e) => setStoryDraft({...storyDraft, openingPrompt: e.target.value})} /></label>
          <button className="button button-primary" onClick={createStoryFromDraft}>创建</button>
        </Modal>
      )}

      {templateModalOpen && (
        <Modal title="新建模板" onClose={() => setTemplateModalOpen(false)}>
          <label>模板名<input value={templateDraft.name} onChange={(e) => setTemplateDraft({...templateDraft, name: e.target.value})} /></label>
          <button className="button button-primary" onClick={createTemplateFromDraft}>保存</button>
        </Modal>
      )}
    </div>
  );
}
