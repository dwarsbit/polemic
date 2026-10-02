import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  BookPlus,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import { EntryEditorDialog } from "@/components/EntryEditorDialog";
import { SectionHeader } from "@/components/SectionHeader";
import { SourcesSearchDialog } from "@/components/SourcesSearchDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  detectCiteCommands,
  extractCitePositions,
  planCiteKeyRename,
} from "@/lib/cite-refs";
import { insertAtCursor } from "@/lib/editor-insert";
import { applyEditsInView } from "@/lib/editor-edits";
import { fuzzyMatch } from "@/lib/fuzzy";
import { invalidateGitState } from "@/lib/query-client";
import { showNativeContextMenu } from "@/lib/native-menu";
import {
  createProjectEntry,
  readProjectFile,
  writeProjectFile,
  type FileEntry,
} from "@/lib/tauri";
import { applyEdits, type ScannedFile, type SourceEdit } from "@/lib/label-index";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { useUiStore } from "@/store/ui";
import { cn } from "cn";

interface BibRow {
  entry: BibEntry;
  file: string;
  title: string;
  cited: number;
  incomplete: boolean;
}

interface UndefinedCitation {
  key: string;
  file: string;
  line: number;
  count: number;
}

interface DialogState {
  kind: "edit" | "new";
  file: string;
  key: string;
}

/** Project-relative paths of files with a given extension, depth first. */
function flattenPaths(entries: FileEntry[], extension: string): string[] {
  const out: string[] = [];
  const walk = (list: FileEntry[]) => {
    for (const entry of list) {
      if (entry.isDir) walk(entry.children);
      else if (entry.path.toLowerCase().endsWith(extension)) out.push(entry.path);
    }
  };
  walk(entries);
  return out;
}

