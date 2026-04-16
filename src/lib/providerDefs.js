import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createXai } from "@ai-sdk/xai";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createAzure } from "@ai-sdk/azure";

export const emptyProviderFields = {
  apiKey: "",
  model: "",
  baseURL: "",
};

const KNOWN_MODELS = {
  xai: [
    "grok-4",
    "grok-4-0709",
    "grok-4.20-0309-reasoning",
    "grok-4-1-fast-reasoning",
    "grok-4.20-multi-agent-0309",
    "grok-4.20-0309-non-reasoning",
    "grok-4-1-fast-non-reasoning",
  ],
  anthropic: [
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-haiku-4-20250414",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ],
  mistral: [
    "mistral-large-latest",
    "mistral-medium-latest",
    "mistral-small-latest",
    "codestral-latest",
    "open-mistral-nemo",
  ],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  groq: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768",
    "gemma2-9b-it",
  ],
  cohere: ["command-r-plus", "command-r", "command-light"],
  perplexity: ["sonar-pro", "sonar", "sonar-deep-research"],
  togetherai: [
    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    "Qwen/Qwen2.5-72B-Instruct-Turbo",
    "deepseek-ai/DeepSeek-R1",
  ],
};

export const PROVIDERS = [
  {
    value: "google",
    label: "Google Gemini",
    keyPlaceholder: "AIza...",
    defaultModel: "gemini-2.5-flash",
    presetModels: [],
    browserSupported: true,
  },
  {
    value: "anthropic",
    label: "Anthropic Claude",
    keyPlaceholder: "sk-ant-...",
    defaultModel: "claude-sonnet-4-20250514",
    presetModels: KNOWN_MODELS.anthropic,
    browserSupported: true,
  },
  {
    value: "openai",
    label: "OpenAI",
    keyPlaceholder: "sk-...",
    defaultModel: "gpt-4o",
    presetModels: [],
    browserSupported: true,
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    keyPlaceholder: "sk-...",
    defaultModel: "deepseek-chat",
    presetModels: KNOWN_MODELS.deepseek,
    browserSupported: true,
  },
  {
    value: "xai",
    label: "xAI Grok",
    keyPlaceholder: "xai-...",
    defaultModel: "grok-4",
    presetModels: KNOWN_MODELS.xai,
    browserSupported: true,
  },
  {
    value: "groq",
    label: "Groq",
    keyPlaceholder: "gsk_...",
    defaultModel: "llama-3.3-70b-versatile",
    presetModels: KNOWN_MODELS.groq,
    browserSupported: true,
  },
  {
    value: "mistral",
    label: "Mistral AI",
    keyPlaceholder: "",
    defaultModel: "mistral-large-latest",
    presetModels: KNOWN_MODELS.mistral,
    browserSupported: true,
  },
  {
    value: "cohere",
    label: "Cohere",
    keyPlaceholder: "",
    defaultModel: "command-r-plus",
    presetModels: KNOWN_MODELS.cohere,
    browserSupported: true,
  },
  {
    value: "togetherai",
    label: "Together AI",
    keyPlaceholder: "",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    presetModels: KNOWN_MODELS.togetherai,
    browserSupported: true,
  },
  {
    value: "perplexity",
    label: "Perplexity",
    keyPlaceholder: "pplx-...",
    defaultModel: "sonar-pro",
    presetModels: KNOWN_MODELS.perplexity,
    browserSupported: true,
  },
  {
    value: "azure",
    label: "Azure OpenAI",
    keyPlaceholder: "",
    defaultModel: "gpt-4o-mini",
    needsBaseURL: true,
    baseURLPlaceholder: "https://YOUR-RESOURCE.openai.azure.com/openai",
    baseURLHint: "使用 Azure OpenAI endpoint，不是 api.openai.com。",
    presetModels: ["gpt-4o-mini", "gpt-4o"],
    browserSupported: true,
  },
  {
    value: "bedrock",
    label: "Amazon Bedrock",
    keyPlaceholder: "",
    defaultModel: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    presetModels: ["anthropic.claude-3-5-sonnet-20241022-v2:0"],
    browserSupported: false,
    browserHint: "Bedrock 浏览器直连不适合纯前端，需要服务端签名或代理。",
  },
  {
    value: "openai_compatible",
    label: "OpenAI Compatible",
    keyPlaceholder: "",
    defaultModel: "gpt-4o-mini",
    needsBaseURL: true,
    baseURLPlaceholder: "https://api.openai.com/v1",
    baseURLHint: "兼容 OpenAI Chat Completions / Models API 的服务。",
    presetModels: [],
    browserSupported: true,
  },
];

export function getProviderEntry(provider) {
  return PROVIDERS.find((entry) => entry.value === provider) ?? PROVIDERS.find((entry) => entry.value === "openai_compatible");
}

export function migrateModelConfig(model = {}) {
  const provider = normalizeProviderValue(model.provider);
  const entry = getProviderEntry(provider);
  return {
    provider,
    apiKey: model.apiKey ?? "",
    model: model.model ?? entry.defaultModel,
    baseURL: model.baseURL ?? defaultBaseURLFor(provider),
    temperature: typeof model.temperature === "number" ? model.temperature : 0.9,
    maxTokens: typeof model.maxTokens === "number" ? model.maxTokens : 900,
  };
}

