import { createId } from "./id";
import { migrateModelConfig } from "./providerDefs";

export const DB_NAME = "novel-flow-db";
export const DB_VERSION = 1;
export const STORE_NAME = "app-state";
export const STATE_KEY = "state";

export const defaultSystemPrompt =
  "你是互动小说写作搭档。严格基于用户提供的设定、摘要记忆、最近正文和指导意见续写。只输出小说正文，不要解释，不要列提纲，不要使用标题。保持人物一致、设定一致、情节连贯。";

export const emptyTemplateDraft = {
  name: "",
  systemPrompt: "",
  world: "",
  characters: "",
  style: "",
};

export const emptyStoryDraft = {
  title: "",
  genre: "",
  templateId: "",
  openingPrompt: "",
};

export function createDefaultState() {
  return {
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
}

export function createEmptyStory(partial = {}) {
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
    model: migrateModelConfig(partial.model ?? partial),
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

export function getTemplate(templates, templateId) {
  return templates.find((template) => template.id === templateId) ?? null;
}

export function getNode(story, nodeId) {
  return story.nodes.find((node) => node.id === nodeId) ?? null;
}

export function getPathToRoot(story, nodeId) {
  const map = new Map(story.nodes.map((node) => [node.id, node]));
  const path = [];
  let current = map.get(nodeId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? map.get(current.parentId) : null;
  }
  return path;
}

export function countGeneratedNodes(story) {
  return story.nodes.filter((node) => node.generationKind !== "root").length;
}

export function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export async function openDb() {
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

export async function loadState() {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(migrateState(request.result ?? createDefaultState()));
  });
}

export async function persistState(state) {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_NAME).put(state, STATE_KEY);
  });
}

export function migrateState(state) {
  const base = createDefaultState();
  const templates = Array.isArray(state?.templates) && state.templates.length ? state.templates : base.templates;
  const stories = Array.isArray(state?.stories)
    ? state.stories.map((story) => ({
        ...story,
        model: migrateModelConfig(story.model),
      }))
    : [];
  return {
    templates,
    stories,
    activeStoryId: state?.activeStoryId ?? stories[0]?.id ?? null,
  };
}
