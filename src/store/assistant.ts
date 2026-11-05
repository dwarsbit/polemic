import { create } from "zustand";
import {
  MAX_STEPS,
  runAgent,
  systemPrompt,
  userMessage,
  type AskContext,
} from "@/lib/assistant/agent";
import { planReplacements } from "@/lib/assistant/edits";
import { aiConfigured } from "@/lib/ai-providers";
import type {
  AssistantHost,
  CompileResult,
  ProposedChange,
} from "@/lib/assistant/tools";
import { readCursor } from "@/lib/editor-edits";
import { applyFixEdits } from "@/lib/fix-issue";
import { currentText, writeFileEdits } from "@/lib/project-texts";
import {
  aiAgentTurn,
  aiCancel,
  texPackageInfo,
  writeProjectFile,
  type AgentMessage,
  type CompileIssue,
  type FileEntry,
} from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

export type ChangeStatus = "pending" | "applied" | "discarded";

export type ChatItem =
  | { id: number; kind: "user"; text: string; chips: string[] }
  | { id: number; kind: "assistant"; text: string }
  | { id: number; kind: "step"; text: string }
  | {
      id: number;
      kind: "change";
      change: ProposedChange;
      status: ChangeStatus;
      /** Why applying failed, shown on the card. */
      note: string | null;
    }
  | { id: number; kind: "error"; text: string };

/** What the next question carries besides its text. */
export interface PendingContext {
  selection: AskContext["selection"];
  issue: CompileIssue | null;
}

