import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/lib/tauri";
import {
  MAX_STEPS,
  runAgent,
  systemPrompt,
  userMessage,
  type AssistantReply,
  type SendTurn,
} from "./agent";
import type { AssistantHost } from "./tools";

const host: AssistantHost = {
  listFiles: () => ["main.tex"],
  mainFile: () => "main.tex",
  readFile: async (path) =>
    path === "main.tex" ? "\\begin{document}\nHi\n\\end{document}" : null,
  issues: () => [],
  compile: async () => ({ success: true, issues: [] }),
  packageInfo: async () => [],
  propose: () => 1,
  mode: () => "syntax",
};

function call(id: string, name: string, args: object): AssistantReply {
  return {
    role: "assistant",
    content: "",
    tool_calls: [
      { id, type: "function", function: { name, arguments: JSON.stringify(args) } },
    ],
  };
}

/** A model that answers from a script, recording what it was sent. */
function scripted(replies: AssistantReply[]) {
  const seen: AgentMessage[][] = [];
  const send: SendTurn = async (messages, _tools, onText) => {
    seen.push([...messages]);
    const reply = replies.shift() ?? { role: "assistant", content: "Done." };
    if (reply.content) onText(reply.content);
    return reply;
  };
  return { send, seen };
}

const quiet = { onText: () => {}, onStep: () => {}, isCancelled: () => false };

describe("runAgent", () => {
  it("runs tool calls until the model answers in text", async () => {
    const { send, seen } = scripted([
      call("c1", "read_file", { path: "main.tex" }),
      { role: "assistant", content: "Your document looks fine." },
    ]);
    const history: AgentMessage[] = [
      { role: "system", content: systemPrompt("syntax") },
      { role: "user", content: "Check my file." },
    ];
    const steps: string[] = [];
    const outcome = await runAgent(history, host, send, {
      ...quiet,
      onStep: (s) => steps.push(s),
    });
    expect(outcome).toBe("done");
    expect(steps).toEqual(["Read main.tex"]);
    expect(history.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    const tool = history[3];
    expect(tool.role === "tool" && tool.tool_call_id).toBe("c1");
    expect(tool.role === "tool" && tool.content).toContain("2| Hi");
    expect(seen[1]).toHaveLength(4);
  });

  it("answers malformed arguments with an error the model can read", async () => {
    const { send } = scripted([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "read_file", arguments: "{oops" },
          },
        ],
      },
    ]);
    const history: AgentMessage[] = [{ role: "user", content: "x" }];
    await runAgent(history, host, send, quiet);
    const tool = history[2];
    expect(tool.role === "tool" && tool.content).toMatch(/not a JSON object/);
  });

  it("stops at the step limit", async () => {
    const replies = Array.from({ length: MAX_STEPS + 2 }, (_, i) =>
      call(`c${i}`, "list_files", {}),
    );
    const { send } = scripted(replies);
    const history: AgentMessage[] = [{ role: "user", content: "x" }];
    expect(await runAgent(history, host, send, quiet)).toBe("limit");
  });

  it("stops when cancelled", async () => {
    let cancelled = false;
    const { send } = scripted([
      call("c1", "list_files", {}),
      call("c2", "list_files", {}),
    ]);
    const history: AgentMessage[] = [{ role: "user", content: "x" }];
    const outcome = await runAgent(history, host, send, {
      ...quiet,
      onStep: () => {
        cancelled = true;
      },
      isCancelled: () => cancelled,
    });
    expect(outcome).toBe("cancelled");
  });
});

describe("prompts", () => {
  it("sets the job by mode", () => {
    expect(systemPrompt("syntax")).toMatch(/Do not write, rewrite/);
    expect(systemPrompt("prose")).toMatch(/Never change what the text says/);
  });

  it("puts the context before the question", () => {
    expect(
      userMessage("Why?", {
        activeFile: "main.tex",
        cursorLine: 4,
        selection: { path: "main.tex", fromLine: 2, toLine: 3, text: "a\nb" },
        issue: null,
      }),
    ).toBe(
      "Open file: main.tex (cursor on line 4)\nSelected in main.tex, lines 2-3:\n```latex\na\nb\n```\n\nWhy?",
    );
    expect(
      userMessage("Hi", {
        activeFile: null,
        cursorLine: null,
        selection: null,
        issue: null,
      }),
    ).toBe("Hi");
  });
});
