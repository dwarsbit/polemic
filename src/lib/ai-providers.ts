import type { AiSettings } from "@/lib/tauri";

/** A preset for the assistant settings: a provider's endpoint, whether
 *  it needs a key, and models to start from. */
export interface AiProvider {
  id: string;
  name: string;
  /** The OpenAI-compatible base URL, up to /v1; null for "custom",
   *  where the user types one. */
  baseUrl: string | null;
  /** Local servers run without a key. */
  needsKey: boolean;
  /** The host the key is sent to, for the note under the key. */
  host: string | null;
  /** Models known to support tool calls, the first the suggestion. */
  models: string[];
  /** Where the user gets a key. */
  keyUrl: string | null;
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    needsKey: true,
    host: "api.mistral.ai",
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
    keyUrl: "https://console.mistral.ai/api-keys",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    host: "api.openai.com",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    needsKey: true,
    host: "api.anthropic.com",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
    keyUrl: "https://platform.claude.com/settings/keys",
  },
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    needsKey: false,
    host: null,
    models: [],
    keyUrl: null,
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    needsKey: false,
    host: null,
    models: [],
    keyUrl: null,
  },
  {
    id: "custom",
    name: "Custom",
    baseUrl: null,
    needsKey: false,
    host: null,
    models: [],
    keyUrl: null,
  },
];

export const CUSTOM_PROVIDER = AI_PROVIDERS[AI_PROVIDERS.length - 1];

export function aiProvider(id: string | null | undefined): AiProvider | null {
  return AI_PROVIDERS.find((p) => p.id === id) ?? null;
}

/** The preset the settings belong to. Settings saved before presets
 *  carry no id: they are matched by base URL, else custom. */
export function providerOf(ai: AiSettings | null): AiProvider | null {
  if (ai === null) return null;
  const named = aiProvider(ai.provider);
  if (named !== null) return named;
  const url = (ai.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (url === "") return null;
  return AI_PROVIDERS.find((p) => p.baseUrl === url) ?? CUSTOM_PROVIDER;
}

/** Whether the assistant can run: an endpoint, a model and a key
 *  where the provider needs one. */
export function aiConfigured(ai: AiSettings | null): boolean {
  if (ai === null) return false;
  const provider = providerOf(ai);
  if (provider === null) return false;
  const hasKey = (ai.apiKey ?? "").trim() !== "";
  return (
    (ai.baseUrl ?? "").trim() !== "" &&
    (ai.model ?? "").trim() !== "" &&
    (hasKey || !provider.needsKey)
  );
}

/** The model as the panel shows it, with its provider when that is
 *  not obvious from the name. */
export function describeModel(ai: AiSettings | null): string | null {
  if (!aiConfigured(ai) || ai === null) return null;
  return ai.model ?? null;
}
