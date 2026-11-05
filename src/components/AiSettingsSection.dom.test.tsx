// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AiSettings } from "@/lib/tauri";

const saved: AiSettings[] = [];
let models: string[] | Error = [];

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  updateAiSettings: vi.fn(async (ai: AiSettings) => {
    saved.push(ai);
    return { ai };
  }),
  aiListModels: vi.fn(async () => {
    if (models instanceof Error) throw models.message;
    return models;
  }),
}));

import { AiSettingsSection } from "@/components/AiSettingsSection";
import { useSettingsStore } from "@/store/settings";

let root: Root | null = null;

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

async function render() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AiSettingsSection />);
  });
  await settle();
  return host;
}

function field(host: HTMLElement, label: string): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`no field ${label}`);
  return found;
}

function trigger(host: HTMLElement, label: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`no select ${label}`);
  return found;
}

async function blurWith(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  saved.length = 0;
  models = [];
  useSettingsStore.setState({ ai: null });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("AiSettingsSection", () => {
  it("starts with only the provider until one is chosen", async () => {
    const host = await render();
    expect(trigger(host, "Provider").textContent).toContain("Choose a provider");
    expect(host.querySelector('input[aria-label="API key"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Model"]')).toBeNull();
  });

  it("shows a preset's key field, note and suggested model", async () => {
    useSettingsStore.setState({
      ai: {
        provider: "mistral",
        baseUrl: "https://api.mistral.ai/v1",
        apiKey: null,
        model: "mistral-large-latest",
      },
    });
    const host = await render();
    expect(trigger(host, "Provider").textContent).toContain("Mistral");
    expect(host.textContent).toContain("sent only to api.mistral.ai");
    expect(field(host, "API key").value).toBe("");
    expect(trigger(host, "Model").textContent).toContain("mistral-large-latest");
    // No key yet: the list cannot be loaded.
    expect(host.textContent).toContain("Add a key to load the list");
    expect(host.querySelector('input[aria-label="Base URL"]')).toBeNull();
  });

  it("saves the key on blur and loads the provider's models", async () => {
    useSettingsStore.setState({
      ai: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: null,
        model: "gpt-5",
      },
    });
    models = ["gpt-5", "o4-mini"];
    const host = await render();
    await blurWith(field(host, "API key"), " sk-test ");
    expect(saved[saved.length - 1]).toEqual({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-5",
    });
    expect(host.textContent).toContain("OpenAI lists 2 models");
  });

  it("reports a provider that refuses the key", async () => {
    useSettingsStore.setState({
      ai: {
        provider: "mistral",
        baseUrl: "https://api.mistral.ai/v1",
        apiKey: null,
        model: "mistral-large-latest",
      },
    });
    models = new Error("the provider returned 401 Unauthorized: bad key");
    const host = await render();
    await blurWith(field(host, "API key"), "wrong");
    expect(host.textContent).toContain(
      "The provider returned 401 Unauthorized: bad key",
    );
  });

  it("matches settings saved before presets by their base URL", async () => {
    useSettingsStore.setState({
      ai: {
        provider: null,
        baseUrl: "http://localhost:11434/v1",
        apiKey: null,
        model: "qwen3",
      },
    });
    models = ["qwen3", "llama3"];
    const host = await render();
    expect(trigger(host, "Provider").textContent).toContain("Ollama");
    expect(host.textContent).toContain("Nothing leaves it");
    expect(host.querySelector('input[aria-label="API key"]')).toBeNull();
    // A local server is asked for its models right away.
    expect(host.textContent).toContain("Ollama lists 2 models");
  });

  it("keeps a custom endpoint's URL field and takes a typed model", async () => {
    useSettingsStore.setState({
      ai: {
        provider: "custom",
        baseUrl: "https://llm.example.org/v1",
        apiKey: "k",
        model: "my-model",
      },
    });
    const host = await render();
    expect(field(host, "Base URL").value).toBe("https://llm.example.org/v1");
    // A model not in any list shows as "Other…" with its name below.
    expect(trigger(host, "Model").textContent).toContain("Other…");
    expect(field(host, "Model name").value).toBe("my-model");
    await blurWith(field(host, "Model name"), "another-model");
    expect(saved[saved.length - 1]?.model).toBe("another-model");
  });

  it("shows a save error from the backend", async () => {
    useSettingsStore.setState({
      ai: { provider: "custom", baseUrl: null, apiKey: null, model: null },
    });
    const { updateAiSettings } = await import("@/lib/tauri");
    vi.mocked(updateAiSettings).mockRejectedValueOnce(
      "the AI base URL must start with https:// (plain http is only allowed for localhost)",
    );
    const host = await render();
    await blurWith(field(host, "Base URL"), "http://example.org/v1");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "must start with https",
    );
  });
});