export function normalizeProviderValue(provider) {
  const value = String(provider ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_/-]/g, "_");

  if (!value) return "openai_compatible";
  if (value === "gemini") return "google";
  if (value === "openai-compatible") return "openai_compatible";
  return PROVIDERS.some((entry) => entry.value === value) ? value : "openai_compatible";
}

export function defaultBaseURLFor(provider) {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "deepseek":
      return "https://api.deepseek.com";
    case "xai":
      return "https://api.x.ai/v1";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "mistral":
      return "https://api.mistral.ai/v1";
    case "cohere":
      return "https://api.cohere.com/v1";
    case "togetherai":
      return "https://api.together.xyz/v1";
    case "perplexity":
      return "https://api.perplexity.ai";
    case "azure":
      return "";
    case "openai_compatible":
      return "https://api.openai.com/v1";
    default:
      return "";
  }
}

export function createProviderFields(modelConfig) {
  const migrated = migrateModelConfig(modelConfig);
  return {
    apiKey: migrated.apiKey,
    model: migrated.model,
    baseURL: migrated.baseURL,
  };
}

export function createLanguageModel(modelConfig) {
  const provider = normalizeProviderValue(modelConfig.provider);
  const entry = getProviderEntry(provider);

  if (!entry.browserSupported) {
    throw new Error(entry.browserHint ?? "当前 provider 不支持纯前端直连。");
  }

  switch (provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey: modelConfig.apiKey })(modelConfig.model);
    case "anthropic":
      return createAnthropic({ apiKey: modelConfig.apiKey })(modelConfig.model);
    case "openai":
      return createOpenAI({
        apiKey: modelConfig.apiKey,
        baseURL: modelConfig.baseURL || defaultBaseURLFor(provider),
      })(modelConfig.model);
    case "deepseek":
      return createDeepSeek({ apiKey: modelConfig.apiKey })(modelConfig.model);
    case "xai":
      return createXai({ apiKey: modelConfig.apiKey })(modelConfig.model);
    case "groq":
      return createGroq({ apiKey: modelConfig.apiKey })(modelConfig.model);
    case "mistral":
      return createMistral({ apiKey: modelConfig.apiKey })(modelConfig.model);
    case "cohere":
      return createCohere({ apiKey: modelConfig.apiKey })(modelConfig.model);
    case "togetherai":
      return createTogetherAI({ apiKey: modelConfig.apiKey })(modelConfig.model);
    case "perplexity":
      return createPerplexity({ apiKey: modelConfig.apiKey })(modelConfig.model);
    case "azure": {
      const endpoint = modelConfig.baseURL?.trim();
      if (!endpoint) throw new Error("Azure OpenAI 需要 endpoint。");
      return createAzure({
        apiKey: modelConfig.apiKey,
        resourceName: "",
        apiVersion: "2024-10-21",
        baseURL: endpoint,
      })(modelConfig.model);
    }
    case "openai_compatible":
    default:
      return createOpenAICompatible({
        name: "openai-compatible",
        apiKey: modelConfig.apiKey,
        baseURL: modelConfig.baseURL || defaultBaseURLFor("openai_compatible"),
      })(modelConfig.model);
  }
}

export async function testProviderConnection(modelConfig) {
  const model = createLanguageModel(modelConfig);
  const { text } = await generateText({
    model,
    system: "Reply with exactly OK.",
    prompt: "OK",
    maxOutputTokens: 8,
    temperature: 0,
  });
  return text.trim();
}

export async function listProviderModels(modelConfig) {
  const provider = normalizeProviderValue(modelConfig.provider);
  const entry = getProviderEntry(provider);

  if (KNOWN_MODELS[provider]?.length) {
    return [...KNOWN_MODELS[provider]];
  }

  if (provider === "openai" || provider === "openai_compatible") {
    const base = (modelConfig.baseURL || defaultBaseURLFor(provider)).replace(/\/$/, "");
    const response = await fetch(`${base}/models`, {
      headers: {
        Authorization: `Bearer ${modelConfig.apiKey}`,
      },
    });
    if (!response.ok) {
      throw new Error(`拉取模型列表失败：${response.status}`);
    }
    const json = await response.json();
    const models = Array.isArray(json.data) ? json.data.map((item) => item.id).filter(Boolean) : [];
    return models.length ? models.sort() : entry.presetModels;
  }

  if (provider === "google") {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(modelConfig.apiKey)}`,
    );
    if (!response.ok) {
      throw new Error(`拉取模型列表失败：${response.status}`);
    }
    const json = await response.json();
    const models = Array.isArray(json.models)
      ? json.models
          .filter((item) => Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes("generateContent"))
          .map((item) => String(item.name ?? "").replace(/^models\//, ""))
          .filter(Boolean)
      : [];
    return models.sort();
  }

  if (entry.presetModels?.length) {
    return entry.presetModels;
  }

  throw new Error(entry.browserHint ?? "当前 provider 不支持浏览器侧拉取模型列表。");
}
