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

  useEffect(() => {
    loadState()
      .then((nextState) => {
        setAppState({
          ...nextState,
          activeStoryId: nextState.activeStoryId ?? nextState.stories[0]?.id ?? null,
        });
      })
      .catch(() => {
        setStatus({ label: "初始化失败，请检查浏览器是否允许 IndexedDB", tone: "error" });
        setAppState(createDefaultState());
      })
      .finally(() => setLoaded(true));
  }, [setAppState, setLoaded, setStatus]);

  useEffect(() => {
    if (!loaded) return;
    persistState(appState).catch(() => {
      setStatus({ label: "本地保存失败", tone: "error" });
    });
  }, [appState, loaded, setStatus]);

  useEffect(() => {
    if (streamDraft && timelineRef.current) {
      timelineRef.current.scrollTo({ top: timelineRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [streamDraft]);

  useEffect(() => {
    if (summaryDraft && summaryRef.current) {
      summaryRef.current.scrollTo({ top: summaryRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [summaryDraft]);

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
      setStatus({ label: "根节点重写需要开场提示", tone: "error" });
      return;
    }

    setIsGenerating(true);
    setStreamDraft({
      storyId: story.id,
      label: mode === "continue" ? "继续当前分支" : mode === "branch" ? "从这里分叉" : "重写当前节点",
      content: "",
      instruction,
    });
    setStatus({ label: "正在生成中", tone: "loading" });

    try {
      const payload = buildPrompt(story, mode, instruction);
      const content = await requestCompletion(story.model, payload, (partialText) => {
        setStreamDraft((draft) => (draft ? { ...draft, content: partialText } : draft));
        setStatus({ label: `正在生成中 · ${partialText.length} 字`, tone: "loading" });
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

      setStatus({ label: "生成完成", tone: "idle" });
      setMainTab("timeline");
    } catch (error) {
      setStatus({ label: error.message || "生成失败", tone: "error" });
    } finally {
      setIsGenerating(false);
      setStreamDraft(null);
    }
  }

  async function generateSummary(storyParam = activeStory, silent = false) {
    if (!storyParam) return;
    const story = structuredClone(storyParam);
    const { payload, fallback, nodeIndex } = buildSummaryPrompt(story);

    setSummaryDraft({ storyId: story.id, label: `节点 ${nodeIndex} 的阶段摘要`, content: "" });
    if (!silent) setStatus({ label: "正在生成摘要", tone: "loading" });

    try {
      const content = await requestCompletion(story.model, payload, (partialText) => {
        setSummaryDraft((draft) => (draft ? { ...draft, content: partialText } : draft));
        if (!silent) setStatus({ label: `正在生成摘要 · ${partialText.length} 字`, tone: "loading" });
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
    setStatus({ label: "模型设置已保存", tone: "idle" });
    setSettingsOpen(false);
  }

  if (!loaded) {
    return <div className="app-loading">正在加载工作区…</div>;
  }

  const renderTimeline = () => (
    <div className="timeline" ref={timelineRef}>
      {activeStory ? activePath.map((node, index) => (
        <article key={node.id} className={`timeline-node ${node.id === activeStory.activeNodeId ? "active" : ""}`}>
          <div className="timeline-node-header">
            <div>
              <strong>节点 {index + 1}</strong>
              <div className="node-meta">{node.generationKind}</div>
            </div>
            <span className="summary-label">{node.childrenIds.length} child</span>
          </div>
          <div className="node-content">{node.content}</div>
          {node.instruction ? <div className="node-meta">指导意见：{node.instruction}</div> : null}
          <div className="node-actions">
            <button className="button button-ghost" onClick={() => updateActiveStory((story) => { story.activeNodeId = node.id; return story; })}>切到这里</button>
          </div>
        </article>
      )) : <div className="empty-state">选中一个作品后开始写。</div>}

      {activeStreamDraft ? (
        <article className="timeline-node active">
          <div className="timeline-node-header">
            <div>
              <strong>正在生成</strong>
              <div className="node-meta">{activeStreamDraft.label}</div>
            </div>
            <span className="summary-label">流式输出</span>
          </div>
          <div className="node-content streaming-content">{activeStreamDraft.content || "…"}</div>
        </article>
      ) : null}
    </div>
  );

  const renderLibrary = () => (
    <>
      <div className="segmented-control library-tabs">
        <button className={`segment ${libraryTab === "stories" ? "active" : ""}`} onClick={() => setLibraryTab("stories")}>作品列表</button>
        <button className={`segment ${libraryTab === "templates" ? "active" : ""}`} onClick={() => setLibraryTab("templates")}>模板资料库</button>
      </div>

      {libraryTab === "stories" ? (
        <div className="story-list">
          {appState.stories.length ? [...appState.stories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((story) => (
            <button key={story.id} className={`story-item ${story.id === appState.activeStoryId ? "active" : ""}`} onClick={() => {
              setAppState((current) => ({ ...current, activeStoryId: story.id }));
              setMainTab("timeline");
            }}>
              <span className="story-item-title">{story.title}</span>
              <span className="story-item-meta">{story.genre || "未设置题材"} · {story.nodes.length} 节点</span>
            </button>
          )) : <div className="empty-state">还没有作品。</div>}
        </div>
      ) : (
        <div className="template-list">
          {appState.templates.map((template) => (
            <div className="template-item" key={template.id} style={{ padding: '12px', background: 'var(--panel-soft)', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong className="template-item-title">{template.name}</strong>
                <p className="template-item-meta" style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>{template.style || "没有默认风格说明"}</p>
              </div>
              <button className="button button-ghost" onClick={() => applyTemplate(template.id)}>套用</button>
            </div>
          ))}
          {!appState.templates.length && <div className="empty-state">还没有模板。</div>}
        </div>
      )}

      <div className="library-utility">
        <button className="button button-secondary" onClick={exportJson}>导出 JSON</button>
        <button className="button button-secondary" onClick={exportMarkdown}>导出 Markdown</button>
        <label className="button button-ghost file-label">
          导入 JSON
          <input hidden type="file" accept="application/json" onChange={importJson} />
        </label>
      </div>
    </>
  );

  const renderInspector = () => (
    <>
      <div className="segmented-control inspector-tabs">
        <button className={`segment ${inspectorTab === "setup" ? "active" : ""}`} onClick={() => setInspectorTab("setup")}>设定</button>
        <button className={`segment ${inspectorTab === "branches" ? "active" : ""}`} onClick={() => setInspectorTab("branches")}>分支</button>
        <button className={`segment ${inspectorTab === "memory" ? "active" : ""}`} onClick={() => setInspectorTab("memory")}>记忆</button>
      </div>

      {inspectorTab === "setup" ? (
        activeStory ? <StoryForm story={activeStory} templates={appState.templates} onChange={(nextStory) => updateActiveStory(() => nextStory)} /> : <div className="empty-state">先创建一个作品。</div>
      ) : null}
      {inspectorTab === "branches" ? (
        activeStory ? <StoryTree story={activeStory} activeNodeId={activeStory.activeNodeId} onSelect={(nodeId) => {
          updateActiveStory((story) => { story.activeNodeId = nodeId; return story; });
          setMainTab("timeline");
        }} /> : <div className="empty-state">暂无分支。</div>
      ) : null}
      {inspectorTab === "memory" ? (
        <div className="summary-list" ref={summaryRef}>
          {activeSummaryDraft ? (
            <article className="summary-item" style={{ padding: '16px', background: 'var(--panel-soft)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', marginBottom: '12px' }}>
              <div className="summary-item-header">
                <div>
                  <strong>正在生成摘要</strong>
                  <div className="summary-meta" style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{activeSummaryDraft.label}</div>
                </div>
                <span className="summary-label">流式输出</span>
              </div>
              <div className="summary-content streaming-content">{activeSummaryDraft.content || "…"}</div>
            </article>
          ) : null}
          {activeStory?.summaries.length ? [...activeStory.summaries].reverse().map((summary) => (
            <article key={summary.id} className="summary-item" style={{ padding: '16px', background: 'var(--panel-soft)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', marginBottom: '12px' }}>
              <div className="summary-item-header">
                <div>
                  <strong>{summary.title}</strong>
                  <div className="summary-meta" style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>节点 {summary.nodeIndex}</div>
                </div>
                <span className="summary-label">{summary.source}</span>
              </div>
              <div className="summary-content" style={{ fontSize: '0.875rem', lineHeight: '1.6' }}>{summary.content}</div>
            </article>
          )) : <div className="empty-state">摘要会在这里累计。</div>}
        </div>
      ) : null}
    </>
  );

  return (
    <div className="site-frame">
      <main className="page-shell">
        <section className="workspace-topbar">
          <div className="brand-lockup">
            <p className="brand-kicker">Novel Flow</p>
            <h1 className="workspace-title">{activeStory?.title ?? "还没有作品"}</h1>
          </div>
          <div className="workspace-topbar-actions">
            <button className="button button-primary" onClick={() => setStoryModalOpen(true)}>新建作品</button>
            <button className="button button-secondary" onClick={() => setTemplateModalOpen(true)}>新建模板</button>
            <button className="button button-secondary" onClick={openSettings} disabled={!activeStory}>模型设置</button>
            <div className={`status-pill ${status.tone === "loading" ? "loading" : ""} ${status.tone === "error" ? "error" : ""}`}>{status.label}</div>
          </div>
        </section>

        <section className="workspace-grid" style={{ gridTemplateColumns: '1fr' }}>
          <section className="stage">
            <Panel
              title="续写控制"
              actions={
                <div className="topbar-actions">
                  <button className="button button-secondary" onClick={() => generateSummary()}>生成摘要</button>
                  <button className="button button-danger" onClick={() => setAppState((current) => {
                    const remaining = current.stories.filter((story) => story.id !== current.activeStoryId);
                    return { ...current, stories: remaining, activeStoryId: remaining[0]?.id ?? null };
                  })}>删除作品</button>
                </div>
              }
            >
              <div className="stack-form">
                <label>
                  给 AI 的指导意见
                  <textarea rows="3" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="例如：拉高紧张感，不要解释设定，让主角在结尾做出违反直觉的决定。" />
                </label>
                <div className="action-row">
                  <button className="button button-primary" disabled={!activeStory || isGenerating} onClick={() => generate("continue")}>继续</button>
                  <button className="button button-secondary" disabled={!activeStory || isGenerating} onClick={() => generate("rewrite")}>重写当前节点</button>
                  <button className="button button-secondary" disabled={!activeStory || isGenerating} onClick={() => generate("branch")}>从这里分叉</button>
                </div>
              </div>
            </Panel>

            <Panel 
              title={
                <div className="segmented-control" style={{ marginBottom: 0, border: 'none', background: 'transparent', padding: 0 }}>
                  <button className={`segment ${mainTab === "timeline" ? "active" : ""}`} onClick={() => setMainTab("timeline")} style={{ height: '32px', padding: '0 24px' }}>正文时间线</button>
                  <button className={`segment ${mainTab === "library" ? "active" : ""}`} onClick={() => setMainTab("library")} style={{ height: '32px', padding: '0 24px' }}>资料库</button>
                  <button className={`segment ${mainTab === "inspector" ? "active" : ""}`} onClick={() => setMainTab("inspector")} style={{ height: '32px', padding: '0 24px' }}>检查器</button>
                </div>
              }
            >
              {mainTab === "timeline" && renderTimeline()}
              {mainTab === "library" && renderLibrary()}
              {mainTab === "inspector" && renderInspector()}
            </Panel>
          </section>
        </section>
      </main>

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

      {storyModalOpen ? (
        <Modal title="新建作品" onClose={() => setStoryModalOpen(false)}>
          <label>标题<input value={storyDraft.title} onChange={(event) => setStoryDraft((draft) => ({ ...draft, title: event.target.value }))} /></label>
          <label>题材 / 风格<input value={storyDraft.genre} onChange={(event) => setStoryDraft((draft) => ({ ...draft, genre: event.target.value }))} /></label>
          <label>套用模板<select value={storyDraft.templateId} onChange={(event) => setStoryDraft((draft) => ({ ...draft, templateId: event.target.value }))}><option value="">不使用模板</option>{appState.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
          <label>开场提示<textarea rows="4" value={storyDraft.openingPrompt} onChange={(event) => setStoryDraft((draft) => ({ ...draft, openingPrompt: event.target.value }))} /></label>
          <div className="action-row">
            <button className="button button-secondary" onClick={() => setStoryModalOpen(false)}>取消</button>
            <button className="button button-primary" disabled={!storyDraft.title.trim()} onClick={createStoryFromDraft}>创建</button>
          </div>
        </Modal>
      ) : null}

      {templateModalOpen ? (
        <Modal title="新建模板" onClose={() => setTemplateModalOpen(false)}>
          <label>模板名<input value={templateDraft.name} onChange={(event) => setTemplateDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
          <label>默认系统 Prompt<textarea rows="5" value={templateDraft.systemPrompt} onChange={(event) => setTemplateDraft((draft) => ({ ...draft, systemPrompt: event.target.value }))} /></label>
          <label>默认世界观<textarea rows="4" value={templateDraft.world} onChange={(event) => setTemplateDraft((draft) => ({ ...draft, world: event.target.value }))} /></label>
          <label>默认角色设定<textarea rows="4" value={templateDraft.characters} onChange={(event) => setTemplateDraft((draft) => ({ ...draft, characters: event.target.value }))} /></label>
          <label>默认风格<input value={templateDraft.style} onChange={(event) => setTemplateDraft((draft) => ({ ...draft, style: event.target.value }))} /></label>
          <div className="action-row">
            <button className="button button-secondary" onClick={() => setTemplateModalOpen(false)}>取消</button>
            <button className="button button-primary" disabled={!templateDraft.name.trim()} onClick={createTemplateFromDraft}>保存</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
