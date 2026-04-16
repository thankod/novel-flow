import { streamText } from "ai";
import { createId } from "./id";
import { createLanguageModel } from "./providerDefs";
import { countGeneratedNodes, getNode, getPathToRoot } from "./storyState";

export async function requestCompletion(modelConfig, promptPayload, onPartialText) {
  if (!modelConfig.apiKey) throw new Error("请先填写 API Key。");

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

export function buildPrompt(story, mode, instruction) {
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

export function buildSummaryPrompt(story) {
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

export function createGeneratedNode({ parentId, branchId, content, instruction, mode }) {
  return {
    id: createId(),
    parentId,
    childrenIds: [],
    branchId,
    content,
    instruction,
    createdAt: new Date().toISOString(),
    generationKind: mode,
  };
}