interface AssistantState {
  /** The project the conversation belongs to. */
  projectPath: string | null;
  items: ChatItem[];
  /** The conversation as the model sees it, system message first. */
  history: AgentMessage[];
  running: boolean;
  context: PendingContext;
  /** Set while the assistant waits for the user to allow compiling. */
  compileRequest: { resolve: (allowed: boolean) => void } | null;
  ask: (text: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
  setContext: (context: Partial<PendingContext>) => void;
  applyChange: (itemId: number) => Promise<void>;
  discardChange: (itemId: number) => void;
  answerCompileRequest: (allowed: boolean) => void;
  /** Starts over when another project is open. */
  syncProject: (path: string | null) => void;
}

/** A chat item before it has its id. */
type NewItem = ChatItem extends infer T
  ? T extends ChatItem
    ? Omit<T, "id">
    : never
  : never;

let nextId = 1;
let nextRequest = 1;
let currentRequest: number | null = null;
let cancelled = false;
/** Outcomes of change cards since the last question, told to the model
 *  with the next one. */
let notes: string[] = [];

const EMPTY_CONTEXT: PendingContext = { selection: null, issue: null };

function flatten(entries: FileEntry[], out: string[] = []): string[] {
  for (const entry of entries) {
    if (entry.isDir) flatten(entry.children, out);
    else out.push(entry.path);
  }
  return out;
}

/** The change's number as the model knows it. */
function changeNumber(item: ChatItem | undefined): number | null {
  return item?.kind === "change" ? item.change.id : null;
}

export const useAssistantStore = create<AssistantState>((set, get) => {
  const push = (item: NewItem) => {
    const full = { ...item, id: nextId++ } as ChatItem;
    set({ items: [...get().items, full] });
    return full.id;
  };
  const update = (id: number, patch: Partial<ChatItem>) =>
    set({
      items: get().items.map((item) =>
        item.id === id ? ({ ...item, ...patch } as ChatItem) : item,
      ),
    });

  async function compile(): Promise<CompileResult | null> {
    const project = useProjectStore.getState().project;
    if (project === null) throw new Error("no project is open");
    const settings = useSettingsStore.getState();
    if (!settings.assistantCompileProjects.includes(project.path)) {
      const allowed = await new Promise<boolean>((resolve) =>
        set({ compileRequest: { resolve } }),
      );
      set({ compileRequest: null });
      if (!allowed || cancelled) return null;
      await settings.setAssistantCompile(project.path, true);
    }
    // The compile reads the files on disk: save what the user (and
    // applied changes) left in the editor first.
    await useProjectStore
      .getState()
      .saveActiveFile({ background: true })
      .catch(() => false);
    await useProjectStore.getState().flushBuffers();
    await usePreviewStore.getState().compileNow();
    const preview = usePreviewStore.getState();
    if (preview.error !== null && preview.issues.length === 0) {
      throw new Error(preview.error);
    }
    return { success: preview.status === "ok", issues: preview.issues };
  }

  const host: AssistantHost = {
    listFiles: () => flatten(useProjectStore.getState().files),
    mainFile: () => useProjectStore.getState().mainFile,
    readFile: (path) => currentText(path),
    issues: () => usePreviewStore.getState().issues,
    compile,
    packageInfo: (names) => texPackageInfo(names),
    propose: (change) => {
      const number = get().items.filter((i) => i.kind === "change").length + 1;
      push({
        kind: "change",
        change: { ...change, id: number },
        status: "pending",
        note: null,
      });
      return number;
    },
    flagProse: () => useSettingsStore.getState().assistantMode === "latex",
  };

  return {
    projectPath: null,
    items: [],
    history: [],
    running: false,
    context: EMPTY_CONTEXT,
    compileRequest: null,

    ask: async (text) => {
      const question = text.trim();
      if (question === "" || get().running) return;
      const { ai, assistantMode } = useSettingsStore.getState();
      if (!aiConfigured(ai) || ai === null) {
        push({
          kind: "error",
          text: "No AI provider is set up. Add one in Settings → Assistant.",
        });
        return;
      }
      const { activeFile } = useProjectStore.getState();
      const { context } = get();
      const cursor = readCursor();
      const askContext: AskContext = {
        activeFile,
        cursorLine: cursor?.line ?? null,
        selection: context.selection,
        issue: context.issue,
      };
      const chips: string[] = [];
      if (context.selection !== null) {
        const { path, fromLine, toLine } = context.selection;
        chips.push(
          fromLine === toLine
            ? `${path}, line ${fromLine}`
            : `${path}, lines ${fromLine}-${toLine}`,
        );
      }
      if (context.issue !== null) chips.push(context.issue.message);
      push({ kind: "user", text: question, chips });

      const prefix = notes.length > 0 ? `(${notes.join(" ")})\n\n` : "";
      notes = [];
      // The system message follows the mode chosen now.
      const history: AgentMessage[] = [
        { role: "system", content: systemPrompt(assistantMode) },
        ...get().history.slice(1),
        { role: "user", content: prefix + userMessage(question, askContext) },
      ];
      // Where this question starts: a stopped or failed run is dropped
      // from what the model sees, so the history stays well formed.
      const base = history.length - 1;
      set({ history, running: true, context: EMPTY_CONTEXT });
      cancelled = false;

      let replyId: number | null = null;
      const send = (
        messages: AgentMessage[],
        tools: Parameters<typeof aiAgentTurn>[0]["tools"],
        onText: (delta: string) => void,
      ) => {
        const requestId = nextRequest++;
        currentRequest = requestId;
        return aiAgentTurn(
          {
            baseUrl: ai.baseUrl!,
            apiKey: ai.apiKey ?? "",
            model: ai.model!,
            messages,
            tools,
            requestId,
          },
          onText,
        ).finally(() => {
          if (currentRequest === requestId) currentRequest = null;
        });
      };
      try {
        const outcome = await runAgent(history, host, send, {
          onTurn: () => {
            replyId = null;
          },
          onText: (delta) => {
            if (cancelled) return;
            if (replyId === null) {
              replyId = push({ kind: "assistant", text: delta });
            } else {
              const item = get().items.find((i) => i.id === replyId);
              if (item?.kind === "assistant")
                update(replyId, { text: item.text + delta });
            }
          },
          onStep: (label) => {
            replyId = null;
            push({ kind: "step", text: label });
          },
          isCancelled: () => cancelled,
        });
        if (outcome === "limit") {
          push({
            kind: "error",
            text: `Stopped after ${MAX_STEPS} steps. Ask again to continue.`,
          });
        } else if (outcome === "cancelled") {
          push({ kind: "step", text: "Stopped" });
          history.length = base;
        }
      } catch (e) {
        const message = String(e).replace(/^Error: /, "");
        if (cancelled || message === "cancelled") {
          push({ kind: "step", text: "Stopped" });
        } else {
          push({ kind: "error", text: `The AI request failed: ${message}` });
        }
        history.length = base;
      } finally {
        set({ running: false, history: [...history] });
      }
    },

    stop: () => {
      cancelled = true;
      if (currentRequest !== null) void aiCancel(currentRequest).catch(() => {});
      get().compileRequest?.resolve(false);
    },

    clear: () => {
      get().stop();
      notes = [];
      set({ items: [], history: [], context: EMPTY_CONTEXT });
    },

    setContext: (context) => set({ context: { ...get().context, ...context } }),

    applyChange: async (itemId) => {
      const item = get().items.find((i) => i.id === itemId);
      if (item?.kind !== "change" || item.status !== "pending") return;
      const { change } = item;
      const project = useProjectStore.getState().project;
      if (project === null) return;
      const fail = (note: string) => update(itemId, { note });
      try {
        const current = await currentText(change.path);
        if (change.creates) {
          if (current !== null) return fail(`${change.path} exists now. Ask again.`);
          await writeProjectFile(project.path, change.path, change.after);
          await useProjectStore.getState().refreshFiles();
        } else {
          if (current === null) return fail(`${change.path} is gone. Ask again.`);
          const planned = planReplacements(current, change.replacements);
          if ("error" in planned) {
            return fail("The file has changed since this was proposed. Ask again.");
          }
          if (change.path === useProjectStore.getState().activeFile) {
            applyFixEdits(planned.edits);
            const line = current.slice(0, planned.edits[0].from).split("\n").length;
            useEditorStore.getState().jumpTo(line);
          } else {
            await writeFileEdits(
              change.path,
              current,
              planned.edits,
              "input.assistant",
            );
          }
        }
      } catch (e) {
        return fail(`The change could not be applied: ${String(e)}`);
      }
      update(itemId, { status: "applied", note: null });
      notes.push(`The user applied change ${changeNumber(item)}.`);
    },

    discardChange: (itemId) => {
      const item = get().items.find((i) => i.id === itemId);
      if (item?.kind !== "change" || item.status !== "pending") return;
      update(itemId, { status: "discarded", note: null });
      notes.push(`The user discarded change ${changeNumber(item)}.`);
    },

    answerCompileRequest: (allowed) => get().compileRequest?.resolve(allowed),

    syncProject: (path) => {
      if (path === get().projectPath) return;
      get().stop();
      notes = [];
      set({
        projectPath: path,
        items: [],
        history: [],
        context: EMPTY_CONTEXT,
        running: false,
      });
    },
  };
});
