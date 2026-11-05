import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  CircleAlert,
  FileDiff,
  Loader2,
  MoreHorizontal,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { DiffRows } from "@/components/DiffRows";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { aiConfigured, providerOf } from "@/lib/ai-providers";
import { describeProseChange } from "@/lib/assistant/edits";
import { collapseContext, lineDiff } from "@/lib/diff";
import { useAssistantStore, type ChatItem } from "@/store/assistant";
import { useProjectStore } from "@/store/project";
import { useSettingsStore, type AssistantMode } from "@/store/settings";
import { cn } from "cn";

const MODES: { value: AssistantMode; label: string; hint: string }[] = [
  { value: "latex", label: "LaTeX", hint: "Changes to your text are flagged" },
  { value: "prose", label: "Prose", hint: "Help with your text" },
  { value: "both", label: "Both", hint: "LaTeX and your text" },
];

/** The composer's mode picker: what the assistant helps with. */
function ModeMenu({ mode }: { mode: AssistantMode }) {
  const current = MODES.find((m) => m.value === mode) ?? MODES[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="gap-1 px-1.5 text-2xs font-medium text-muted-foreground"
          title="What the assistant helps with"
        >
          {current.label}
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) =>
            void useSettingsStore.getState().setAssistantMode(value as AssistantMode)
          }
        >
          {MODES.map((m) => (
            <DropdownMenuRadioItem key={m.value} value={m.value}>
              <span className="flex flex-col">
                <span>{m.label}</span>
                <span className="text-2xs text-muted-foreground">{m.hint}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Inline `code` and **bold** in a line of the reply. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return (
        <code key={i} className="rounded bg-muted px-1 font-mono text-[0.95em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 3) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** The reply's text: fenced code blocks and plain paragraphs. */
function ReplyText({ text }: { text: string }) {
  const pieces = text.split(/```[^\n`]*\n?([\s\S]*?)(?:```|$)/g);
  return (
    <div className="space-y-2 text-xs leading-5">
      {pieces.map((piece, i) =>
        i % 2 === 1 ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-2xs leading-4"
          >
            {piece.replace(/\n$/, "")}
          </pre>
        ) : (
          piece.trim() !== "" && (
            <p key={i} className="whitespace-pre-wrap break-words">
              <Inline text={piece.trim()} />
            </p>
          )
        ),
      )}
    </div>
  );
}

function ChangeCard({ item }: { item: Extract<ChatItem, { kind: "change" }> }) {
  const applyChange = useAssistantStore((s) => s.applyChange);
  const discardChange = useAssistantStore((s) => s.discardChange);
  const { change, status, note } = item;
  const rows = collapseContext(lineDiff(change.before, change.after), 2);
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        status !== "pending" && "opacity-70",
      )}
    >
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5 text-xs">
        <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 flex-1 truncate font-mono text-2xs"
          title={change.path}
        >
          {change.path}
        </span>
        {change.creates && (
          <span className="shrink-0 text-2xs text-muted-foreground">New file</span>
        )}
        {status === "applied" && (
          <span className="shrink-0 text-2xs text-success">Applied</span>
        )}
        {status === "discarded" && (
          <span className="shrink-0 text-2xs text-muted-foreground">Discarded</span>
        )}
      </div>
      {change.explanation !== "" && (
        <p className="px-2 pt-1.5 text-xs">{change.explanation}</p>
      )}
      {change.prose !== null && (
        <p className="flex items-start gap-1.5 px-2 pt-1.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {describeProseChange(change.prose)}
        </p>
      )}
      <div className="m-2 max-h-64 overflow-auto rounded border">
        <DiffRows rows={rows} numbers={false} />
      </div>
      {note !== null && <p className="px-2 pb-1.5 text-xs text-destructive">{note}</p>}
      {status === "pending" && (
        <div className="flex justify-end gap-1.5 px-2 pb-2">
          <Button variant="outline" size="sm" onClick={() => discardChange(item.id)}>
            Discard
          </Button>
          <Button size="sm" onClick={() => void applyChange(item.id)}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ml-6 rounded-lg bg-muted px-2.5 py-1.5">
          {item.chips.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {item.chips.map((chip) => (
                <span
                  key={chip}
                  className="max-w-full truncate rounded bg-background px-1.5 text-2xs text-muted-foreground"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs leading-5 whitespace-pre-wrap break-words">
            {item.text}
          </p>
        </div>
      );
    case "assistant":
      return <ReplyText text={item.text} />;
    case "step":
      return <p className="text-2xs text-muted-foreground">{item.text}</p>;
    case "change":
      return <ChangeCard item={item} />;
    case "error":
      return (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {item.text}
        </p>
      );
  }
}

/**
 * The assistant: a chat about the open project that reads files,
 * checks compile issues and proposes changes as diffs the user applies.
 * The mode picker says whether it helps with LaTeX, the text or both.
 */
export function AssistantPanel() {
  const items = useAssistantStore((s) => s.items);
  const running = useAssistantStore((s) => s.running);
  const context = useAssistantStore((s) => s.context);
  const compileRequest = useAssistantStore((s) => s.compileRequest);
  const mode = useSettingsStore((s) => s.assistantMode);
  const ai = useSettingsStore((s) => s.ai);
  const configured = aiConfigured(ai);
  const provider = providerOf(ai);
  const projectPath = useProjectStore((s) => s.project?.path ?? null);
  const compileAllowed = useSettingsStore(
    (s) => projectPath !== null && s.assistantCompileProjects.includes(projectPath),
  );
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, compileRequest, running]);

  // A selection sent from the editor lands focused, ready to type.
  useEffect(() => {
    if (context.selection !== null) inputRef.current?.focus();
  }, [context.selection]);

  // The field grows with the draft, up to a few lines, then scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  function send() {
    const text = draft.trim();
    if (text === "" || running) return;
    setDraft("");
    void useAssistantStore.getState().ask(text);
  }

  const chips = [
    ...(context.selection !== null
      ? [
          {
            key: "selection",
            label:
              context.selection.fromLine === context.selection.toLine
                ? `${context.selection.path}, line ${context.selection.fromLine}`
                : `${context.selection.path}, lines ${context.selection.fromLine}-${context.selection.toLine}`,
            remove: () => useAssistantStore.getState().setContext({ selection: null }),
          },
        ]
      : []),
    ...(context.issue !== null
      ? [
          {
            key: "issue",
            label: context.issue.message,
            remove: () => useAssistantStore.getState().setContext({ issue: null }),
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        label="Assistant"
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground"
                  title="More"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={items.length === 0}
                  onSelect={() => useAssistantStore.getState().clear()}
                >
                  New conversation
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={compileAllowed}
                  disabled={projectPath === null}
                  onCheckedChange={(checked) => {
                    if (projectPath !== null) {
                      void useSettingsStore
                        .getState()
                        .setAssistantCompile(projectPath, checked === true);
                    }
                  }}
                >
                  Allow compiling
                </DropdownMenuCheckboxItem>
                <DropdownMenuItem
                  onSelect={() => useSettingsStore.getState().openSettings("ai")}
                >
                  Assistant settings…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {items.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkles className="size-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              {configured
                ? "Ask about errors, tables, floats, math or packages. The assistant reads your project and proposes changes you review."
                : "Set up an AI provider to use the assistant."}
            </p>
            {!configured && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => useSettingsStore.getState().openSettings("ai")}
              >
                Open AI settings
              </Button>
            )}
          </div>
        )}
        {items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
        {compileRequest !== null && (
          <div className="space-y-2 rounded-lg border p-2.5">
            <p className="text-xs">
              Allow the assistant to compile this project? It saves your open files
              first. You can turn this off in the panel menu.
            </p>
            <div className="flex justify-end gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => useAssistantStore.getState().answerCompileRequest(false)}
              >
                Don't allow
              </Button>
              <Button
                size="sm"
                onClick={() => useAssistantStore.getState().answerCompileRequest(true)}
              >
                Allow compiling
              </Button>
            </div>
          </div>
        )}
        {running && compileRequest === null && (
          <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Working…
          </p>
        )}
      </div>
      <div className="shrink-0 p-2 pt-1">
        <div
          className={cn(
            "rounded-xl border bg-card shadow-xs transition-[border-color,box-shadow]",
            "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
          )}
        >
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1 px-2 pt-2">
              {chips.map((chip) => (
                <span
                  key={chip.key}
                  className="flex max-w-full items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-1.5 text-2xs"
                >
                  <span className="truncate">{chip.label}</span>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Remove"
                    onClick={chip.remove}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            disabled={!configured}
            aria-label="Ask the assistant"
            placeholder={
              configured
                ? "How do I make this table fit the page?"
                : "Set up a provider to ask"
            }
            className="block max-h-40 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-xs leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="flex items-center gap-1 px-1.5 pb-1.5">
            <ModeMenu mode={mode} />
            <div className="min-w-0 flex-1" />
            <button
              type="button"
              className="min-w-0 truncate rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
              title={
                configured
                  ? `${ai?.model} on ${provider?.name}. Change in settings`
                  : "Open assistant settings"
              }
              onClick={() => useSettingsStore.getState().openSettings("ai")}
            >
              {configured ? ai?.model : "Set up a provider…"}
            </button>
            {running ? (
              <Button
                variant="outline"
                size="icon-xs"
                className="shrink-0 rounded-full"
                title="Stop"
                onClick={() => useAssistantStore.getState().stop()}
              >
                <Square className="size-3" />
              </Button>
            ) : (
              <Button
                size="icon-xs"
                className="shrink-0 rounded-full"
                title="Send (Enter)"
                disabled={!configured || draft.trim() === ""}
                onClick={send}
              >
                <ArrowUp className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
