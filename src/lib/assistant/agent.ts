/**
 * The assistant's loop: send the conversation and the tools to the
 * model, run the tool calls it asks for, feed the results back, and
 * repeat until it answers in plain text (or the step limit is hit).
 * The transport is passed in, so the loop runs against a fake model in
 * tests.
 */

import type {
  AgentMessage,
  AgentToolCall,
  AgentToolSpec,
  CompileIssue,
} from "@/lib/tauri";
import type { AssistantMode } from "@/store/settings";
import { describeCall, runTool, TOOL_SPECS, type AssistantHost } from "./tools";

export type AssistantReply = Extract<AgentMessage, { role: "assistant" }>;

/** One model call: the history and tools in, the assistant message out. */
export type SendTurn = (
  messages: AgentMessage[],
  tools: AgentToolSpec[],
  onText: (delta: string) => void,
) => Promise<AssistantReply>;

export const MAX_STEPS = 12;

const COMMON = [
  "You are the assistant inside Polemic, a desktop LaTeX editor. You work on the user's project through tools.",
  "Look before you answer: read the relevant files, search the project and check the compile issues instead of guessing.",
  "Change files only through propose_change. The user reviews every change as a diff and applies it; say so instead of claiming you changed anything.",
  "After the user applies a change, you may compile to check that it worked.",
  "Keep changes minimal and in the document's existing style. Prefer packages the document already loads, and check with package_info before suggesting a new one.",
  "Answer briefly in plain sentences. Use Markdown code blocks for LaTeX you show. Reply in the user's language.",
];

const MODE: Record<AssistantMode, string> = {
  syntax:
    "Your job is LaTeX itself: syntax, compile errors and warnings, packages, tables, floats, math, references, bibliographies, TikZ and layout. Do not write, rewrite, shorten or translate the author's text. If a fix needs a change to the text (an unescaped %, a broken reference), keep it to the minimum and say so.",
  prose:
    "Your job is polishing the author's text: grammar, word choice, clarity and flow. Never change what the text says. Keep every command, environment, citation, reference, label, math expression and number exactly as it is, and never add or drop a negation. Change one paragraph at a time. The app turns down any change that breaks these rules.",
};

export function systemPrompt(mode: AssistantMode): string {
  return [...COMMON, MODE[mode]].join("\n");
}

/** What the user is looking at when they ask. */
export interface AskContext {
  activeFile: string | null;
  /** 1-based cursor line in the active file. */
  cursorLine: number | null;
  selection: { path: string; fromLine: number; toLine: number; text: string } | null;
  issue: CompileIssue | null;
}

/** The user's message with its context, as the model reads it. */
export function userMessage(text: string, context: AskContext): string {
  const lines: string[] = [];
  if (context.activeFile !== null) {
    lines.push(
      `Open file: ${context.activeFile}${context.cursorLine !== null ? ` (cursor on line ${context.cursorLine})` : ""}`,
    );
  }
  if (context.selection !== null) {
    const { path, fromLine, toLine, text: selected } = context.selection;
    lines.push(
      `Selected in ${path}, lines ${fromLine}-${toLine}:`,
      "```latex",
      selected,
      "```",
    );
  }
  if (context.issue !== null) {
    const { severity, file, line, message, detail } = context.issue;
    lines.push(
      `About this ${severity}${file ? ` in ${file}${line !== null ? `:${line}` : ""}` : ""}: ${message}`,
      ...detail.map((d) => `  ${d}`),
    );
  }
  if (lines.length === 0) return text;
  return `${lines.join("\n")}\n\n${text}`;
}

/** What the loop reports while it works. */
export interface RunCallbacks {
  onText: (delta: string) => void;
  /** A tool call finished; `label` says what it did. */
  onStep: (label: string) => void;
  /** A new model call starts (the reply text before it is final). */
  onTurn?: () => void;
  isCancelled: () => boolean;
}

function parseArgs(call: AgentToolCall): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || "{}");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Runs the loop on `history` (system message first, the new user
 * message last), appending every message to it. Resolves when the
 * model answers without tool calls, after MAX_STEPS turns or on
 * cancel. Transport errors reject.
 */
export async function runAgent(
  history: AgentMessage[],
  host: AssistantHost,
  send: SendTurn,
  callbacks: RunCallbacks,
): Promise<"done" | "limit" | "cancelled"> {
  for (let step = 0; step < MAX_STEPS; step++) {
    if (callbacks.isCancelled()) return "cancelled";
    callbacks.onTurn?.();
    const reply = await send(history, TOOL_SPECS, callbacks.onText);
    const calls = reply.tool_calls ?? [];
    history.push(
      calls.length > 0
        ? { role: "assistant", content: reply.content ?? "", tool_calls: calls }
        : { role: "assistant", content: reply.content ?? "" },
    );
    if (calls.length === 0) return "done";
    for (const call of calls) {
      if (callbacks.isCancelled()) {
        history.push({
          role: "tool",
          tool_call_id: call.id,
          content: "Stopped by the user.",
        });
        continue;
      }
      const args = parseArgs(call);
      let result: string;
      if (args === null) {
        result = "Error: the arguments were not a JSON object.";
      } else {
        try {
          result = await runTool(host, call.function.name, args);
        } catch (e) {
          result = `Error: ${String(e)}`;
        }
        callbacks.onStep(describeCall(call.function.name, args, result));
      }
      history.push({ role: "tool", tool_call_id: call.id, content: result });
    }
    if (callbacks.isCancelled()) return "cancelled";
  }
  return "limit";
}
