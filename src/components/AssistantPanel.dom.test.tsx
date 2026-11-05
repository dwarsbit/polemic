// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentMessage } from "@/lib/tauri";

const disk: Record<string, string> = {};
/** The model's replies, in order; each sees the history so far. */
let script: ((
  messages: AgentMessage[],
) => Extract<AgentMessage, { role: "assistant" }>)[] = [];
const compiled = vi.fn(async () => {});

vi.mock("@/lib/query-client", () => ({ invalidateGitState: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readProjectFile: vi.fn(async (_dir: string, path: string) => {
    if (disk[path] === undefined) throw new Error("not found");
    return disk[path];
  }),
  writeProjectFile: vi.fn(async (_dir: string, path: string, content: string) => {
    disk[path] = content;
  }),
  setAssistantCompile: vi.fn(async (projectPath: string, allowed: boolean) => ({
    assistantCompileProjects: allowed ? [projectPath] : [],
  })),
  aiAgentTurn: vi.fn(
    async (args: { messages: AgentMessage[] }, onText: (delta: string) => void) => {
      const next = script.shift();
      const reply = next
        ? next(args.messages)
        : { role: "assistant", content: "Done." };
      if (reply.content) onText(reply.content);
      return reply;
    },
  ),
}));

import { AssistantPanel } from "@/components/AssistantPanel";
import { useAssistantStore } from "@/store/assistant";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

const file = (path: string) => ({
  name: path,
  path,
  isDir: false,
  size: null,
  modified: null,
  children: [],
});

const call = (name: string, args: object) => () => ({
  role: "assistant" as const,
  content: "",
  tool_calls: [
    {
      id: `call-${name}`,
      type: "function" as const,
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});

let root: Root | null = null;

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

async function render() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AssistantPanel />);
  });
  return host;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

beforeEach(() => {
  for (const key of Object.keys(disk)) delete disk[key];
  disk["main.tex"] = "\\begin{document}\nHello.\n\\end{document}";
  disk["table.tex"] = "\\begin{tabular}{ll}\na & b \\\\\n\\end{tabular}";
  script = [];
  compiled.mockClear();
  useProjectStore.setState({
    project: { name: "p", path: "/p" },
    files: [file("main.tex"), file("table.tex")],
    mainFile: "main.tex",
    activeFile: "main.tex",
    buffers: {},
  });
  useEditorStore.setState({ content: disk["main.tex"] });
  useSettingsStore.setState({
    ai: { provider: null, baseUrl: "http://localhost:11434/v1", apiKey: "k", model: "m" },
    assistantMode: "latex",
    assistantCompileProjects: [],
  });
  useAssistantStore.getState().syncProject("/p");
  useAssistantStore.setState({ items: [], history: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("AssistantPanel", () => {
  it("shows a proposed change and applies it to the file", async () => {
    script = [
      call("read_file", { path: "table.tex" }),
      call("propose_change", {
        path: "table.tex",
        explanation: "Right-aligns the second column.",
        replacements: [{ find: "{ll}", replace: "{lr}" }],
      }),
      () => ({ role: "assistant", content: "Review the change above." }),
    ];
    const host = await render();
    await act(async () => {
      await useAssistantStore.getState().ask("Align the numbers right.");
    });
    await settle();
    expect(host.textContent).toContain("Read table.tex");
    expect(host.textContent).toContain("Right-aligns the second column.");
    expect(host.textContent).toContain("Review the change above.");
    expect(disk["table.tex"]).toContain("{ll}");

    await act(async () => {
      button(host, "Apply").click();
    });
    await settle();
    expect(disk["table.tex"]).toContain("{lr}");
    expect(host.textContent).toContain("Applied");

    // The model hears about it with the next question.
    script = [
      (messages) => {
        const last = messages[messages.length - 1];
        return {
          role: "assistant",
          content: last.content.startsWith("(The user applied change 1.)")
            ? "Noted."
            : "?",
        };
      },
    ];
    await act(async () => {
      await useAssistantStore.getState().ask("Thanks.");
    });
    expect(host.textContent).toContain("Noted.");
  });

  it("warns when a change in LaTeX mode edits the text", async () => {
    script = [
      call("propose_change", {
        path: "main.tex",
        explanation: "Rewords the greeting.",
        replacements: [{ find: "Hello.", replace: "Goodbye." }],
      }),
    ];
    const host = await render();
    await act(async () => {
      await useAssistantStore.getState().ask("Fix it.");
    });
    await settle();
    expect(host.textContent).toContain("This change edits your text");
  });

  it("asks before it compiles, and remembers the answer", async () => {
    usePreviewStore.setState({
      compileNow: async () => {
        await compiled();
        usePreviewStore.setState({ status: "ok", issues: [], error: null });
      },
    });
    script = [
      call("compile", {}),
      () => ({ role: "assistant", content: "It compiles." }),
    ];
    const host = await render();
    let asking: Promise<void> = Promise.resolve();
    await act(async () => {
      asking = useAssistantStore.getState().ask("Does it compile?");
    });
    await settle();
    expect(host.textContent).toContain("Allow the assistant to compile this project?");
    expect(compiled).not.toHaveBeenCalled();
    await act(async () => {
      button(host, "Allow compiling").click();
      await asking;
    });
    expect(compiled).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().assistantCompileProjects).toEqual(["/p"]);
    expect(host.textContent).toContain("It compiles.");
  });

  it("asks for a provider when none is set up", async () => {
    useSettingsStore.setState({ ai: null });
    const host = await render();
    expect(host.textContent).toContain("Set up an AI provider to use the assistant.");
  });
});
