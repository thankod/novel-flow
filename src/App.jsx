import { useEffect, useMemo, useRef, useState } from "react";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const DB_NAME = "novel-flow-db";
const DB_VERSION = 1;
const STORE_NAME = "app-state";
const STATE_KEY = "state";

const defaultSystemPrompt =
  "你是互动小说写作搭档。严格基于用户提供的设定、摘要记忆、最近正文和指导意见续写。只输出小说正文，不要解释，不要列提纲，不要使用标题。保持人物一致、设定一致、情节连贯。";

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const emptyTemplateDraft = {
  name: "",
  systemPrompt: "",
  world: "",
  characters: "",
  style: "",
};

const emptyStoryDraft = {
  title: "",
  genre: "",
  templateId: "",
  openingPrompt: "",
};

const defaultState = {
  templates: [
    {
      id: createId(),
      name: "冷调悬疑",
      systemPrompt:
        "写作时保持压抑、克制、具象。优先使用动作、环境和细节制造悬念，不要用解释代替推进。",
      world: "",
      characters: "",
      style: "冷调、细腻、带压迫感",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  stories: [],
  activeStoryId: null,
};

function createEmptyStory(partial = {}) {
  const now = new Date().toISOString();
  const rootId = createId();
  return {
    id: createId(),
    title: partial.title ?? "未命名作品",
    genre: partial.genre ?? "",
    templateId: partial.templateId ?? "",
    config: {
      world: partial.world ?? "",
      characters: partial.characters ?? "",
      goals: partial.goals ?? "",
      avoid: partial.avoid ?? "",
      openingPrompt: partial.openingPrompt ?? "",
      systemPrompt: partial.systemPrompt ?? defaultSystemPrompt,
      style: partial.style ?? "细腻、连贯、有画面感",
      length: partial.length ?? "300-500字",
      autoSummary: partial.autoSummary ?? true,
      summaryEvery: partial.summaryEvery ?? 4,
    },
    model: {
      provider: partial.provider ?? "openai-compatible",
      baseURL: partial.baseURL ?? "https://api.openai.com/v1",
      apiKey: partial.apiKey ?? "",
      model: partial.model ?? "gpt-4.1-mini",
      temperature: partial.temperature ?? 0.9,
      maxTokens: partial.maxTokens ?? 900,
    },
    rootNodeId: rootId,
    activeNodeId: rootId,
    nodes: [
      {
        id: rootId,
        parentId: null,
        childrenIds: [],
        branchId: createId(),
        content:
          partial.rootContent ??
          "故事还没有开始。先补充设定，再输入指导意见并点击“继续”，或把开场提示写清楚后直接生成第一段。",
        instruction: partial.openingPrompt ?? "",
        createdAt: now,
        generationKind: "root",
      },
    ],
    summaries: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function openDb() {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function loadState() {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result ?? structuredClone(defaultState));
  });
}

async function persistState(state) {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_NAME).put(state, STATE_KEY);
  });
}

function getTemplate(templates, templateId) {
  return templates.find((template) => template.id === templateId) ?? null;
}

function getNode(story, nodeId) {
  return story.nodes.find((node) => node.id === nodeId) ?? null;
}

function getPathToRoot(story, nodeId) {
  const map = new Map(story.nodes.map((node) => [node.id, node]));
  const path = [];
  let current = map.get(nodeId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? map.get(current.parentId) : null;
  }
  return path;
}

function countGeneratedNodes(story) {
  return story.nodes.filter((node) => node.generationKind !== "root").length;
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeBaseUrl(baseURL) {
  if (!baseURL) return "https://api.openai.com/v1";
  return baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
}

function normalizeProviderName(provider) {
  return String(provider ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, "-");
}

function createLanguageModel(modelConfig) {
  const providerName = normalizeProviderName(modelConfig.provider);
  if (providerName === "openai") {
    const openai = createOpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseURL,
    });
    return openai(modelConfig.model);
  }

  const provider = createOpenAICompatible({
    name: providerName || "openai-compatible",
    apiKey: modelConfig.apiKey,
    baseURL: modelConfig.baseURL,
  });
  return provider(modelConfig.model);
}