function lineOf(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

/**
 * The bibliography manager: every entry in the project's .bib files,
 * grouped by type, with citation counts, jump-to-entry, package-aware
 * \cite insertion, a key-rename that refactors all .tex files, and an
 * entry editor with per-type validation. Undefined citations (cited
 * but not in any .bib) are listed at the bottom.
 */
export function BibliographyPanel() {
  const project = useProjectStore((s) => s.project);
  const files = useProjectStore((s) => s.files);
  const activeFile = useProjectStore((s) => s.activeFile);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);

  const [scanned, setScanned] = useState<ScannedFile[] | null>(null);
  const query = useUiStore((s) => s.bibliographySearch);
  const setQuery = useUiStore((s) => s.setBibliographySearch);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [rename, setRename] = useState<{ key: string; draft: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scanTick, setScanTick] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [sourcesDialogOpen, setSourcesDialogOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Disk reads are cached per file tree (null = unreadable); the
  // active file and open buffers always come from memory.
  const diskCache = useRef<{
    files: FileEntry[];
    texts: Map<string, string | null>;
  }>({
    files: [],
    texts: new Map(),
  });

  // Scan every .bib and .tex file (debounced). Both are needed: the
  // .bib texts feed the entry list and the entry editor's fresh reads;
  // the .tex texts feed citation counts and the rename planner.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!project) {
          if (!cancelled) setScanned(null);
          return;
        }
        const cache = diskCache.current;
        if (cache.files !== files) {
          cache.files = files;
          cache.texts.clear();
        }
        const paths = [
          ...flattenPaths(files, ".bib"),
          ...flattenPaths(files, ".tex"),
        ];
        const found: ScannedFile[] = [];
        for (const path of paths) {
          let text: string | null;
          if (path === activeFile) {
            text = content;
          } else if (buffers[path] !== undefined) {
            text = buffers[path];
          } else {
            let cached: string | null | undefined = cache.texts.get(path);
            if (cached === undefined) {
              try {
                cached = await readProjectFile(project.path, path);
              } catch {
                cached = null;
              }
              cache.texts.set(path, cached);
            }
            // "" is a valid (brand-new, empty) file; only null means unreadable.
            text = cached;
          }
          if (text !== null) found.push({ file: path, content: text });
        }
        if (!cancelled) setScanned(found);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, files, activeFile, buffers, content, scanTick]);

  const bibTexts = useMemo(
    () => scanned?.filter((file) => file.file.toLowerCase().endsWith(".bib")) ?? [],
    [scanned],
  );
  const texTexts = useMemo(
    () => scanned?.filter((file) => file.file.toLowerCase().endsWith(".tex")) ?? [],
    [scanned],
  );

  const citeCommands = useMemo(
    () => detectCiteCommands(texTexts.map((file) => file.content)),
    [texTexts],
  );

  const rows = useMemo<BibRow[]>(() => {
    const counts = new Map<string, number>();
    for (const { content } of texTexts) {
      for (const cite of extractCitePositions(content)) {
        counts.set(cite.key, (counts.get(cite.key) ?? 0) + 1);
      }
    }
    const q = query.trim();
    const out: BibRow[] = [];
    for (const { file, content } of bibTexts) {
      for (const entry of parseBibEntries(content).entries) {
        if (
          q.length > 0 &&
          fuzzyMatch(q, `${entry.key} ${entryTitle(entry)}`) === null
        ) {
          continue;
        }
        out.push({
          entry,
          file,
          title: entryTitle(entry),
          cited: counts.get(entry.key) ?? 0,
          incomplete: missingFields(entry).length > 0,
        });
      }
    }
    return out.sort((a, b) => a.entry.key.localeCompare(b.entry.key));
  }, [bibTexts, texTexts, query]);

  const groups = useMemo(() => {
    const map = new Map<string, BibRow[]>();
    for (const row of rows) {
      const list = map.get(row.entry.type);
      if (list === undefined) map.set(row.entry.type, [row]);
      else list.push(row);
    }
    return [...map.entries()];
  }, [rows]);

  const allKeys = useMemo(
    () => rows.map((row) => row.entry.key),
    [rows],
  );

  const undefinedCitations = useMemo<UndefinedCitation[]>(() => {
    const defined = new Set(allKeys);
    const q = query.trim();
    const byKey = new Map<string, UndefinedCitation>();
    for (const { file, content } of texTexts) {
      for (const cite of extractCitePositions(content)) {
        if (defined.has(cite.key)) continue;
        if (q.length > 0 && fuzzyMatch(q, cite.key) === null) continue;
        const existing = byKey.get(cite.key);
        if (existing === undefined) {
          byKey.set(cite.key, {
            key: cite.key,
            file,
            line: lineOf(content, cite.from),
            count: 1,
          });
        } else {
          existing.count += 1;
        }
      }
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [texTexts, allKeys, query]);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function goTo(file: string, line: number) {
    if (file === activeFile) {
      useEditorStore.getState().jumpTo(line);
      return;
    }
    void useProjectStore
      .getState()
      .openFile(file)
      .then(() => useEditorStore.getState().jumpTo(line));
  }

  /** A file's current content: live editor, buffer, or the scan. */
  function freshContent(file: string): string | null {
    const store = useProjectStore.getState();
    if (file === store.activeFile) return useEditorStore.getState().content;
    if (store.buffers[file] !== undefined) return store.buffers[file];
    return scanned?.find((f) => f.file === file)?.content ?? null;
  }

  /** Apply edits to a file the way the label manager does. */
  async function applyFileEdits(file: string, edits: SourceEdit[]) {
    const store = useProjectStore.getState();
    if (file === store.activeFile) {
      applyEditsInView(edits);
      return;
    }
    const base = freshContent(file);
    if (base === null) return;
    const next = applyEdits(base, edits);
    if (store.buffers[file] !== undefined) {
      store.markDirty(file, next);
    } else if (store.project) {
      await writeProjectFile(store.project.path, file, next);
      void invalidateGitState();
    }
    // Keep completion and lint metadata in sync for this file.
    store.refreshDocMeta(file, next);
  }

  function insertCitation(key: string, command: string) {
    insertAtCursor(`\\${command}{${key}}`);
  }

  function startRename(key: string) {
    setRenameError(null);
    setRename({ key, draft: key });
  }

  async function applyRename(oldKey: string, draft: string) {
    const newKey = draft.trim();
    if (newKey === oldKey) {
      setRename(null);
      setRenameError(null);
      return;
    }
    if (newKey.length === 0) {
      setRenameError("Enter a key.");
      return;
    }
    if (!/^[^,\s{}"]+$/.test(newKey)) {
      setRenameError("Keys cannot contain commas, spaces, braces, or quotes.");
      return;
    }
    if (allKeys.includes(newKey)) {
      setRenameError(`An entry with key "${newKey}" already exists.`);
      return;
    }
    setRename(null);
    setRenameError(null);
    // Rename cite occurrences across .tex files, and the entry key in
    // every .bib file that defines it — both against fresh content.
    const texPlan = planCiteKeyRename(texTexts, oldKey, newKey);
    for (const [file, edits] of texPlan) {
      await applyFileEdits(file, edits);
    }
    let bibRenames = 0;
    for (const { file: bibPath } of bibTexts) {
      const fresh = freshContent(bibPath);
      if (fresh === null) continue;
      const entry = parseBibEntries(fresh).entries.find((e) => e.key === oldKey);
      if (entry === undefined) continue;
      await applyFileEdits(bibPath, [
        { from: entry.keyFrom, to: entry.keyTo, insert: newKey },
      ]);
      bibRenames += 1;
    }
    if (bibRenames === 0 && texPlan.size === 0) {
      setRenameError(`No entry found for "${oldKey}".`);
      return;
    }
    const occurrences = [...texPlan.values()].reduce(
      (sum, edits) => sum + edits.length,
      0,
    );
    setMessage(
      `Renamed in ${texPlan.size} file${texPlan.size === 1 ? "" : "s"}, ` +
        `${occurrences} citation${occurrences === 1 ? "" : "s"}.`,
    );
    diskCache.current.files = [];
    setScanTick((tick) => tick + 1);
    window.setTimeout(() => setMessage(null), 5000);
  }

  async function saveEntry(draft: EntryDraft, file: string) {
    const store = useProjectStore.getState();
    const fresh = freshContent(file);
    if (fresh === null || !store.project) return;
    const edits = planEntryEdits(fresh, dialogKeyOf(), draft);
    if (edits === null || edits.length === 0) return;
    await applyFileEdits(file, edits);
    // A key change also renames citations across .tex files.
    if (dialog?.kind === "edit" && draft.key !== dialogKeyOf()) {
      const texPlan = planCiteKeyRename(texTexts, dialogKeyOf(), draft.key);
      for (const [texFile, texEdits] of texPlan) {
        await applyFileEdits(texFile, texEdits);
      }
    }
    setMessage(`Saved ${draft.key}.`);
    diskCache.current.files = [];
    setScanTick((tick) => tick + 1);
    window.setTimeout(() => setMessage(null), 5000);
  }

  async function appendEntry(draft: EntryDraft, file: string) {
    const store = useProjectStore.getState();
    if (!store.project) return;
    // A brand-new .bib may not be in the scan yet — read it fresh.
    let base = freshContent(file);
    if (base === null) {
      if (file === store.activeFile) {
        base = useEditorStore.getState().content;
      } else {
        try {
          base = await readProjectFile(store.project.path, file);
        } catch {
          base = "";
        }
      }
    }
    const text = formatEntry(draft.type, draft.key, draft.fields);
    const insert = (base.length > 0 && !base.endsWith("\n") ? "\n\n" : "") + text;
    const next = base + insert;
    if (file === store.activeFile) {
      applyEditsInView([{ from: base.length, to: base.length, insert }]);
    } else if (store.buffers[file] !== undefined) {
      store.markDirty(file, next);
    } else {
      await writeProjectFile(store.project.path, file, next);
      void invalidateGitState();
    }
    store.refreshDocMeta(file, next);
    setMessage(`Added ${draft.key} to ${file}.`);
    diskCache.current.files = [];
    setScanTick((tick) => tick + 1);
    window.setTimeout(() => setMessage(null), 5000);
  }

  /**
   * Create bibliography.bib in the project root (the empty state's
   * primary action) and go straight to the new-entry dialog for it.
   */
  async function createBib() {
    const store = useProjectStore.getState();
    setCreateError(null);
    if (!store.project) return;
    try {
      await createProjectEntry(store.project.path, "bibliography.bib", false);
      await store.refreshFiles();
      void invalidateGitState();
      // Rescan immediately with a cleared cache; the new file is
      // empty, which the scan must still pick up.
      diskCache.current.files = [];
      setScanTick((tick) => tick + 1);
      setDialog({ kind: "new", file: "bibliography.bib", key: "" });
    } catch (e) {
      setCreateError(String(e));
    }
  }

  /** The key of the entry the dialog is editing ("" for new). */
  function dialogKeyOf(): string {
    return dialog?.kind === "edit" ? dialog.key : "";
  }

  const dialogRow =
    dialog !== null && dialog.kind === "edit"
      ? rows.find((row) => row.entry.key === dialog.key) ?? null
      : null;

  function renderRow(row: BibRow) {
    const isRenaming = rename?.key === row.entry.key;
    return (
      <div
        key={`${row.file}:${row.entry.key}`}
        onKeyDown={(e) => {
          if (e.key === "F2" && rename === null) {
            e.preventDefault();
            startRename(row.entry.key);
          }
        }}
      >
        <div className="flex items-center rounded pl-6 hover:bg-accent">
          {isRenaming ? (
            <>
              <Input
                autoFocus
                className="h-6 min-w-0 flex-1 rounded-md px-1 font-mono text-xs"
                value={rename.draft}
                title="Enter to rename everywhere, Esc to cancel"
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) =>
                  setRename({ key: row.entry.key, draft: e.target.value })
                }
                onBlur={() => {
                  setRename(null);
                  setRenameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void applyRename(row.entry.key, rename.draft);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setRename(null);
                    setRenameError(null);
                  }
                }}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-1 size-5 shrink-0"
                title="Cancel"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setRename(null);
                  setRenameError(null);
                }}
              >
                <X className="size-3" />
              </Button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="min-w-0 flex-1 truncate py-1 text-left text-sm"
                title={row.title || row.entry.key}
                onClick={() => goTo(row.file, row.entry.line)}
                onDoubleClick={() => insertCitation(row.entry.key, citeCommands[0])}
                onContextMenu={(e) => {
                  e.preventDefault();
                  void showNativeContextMenu([
                    ...citeCommands.map((command) => ({
                      id: `insert-${command}`,
                      text: `Insert \\${command}{${row.entry.key}}`,
                      action: () => insertCitation(row.entry.key, command),
                    })),
                  ]);
                }}
              >
                <span className="font-mono text-xs">{row.entry.key}</span>
                {row.title.length > 0 && (
                  <span className="ml-2 text-muted-foreground">{row.title}</span>
                )}
              </button>
              {row.cited === 0 ? (
                <span className="mr-1 shrink-0 rounded-full border border-amber-400/60 px-1.5 py-0 text-[10px] leading-4 text-amber-600 dark:text-amber-400">
                  unused
                </span>
              ) : (
                <span
                  className="mr-1.5 shrink-0 text-[10px] tabular-nums text-muted-foreground"
                  title={`${row.cited} citation${row.cited === 1 ? "" : "s"}`}
                >
                  {row.cited}×
                </span>
              )}
              {row.incomplete && (
                <span
                  className="mr-1 shrink-0 text-[10px] text-amber-600 dark:text-amber-400"
                  title={`Missing fields: ${missingFields(row.entry).join(", ")}`}
                >
                  incomplete
                </span>
              )}
              <span className="max-w-20 shrink-0 truncate text-[10px] text-muted-foreground">
                {row.file}:{row.entry.line}
              </span>
              <button
                type="button"
                className="ml-1 flex size-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                title={`Rename ${row.entry.key} (F2)`}
                onClick={() => startRename(row.entry.key)}
              >
                <Pencil className="size-3" />
              </button>
            </>
          )}
        </div>
        {isRenaming && renameError !== null && (
          <p className="px-6 pt-0.5 text-[11px] text-destructive">{renameError}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        label="BIBLIOGRAPHY"
        collapsed={false}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Add from Sources…"
              onClick={() => setSourcesDialogOpen(true)}
            >
              <BookPlus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="New entry"
              disabled={bibTexts.length === 0}
              onClick={() => {
                const target = bibTexts[0]?.file;
                if (target === undefined) return;
                setDialog({ kind: "new", file: target, key: "" });
              }}
            >
              <Plus className="size-4" />
            </Button>
          </>
        }
      />
      <div className="flex shrink-0 items-center gap-1.5 px-2 pb-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 rounded-md pl-6 text-xs"
            placeholder="Search entries"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {scanned === null ? null : bibTexts.length === 0 ? (
          <div className="space-y-2.5 px-2 pt-2">
            <p className="text-xs text-muted-foreground">
              No bibliography yet. Create a .bib file for this project, or
              connect an external reference tool.
            </p>
            <Button
              size="sm"
              className="h-7 w-full justify-start px-2 text-xs"
              onClick={() => void createBib()}
            >
              <Plus className="size-3.5" />
              Create bibliography.bib
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start px-2 text-xs text-muted-foreground"
              disabled
              title="Coming soon: Zotero and other reference managers"
            >
              <BookOpen className="size-3.5" />
              Connect external reference tool
            </Button>
            {createError !== null && (
              <p className="text-xs text-destructive" title={createError}>
                {createError}
              </p>
            )}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            {query.trim().length > 0
              ? "No entries match your search."
              : "No entries in the project's .bib files."}
          </p>
        ) : (
          groups.map(([type, typeRows]) => {
            const key = `type:${type}`;
            const isCollapsed = collapsed.has(key);
            return (
              <div key={type} className="mb-1">
                <div className="flex items-center rounded hover:bg-accent">
                  {typeRows.length > 1 ? (
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
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate py-1 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => toggle(key)}
                  >
                    {type}
                  </button>
                  <span className="mr-1 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {typeRows.length}
                  </span>
                </div>
                {!isCollapsed && typeRows.map((row) => renderRow(row))}
              </div>
            );
          })
        )}

        {undefinedCitations.length > 0 && (
          <div className="mt-2 border-t pt-1">
            <div className="flex items-center rounded hover:bg-accent">
              <button
                type="button"
                title={collapsed.has("undefined") ? "Expand" : "Collapse"}
                className="flex size-5 shrink-0 items-center justify-center"
                onClick={() => toggle("undefined")}
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform",
                    !collapsed.has("undefined") && "rotate-90",
                  )}
                />
              </button>
              <span className="min-w-0 flex-1 truncate py-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                Undefined citations
              </span>
              <span className="mr-1 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {undefinedCitations.length}
              </span>
            </div>
            {!collapsed.has("undefined") &&
              undefinedCitations.map((cite) => (
                <div key={cite.key} className="flex items-center rounded pl-6 hover:bg-accent">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate py-1 text-left text-sm font-mono text-xs"
                    title={`${cite.count} citation${cite.count === 1 ? "" : "s"} without an entry`}
                    onClick={() => goTo(cite.file, cite.line)}
                  >
                    {cite.key}
                  </button>
                  <span className="mr-1.5 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {cite.count}×
                  </span>
                  <span className="max-w-24 shrink-0 truncate text-[10px] text-muted-foreground">
                    {cite.file}:{cite.line}
                  </span>
                </div>
              ))}
          </div>
        )}

        {message !== null && (
          <p className="mt-2 px-2 text-xs text-muted-foreground">{message}</p>
        )}
      </div>

      {dialog !== null && (
        <EntryEditorDialog          key={`${dialog.kind}:${dialog.file}:${dialog.key}`}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          title={
            dialog.kind === "new"
              ? "New BibTeX entry"
              : `Edit ${dialog.key}`
          }
          initial={dialogInitializer(dialog, dialogRow, allKeys)}
          existingKeys={allKeys}
          bibFiles={[...new Set([...bibTexts.map((file) => file.file), dialog.file])]}
          allowFile={dialog.kind === "new"}
          autoKey={dialog.kind === "new"}
          onSave={
            dialog.kind === "new"
              ? (draft, file) => void appendEntry(draft, file)
              : (draft, file) => void saveEntry(draft, file)
          }
        />
      )}

      <SourcesSearchDialog
        open={sourcesDialogOpen}
        onOpenChange={setSourcesDialogOpen}
      />
    </div>
  );
}

/** The dialog's initial draft: the entry's current state, or a new-entry skeleton. */
function dialogInitializer(
  dialog: DialogState,
  row: BibRow | null,
  allKeys: string[],
): EntryDraft & { file: string } {
  if (dialog.kind === "edit" && row !== null) {
    return {
      file: row.file,
      key: row.entry.key,
      type: row.entry.type,
      fields: row.entry.fields.map((field) => ({
        name: field.name,
        value: field.value,
      })),
    };
  }
  return {
    file: dialog.file,
    key: suggestKey("article", [], allKeys),
    type: "article",
    fields: [
      { name: "author", value: "" },
      { name: "title", value: "" },
      { name: "journal", value: "" },
      { name: "year", value: "" },
    ],
  };
}
