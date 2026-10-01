import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { BibEditor } from "@/components/BibEditor";
import { EntryEditorDialog } from "@/components/EntryEditorDialog";
import { Button } from "@/components/ui/button";
import {
  entryTitle,
  formatEntry,
  missingFields,
  parseBibEntries,
  planEntryEdits,
  suggestKey,
  type BibEntry,
  type EntryDraft,
} from "@/lib/bib-entries";
import { applyEditsInView } from "@/lib/editor-edits";
import type { SourceEdit } from "@/lib/label-index";
import { fuzzyMatch } from "@/lib/fuzzy";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { useUiStore } from "@/store/ui";
import { cn } from "cn";

interface DialogState {
  kind: "edit" | "new";
  key: string;
}

/**
 * The Visual face of a .bib file: the friendly card over the parsed
 * entries — search, editing, adding, deleting. The Visual/Code
 * toggle lives in the window header; both faces edit the same
 * document (the active file) through the live CodeMirror view, so
 * every change is one undo step and flows through the normal save
 * pipeline.
 */
export function BibFileEditor() {
  const content = useEditorStore((s) => s.content);
  const activeFile = useProjectStore((s) => s.activeFile);
  const lastSavedContent = useProjectStore((s) => s.lastSavedContent);
  const mode = useUiStore((s) => s.bibEditorMode);
  const setMode = useUiStore((s) => s.setBibEditorMode);
  const jumpTarget = useEditorStore((s) => s.jumpTarget);

  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // A jump request (e.g. from the Bibliography panel) needs the text.
  useEffect(() => {
    if (jumpTarget !== null) setMode("code");
  }, [jumpTarget, setMode]);

  const parsed = useMemo(() => parseBibEntries(content), [content]);
  const allKeys = useMemo(
    () => parsed.entries.map((entry) => entry.key),
    [parsed],
  );

  const rows = useMemo(() => {
    const q = query.trim();
    if (q.length === 0) return parsed.entries;
    return parsed.entries.filter(
      (entry) => fuzzyMatch(q, `${entry.key} ${entryTitle(entry)}`) !== null,
    );
  }, [parsed, query]);

  const groups = useMemo(() => {
    const map = new Map<string, BibEntry[]>();
    for (const entry of rows) {
      const list = map.get(entry.type);
      if (list === undefined) map.set(entry.type, [entry]);
      else list.push(entry);
    }
    return [...map.entries()];
  }, [rows]);

  const dirty = activeFile !== null && content !== lastSavedContent;

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 5000);
  }

  /** Apply edits to the live document (one undo step). */
  function apply(edits: SourceEdit[]): boolean {
    if (edits.length === 0) return true;
    return applyEditsInView(edits);
  }

  async function saveNow() {
    const saved = await useProjectStore.getState().saveActiveFile();
    flash(saved ? "Saved." : "Nothing to save.");
  }

  function saveEntry(draft: EntryDraft) {
    if (dialog?.kind !== "edit") return;
    const edits = planEntryEdits(useEditorStore.getState().content, dialog.key, draft);
    if (edits === null || !apply(edits)) return;
    flash(`Saved ${draft.key}.`);
  }

  function appendEntry(draft: EntryDraft) {
    const text = useEditorStore.getState().content;
    const sep = text.length > 0 && !text.endsWith("\n") ? "\n\n" : "";
    if (!apply([{ from: text.length, to: text.length, insert: sep + formatEntry(draft.type, draft.key, draft.fields) }])) {
      return;
    }
    flash(`Added ${draft.key}.`);
  }

  function deleteEntry(key: string) {
    const text = useEditorStore.getState().content;
    const entry = parsed.entries.find((e) => e.key === key);
    if (entry === undefined) return;
    // Removing the span can leave doubled separators; collapse them.
    const joined = text.slice(0, entry.from) + text.slice(entry.to);
    const cleaned = joined.replace(/\n{3,}/g, "\n\n");
    if (!apply([{ from: 0, to: text.length, insert: cleaned }])) return;
    setPendingDelete(null);
    flash(`Deleted ${key}.`);
  }

  function jumpToEntry(entry: BibEntry) {
    setMode("code");
    useEditorStore.getState().jumpTo(entry.line);
  }

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const dialogEntry =
    dialog !== null && dialog.kind === "edit"
      ? parsed.entries.find((entry) => entry.key === dialog.key) ?? null
      : null;

  const fileLabel = activeFile !== null ? activeFile.split("/").pop() ?? "" : "";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        {mode === "visual" && (
          <Button variant="outline" size="sm" title="New entry" onClick={() => setDialog({ kind: "new", key: "" })}>
            <Plus />
            Entry
          </Button>
        )}
        <div className="min-w-0 flex-1" />
        {dirty && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            Unsaved changes
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={!dirty}
          title="Save (Cmd/Ctrl + S)"
          onClick={() => void saveNow()}
        >
          Save
        </Button>
      </div>

      {mode === "visual" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
            <div className="relative w-56">
              <Search className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
              <input
                className="h-7 w-full rounded-md border bg-transparent pl-6 pr-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={`Search ${fileLabel}`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {parsed.entries.length === 1
                ? "1 entry"
                : `${parsed.entries.length} entries`}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
            {parsed.entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No references yet. Add one with the Entry button.
              </p>
            ) : rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No entries match your search.
              </p>
            ) : (
              groups.map(([type, typeEntries]) => {
                const key = `type:${type}`;
                const isCollapsed = collapsed.has(key);
                return (
                  <div key={type} className="mb-1 pt-1">
                    <div className="flex items-center rounded hover:bg-accent">
                      {typeEntries.length > 1 ? (
                        <button
                          type="button"
                          title={isCollapsed ? "Expand" : "Collapse"}
                          className="flex size-5 shrink-0 items-center justify-center"
                          onClick={() => toggle(key)}
                        >
                          <ChevronRight
                            className={cn(
                              "size-3 transition-transform",
                              !isCollapsed && "rotate-90",
                            )}
                          />
                        </button>
                      ) : (
                        <span className="size-5 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate py-1 text-sm font-medium text-muted-foreground">
                        {type}
                      </span>
                      <span className="mr-1 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {typeEntries.length}
                      </span>
                    </div>
                    {!isCollapsed &&
                      typeEntries.map((entry) => {
                        const missing = missingFields(entry);
                        const confirming = pendingDelete === entry.key;
                        return (
                          <div
                            key={entry.key}
                            className="flex items-center gap-2 rounded pl-6 hover:bg-accent"
                          >
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate py-1 text-left text-sm"
                              title="Show in the raw text"
                              onClick={() => jumpToEntry(entry)}
                            >
                              <span className="font-mono text-xs">{entry.key}</span>
                              {entryTitle(entry).length > 0 && (
                                <span className="ml-2 text-muted-foreground">
                                  {entryTitle(entry)}
                                </span>
                              )}
                            </button>
                            {missing.length > 0 && (
                              <span
                                className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400"
                                title={`Missing fields: ${missing.join(", ")}`}
                              >
                                incomplete
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="size-5 shrink-0"
                              title="Edit entry"
                              onClick={() => setDialog({ kind: "edit", key: entry.key })}
                            >
                              <Pencil className="size-3" />
                            </Button>
                            {confirming ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 shrink-0 px-1 text-[10px] text-destructive"
                                title="Delete this entry"
                                onClick={() => deleteEntry(entry.key)}
                              >
                                Delete?
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="size-5 shrink-0"
                                title="Delete entry"
                                onClick={() => setPendingDelete(entry.key)}
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })
            )}
            {message !== null && (
              <p className="mt-2 text-xs text-muted-foreground">{message}</p>
            )}
          </div>
        </div>
      )}

      {/* The CodeMirror view stays mounted in both modes: References
          edits flow through it as one undo step. */}
      <div className={cn("min-h-0 flex-1", mode === "visual" && "hidden")}>
        <BibEditor visible={mode === "code"} />
      </div>

      {dialog !== null && (
        <EntryEditorDialog
          key={`${dialog.kind}:${dialog.key}`}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          title={dialog.kind === "new" ? "New entry" : `Edit ${dialog.key}`}
          initial={
            dialog.kind === "edit" && dialogEntry !== null
              ? {
                  file: "",
                  key: dialogEntry.key,
                  type: dialogEntry.type,
                  fields: dialogEntry.fields.map((field) => ({
                    name: field.name,
                    value: field.value,
                  })),
                }
              : {
                  file: "",
                  key: suggestKey("article", [], allKeys),
                  type: "article",
                  fields: [
                    { name: "author", value: "" },
                    { name: "title", value: "" },
                    { name: "journal", value: "" },
                    { name: "year", value: "" },
                  ],
                }
          }
          existingKeys={allKeys}
          bibFiles={[activeFile ?? ""]}
          allowFile={false}
          autoKey={dialog.kind === "new"}
          onSave={
            dialog.kind === "new"
              ? (draft) => appendEntry(draft)
              : (draft) => saveEntry(draft)
          }
        />
      )}
    </div>
  );
}