async function requestCompletion(modelConfig, promptPayload, onPartialText) {
  if (!modelConfig.apiKey) throw new Error("请先填写 API Key。");
  if (!modelConfig.baseURL) throw new Error("请先填写 Base URL。");

  const result = streamText({
    model: createLanguageModel(modelConfig),
    system: promptPayload.system,
    messages: promptPayload.messages,
    temperature: modelConfig.temperature,
    maxOutputTokens: modelConfig.maxTokens,
  });

  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
    onPartialText?.(text);
  }

  if (!text.trim()) {
    throw new Error("模型没有返回正文。");
  }
  return text.trim();
}

function buildPrompt(story, mode, instruction) {
  const path = getPathToRoot(story, story.activeNodeId);
  const currentNode = path.at(-1);
  const summaries = story.summaries
    .slice(-3)
    .map((item, index) => `摘要 ${index + 1}:\n${item.content}`)
    .join("\n\n");
  const recentTimeline = path
    .slice(-6)
    .map((node, index) => `正文 ${index + 1}:\n${node.content}`)
    .join("\n\n");

  const system = [
    story.config.systemPrompt,
    story.genre ? `题材 / 风格：${story.genre}` : "",
    story.config.world ? `世界观：${story.config.world}` : "",
    story.config.characters ? `角色设定：${story.config.characters}` : "",
    story.config.goals ? `写作目标：${story.config.goals}` : "",
    story.config.avoid ? `禁忌项：${story.config.avoid}` : "",
    story.config.style ? `默认文风：${story.config.style}` : "",
    story.config.length ? `单段长度：${story.config.length}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const userParts = [];
  if (summaries) userParts.push(`长期记忆：\n${summaries}`);
  if (recentTimeline) userParts.push(`最近正文：\n${recentTimeline}`);
  if (mode === "continue") userParts.push("任务：在保持连贯的前提下继续写下一段正文。");
  if (mode === "branch") userParts.push("任务：基于当前节点从这里写出一个新的平行走向，避免与原分支只是措辞不同。");
  if (mode === "rewrite") {
    const parent = currentNode?.parentId ? getNode(story, currentNode.parentId) : null;
    if (parent) {
      userParts.push(`上一节点正文：\n${parent.content}`);
      userParts.push("任务：从上一节点重新写出当前这一步，形成替代版本。");
    } else {
      userParts.push("任务：根据开场提示重写第一段。");
    }
  }
  if (story.config.openingPrompt && countGeneratedNodes(story) === 0) {
    userParts.push(`开场提示：\n${story.config.openingPrompt}`);
  }
  if (instruction) userParts.push(`本次指导意见：\n${instruction}`);

  return {
    system,
    messages: [{ role: "user", content: userParts.join("\n\n") }],
  };
}

function buildSummaryPrompt(story) {
  const path = getPathToRoot(story, story.activeNodeId);
  const recentNodes = path.slice(-Math.max(3, story.config.summaryEvery));
  return {
    fallback: recentNodes.map((node) => node.content.slice(0, 90)).join(" / "),
    nodeIndex: path.length,
    payload: {
      system:
        "你在为互动小说生成长期记忆。输出一个简洁摘要，包含剧情进展、角色状态、未解决线索。使用自然中文，不要列点编号。",
      messages: [
        {
          role: "user",
          content: recentNodes.map((node, index) => `正文 ${index + 1}:\n${node.content}`).join("\n\n"),
        },
      ],
    },
  };
}

function exportFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Panel({ label, title, actions, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="micro-label">{label}</p>
          <h2>{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Modal({ label, title, children, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <div>
            <p className="micro-label">{label}</p>
            <h2>{title}</h2>
          </div>
        </div>
        <div className="stack-form">{children}</div>
      </div>
    </div>
  );
}

function StoryTree({ story, activeNodeId, onSelect }) {
  const map = useMemo(() => new Map(story.nodes.map((node) => [node.id, node])), [story.nodes]);
  const root = map.get(story.rootNodeId);

  function renderNode(node) {
    return (
      <div className={`branch-node ${node.id === activeNodeId ? "active" : ""}`} key={node.id}>
        <button type="button" onClick={() => onSelect(node.id)}>
          <strong>{node.content.slice(0, 30) || "空节点"}</strong>
          <div className="branch-node-meta">{node.childrenIds.length} 子节点</div>
        </button>
        {node.childrenIds.length > 0 ? (
          <div className="branch-children">
            {node.childrenIds.map((childId) => renderNode(map.get(childId)))}
          </div>
        ) : null}
      </div>
    );
  }

  return root ? renderNode(root) : <div className="empty-state">暂无分支</div>;
}

function StoryForm({ story, templates, onChange }) {
  function updateField(path, value) {
    const nextStory = structuredClone(story);
    if (path.startsWith("config.")) {
      nextStory.config[path.replace("config.", "")] = value;
    } else {
      nextStory[path] = value;
    }
    nextStory.updatedAt = new Date().toISOString();
    onChange(nextStory);
  }

  return (
    <div className="stack-form">
      <label>标题<input value={story.title} onChange={(event) => updateField("title", event.target.value)} /></label>
      <label>题材 / 风格<input value={story.genre} onChange={(event) => updateField("genre", event.target.value)} /></label>
      <label>模板<select value={story.templateId} onChange={(event) => updateField("templateId", event.target.value)}><option value="">不使用模板</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
      <label>世界观<textarea rows="4" value={story.config.world} onChange={(event) => updateField("config.world", event.target.value)} /></label>
      <label>角色设定<textarea rows="4" value={story.config.characters} onChange={(event) => updateField("config.characters", event.target.value)} /></label>
      <label>写作目标<textarea rows="3" value={story.config.goals} onChange={(event) => updateField("config.goals", event.target.value)} /></label>
      <label>禁忌项<textarea rows="3" value={story.config.avoid} onChange={(event) => updateField("config.avoid", event.target.value)} /></label>
      <label>开场提示<textarea rows="3" value={story.config.openingPrompt} onChange={(event) => updateField("config.openingPrompt", event.target.value)} /></label>
      <label>系统 Prompt<textarea rows="5" value={story.config.systemPrompt} onChange={(event) => updateField("config.systemPrompt", event.target.value)} /></label>
      <label>默认文风<input value={story.config.style} onChange={(event) => updateField("config.style", event.target.value)} /></label>
      <div className="inline-fields">
        <label>单段长度<input value={story.config.length} onChange={(event) => updateField("config.length", event.target.value)} /></label>
        <label className="checkbox-row"><input type="checkbox" checked={story.config.autoSummary} onChange={(event) => updateField("config.autoSummary", event.target.checked)} />自动摘要</label>
      </div>
      <label>自动摘要间隔<input type="number" min="2" max="12" value={story.config.summaryEvery} onChange={(event) => updateField("config.summaryEvery", clamp(Number(event.target.value), 2, 12))} /></label>
    </div>
  );
}

function ModelForm({ story, onChange }) {
  function updateField(path, value) {
    const nextStory = structuredClone(story);
    nextStory.model[path] = value;
    nextStory.updatedAt = new Date().toISOString();
    onChange(nextStory);
  }

  return (
    <div className="stack-form">
      <label>Provider<input value={story.model.provider} onChange={(event) => updateField("provider", event.target.value)} /></label>
      <label>Base URL<input value={story.model.baseURL} onChange={(event) => updateField("baseURL", normalizeBaseUrl(event.target.value))} /></label>
      <label>API Key<input type="password" value={story.model.apiKey} onChange={(event) => updateField("apiKey", event.target.value)} /></label>
      <label>Model<input value={story.model.model} onChange={(event) => updateField("model", event.target.value)} /></label>
      <div className="inline-fields">
        <label>Temperature<input type="number" min="0" max="2" step="0.1" value={story.model.temperature} onChange={(event) => updateField("temperature", clamp(Number(event.target.value), 0, 2))} /></label>
        <label>Max Tokens<input type="number" min="64" max="8192" value={story.model.maxTokens} onChange={(event) => updateField("maxTokens", clamp(Number(event.target.value), 64, 8192))} /></label>
      </div>
    </div>
  );
}

export default function App() {
  const [appState, setAppState] = useState(structuredClone(defaultState));
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState({ label: "待命", tone: "idle" });
  const [isGenerating, setIsGenerating] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [streamDraft, setStreamDraft] = useState(null);
  const [summaryDraft, setSummaryDraft] = useState(null);
  const [storyModalOpen, setStoryModalOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [storyDraft, setStoryDraft] = useState(emptyStoryDraft);
  const [templateDraft, setTemplateDraft] = useState(emptyTemplateDraft);
  const [libraryTab, setLibraryTab] = useState("stories");
  const [inspectorTab, setInspectorTab] = useState("setup");
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
      })
      .finally(() => {
        setLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    persistState(appState).catch(() => {
      setStatus({ label: "本地保存失败", tone: "error" });
    });
  }, [appState, loaded]);

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

      const newNode = {
        id: createId(),
        parentId,
        childrenIds: [],
        branchId,
        content,
        instruction,
        createdAt: new Date().toISOString(),
        generationKind: mode,
      };

      if (parentId) {
        const parent = getNode(story, parentId);
        if (parent) parent.childrenIds.push(newNode.id);
      }

      story.nodes.push(newNode);
      story.activeNodeId = newNode.id;
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

    setSummaryDraft({
      storyId: story.id,
      label: `节点 ${nodeIndex} 的阶段摘要`,
      content: "",
    });
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
    exportFile(
      `novel-flow-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(appState, null, 2),
      "application/json",
    );
  }

  function exportMarkdown() {
    if (!activeStory) return;
    const markdown = `# ${activeStory.title}\n\n${activePath
      .map((node, index) => `## 节点 ${index + 1}\n\n${node.content}`)
      .join("\n\n")}`;
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
      systemPrompt: template?.systemPrompt ?? defaultSystemPrompt,
      world: template?.world ?? "",
      characters: template?.characters ?? "",
      style: template?.style ?? "细腻、连贯、有画面感",
    });
    setAppState((current) => ({
      ...current,
      stories: [story, ...current.stories],
      activeStoryId: story.id,
    }));
    setStoryDraft(emptyStoryDraft);
    setStoryModalOpen(false);
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
  }

  if (!loaded) {
    return <div className="app-loading">正在加载工作区…</div>;
  }

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
            <div className={`status-pill ${status.tone === "loading" ? "loading" : ""} ${status.tone === "error" ? "error" : ""}`}>{status.label}</div>
          </div>
        </section>

        <section className="workspace-grid">
          <aside className="rail rail-left">
            <Panel label="Library" title="资料库">
              <div className="segmented-control library-tabs">
                <button className={`segment ${libraryTab === "stories" ? "active" : ""}`} onClick={() => setLibraryTab("stories")}>作品</button>
                <button className={`segment ${libraryTab === "templates" ? "active" : ""}`} onClick={() => setLibraryTab("templates")}>模板</button>
              </div>

              {libraryTab === "stories" ? (
                <div className="story-list">
                  {appState.stories.length ? (
                    [...appState.stories]
                      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                      .map((story) => (
                        <button
                          key={story.id}
                          className={`story-item ${story.id === appState.activeStoryId ? "active" : ""}`}
                          onClick={() => setAppState((current) => ({ ...current, activeStoryId: story.id }))}
                        >
                          <span className="story-item-title">{story.title}</span>
                          <span className="story-item-meta">{story.genre || "未设置题材"} · {story.nodes.length} 节点</span>
                        </button>
                      ))
                  ) : (
                    <div className="empty-state">还没有作品。</div>
                  )}
                </div>
              ) : (
                <div className="template-list">
                  {appState.templates.map((template) => (
                    <div className="template-item" key={template.id}>
                      <div>
                        <strong className="template-item-title">{template.name}</strong>
                        <p className="template-item-meta">{template.style || "没有默认风格说明"}</p>
                      </div>
                      <button className="button button-ghost" onClick={() => applyTemplate(template.id)}>套用</button>
                    </div>
                  ))}
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
            </Panel>
          </aside>

          <section className="stage">
            <Panel
              label="Prompt Surface"
              title="续写控制"
              actions={
                <div className="topbar-actions">
                  <button className="button button-secondary" onClick={() => generateSummary()}>生成摘要</button>
                  <button
                    className="button button-danger"
                    onClick={() =>
                      setAppState((current) => {
                        const remaining = current.stories.filter((story) => story.id !== current.activeStoryId);
                        return {
                          ...current,
                          stories: remaining,
                          activeStoryId: remaining[0]?.id ?? null,
                        };
                      })
                    }
                  >
                    删除作品
                  </button>
                </div>
              }
            >
              <div className="stack-form">
                <label>
                  给 AI 的指导意见
                  <textarea
                    rows="4"
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    placeholder="例如：拉高紧张感，不要解释设定，让主角在结尾做出违反直觉的决定。"
                  />
                </label>
                <div className="action-row">
                  <button className="button button-primary" disabled={!activeStory || isGenerating} onClick={() => generate("continue")}>继续</button>
                  <button className="button button-secondary" disabled={!activeStory || isGenerating} onClick={() => generate("rewrite")}>重写当前节点</button>
                  <button className="button button-secondary" disabled={!activeStory || isGenerating} onClick={() => generate("branch")}>从这里分叉</button>
                </div>
              </div>
            </Panel>

            <Panel label="Current Branch" title="正文时间线">
              <div className="timeline" ref={timelineRef}>
                {activeStory ? (
                  activePath.map((node, index) => (
                    <article className={`timeline-node ${node.id === activeStory.activeNodeId ? "active" : ""}`} key={node.id}>
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
                  ))
                ) : (
                  <div className="empty-state">选中一个作品后开始写。</div>
                )}

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
            </Panel>
          </section>

          <aside className="rail rail-right">
            <Panel label="Inspector" title="检查器">
              <div className="segmented-control inspector-tabs">
                <button className={`segment ${inspectorTab === "setup" ? "active" : ""}`} onClick={() => setInspectorTab("setup")}>设定</button>
                <button className={`segment ${inspectorTab === "model" ? "active" : ""}`} onClick={() => setInspectorTab("model")}>模型</button>
                <button className={`segment ${inspectorTab === "branches" ? "active" : ""}`} onClick={() => setInspectorTab("branches")}>分支</button>
                <button className={`segment ${inspectorTab === "memory" ? "active" : ""}`} onClick={() => setInspectorTab("memory")}>记忆</button>
              </div>

              {inspectorTab === "setup" ? (
                activeStory ? <StoryForm story={activeStory} templates={appState.templates} onChange={(nextStory) => updateActiveStory(() => nextStory)} /> : <div className="empty-state">先创建一个作品。</div>
              ) : null}

              {inspectorTab === "model" ? (
                activeStory ? <ModelForm story={activeStory} onChange={(nextStory) => updateActiveStory(() => nextStory)} /> : <div className="empty-state">先创建一个作品。</div>
              ) : null}

              {inspectorTab === "branches" ? (
                activeStory ? <StoryTree story={activeStory} activeNodeId={activeStory.activeNodeId} onSelect={(nodeId) => updateActiveStory((story) => { story.activeNodeId = nodeId; return story; })} /> : <div className="empty-state">暂无分支。</div>
              ) : null}

              {inspectorTab === "memory" ? (
                <div className="summary-list" ref={summaryRef}>
                  {activeSummaryDraft ? (
                    <article className="summary-item">
                      <div className="summary-item-header">
                        <div>
                          <strong>正在生成摘要</strong>
                          <div className="summary-meta">{activeSummaryDraft.label}</div>
                        </div>
                        <span className="summary-label">流式输出</span>
                      </div>
                      <div className="summary-content streaming-content">{activeSummaryDraft.content || "…"}</div>
                    </article>
                  ) : null}

                  {activeStory?.summaries.length ? (
                    [...activeStory.summaries].reverse().map((summary) => (
                      <article className="summary-item" key={summary.id}>
                        <div className="summary-item-header">
                          <div>
                            <strong>{summary.title}</strong>
                            <div className="summary-meta">节点 {summary.nodeIndex}</div>
                          </div>
                          <span className="summary-label">{summary.source}</span>
                        </div>
                        <div className="summary-content">{summary.content}</div>
                      </article>
                    ))
                  ) : (
                    <div className="empty-state">摘要会在这里累计。</div>
                  )}
                </div>
              ) : null}
            </Panel>
          </aside>
        </section>
      </main>

      {storyModalOpen ? (
        <Modal label="Create Story" title="新建作品" onClose={() => setStoryModalOpen(false)}>
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
        <Modal label="Create Template" title="新建模板" onClose={() => setTemplateModalOpen(false)}>
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
