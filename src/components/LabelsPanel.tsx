import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Pencil, Search, X } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invalidateGitState } from "@/lib/query-client";
import { fuzzyMatch } from "@/lib/fuzzy";
import {
  applyEdits,
  buildLabelIndex,
  isValidLabelName,
  labelGroup,
  planLabelRename,
  type LabelEntry,
  type ScannedFile,
} from "@/lib/label-index";
import { applyEditsInView } from "@/lib/editor-edits";
import { readProjectFile, writeProjectFile, type FileEntry } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { cn } from "cn";

interface LabelRowData {
  name: string;
  def: LabelEntry;
  defCount: number;
  refs: number;
}

interface UndefinedRefData {
  name: string;
  file: string;
  line: number;
  count: number;
}

/** Project-relative paths of all .tex files in the tree, depth first. */
function flattenTexPaths(entries: FileEntry[], out: string[] = []): string[] {
  for (const entry of entries) {
    if (entry.isDir) {
      flattenTexPaths(entry.children, out);
    } else if (entry.path.toLowerCase().endsWith(".tex")) {
      out.push(entry.path);
    }
  }
  return out;
}

/**
 * The label manager: every \label in the project with its reference
 * count, grouped by prefix (the part before the first colon). Click a
 * label to jump to its definition; the pencil (or F2) renames it
 * everywhere — the active document as one undoable edit, unsaved
 * buffers via their buffer, other files straight to disk. References
 * without a matching label are listed at the bottom.
 */
export function LabelsPanel() {
  const project = useProjectStore((s) => s.project);
  const files = useProjectStore((s) => s.files);
  const activeFile = useProjectStore((s) => s.activeFile);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);

  const [scanned, setScanned] = useState<ScannedFile[] | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [rename, setRename] = useState<{ name: string; draft: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scanTick, setScanTick] = useState(0);

  // Disk reads are cached per file tree; the active file and open
  // buffers always come from memory.
  const diskCache = useRef<{ files: FileEntry[]; texts: Map<string, string> }>({
    files: [],
    texts: new Map(),
  });

  // Scan every .tex file (debounced): labels, refs, and the texts
  // themselves (the rename planner works on the same snapshot).
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
        const found: ScannedFile[] = [];
        for (const path of flattenTexPaths(files)) {
          let text: string | null;
          if (path === activeFile) {
            text = content;
          } else if (buffers[path] !== undefined) {
            text = buffers[path];
          } else {
            let cached: string | undefined = cache.texts.get(path);
            if (cached === undefined) {
              try {
                cached = await readProjectFile(project.path, path);
              } catch {
                cached = "";
              }
              cache.texts.set(path, cached);
            }
            text = cached === "" ? null : cached;
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

  const index = useMemo(
    () => (scanned === null ? null : buildLabelIndex(scanned)),
    [scanned],
  );

  const labelNames = useMemo(
    () => new Set(index?.labels.map((label) => label.name) ?? []),
    [index],
  );

  const rows = useMemo<LabelRowData[]>(() => {
    if (index === null) return [];
    const defsByName = new Map<string, LabelEntry[]>();
    for (const label of index.labels) {
      const list = defsByName.get(label.name);
      if (list === undefined) defsByName.set(label.name, [label]);
      else list.push(label);
    }
    const refCounts = new Map<string, number>();
    for (const ref of index.refs) {
      refCounts.set(ref.name, (refCounts.get(ref.name) ?? 0) + 1);
    }
    const q = query.trim();
    return [...defsByName.entries()]
      .map(([name, defs]) => ({
        name,
        def: defs[0],
        defCount: defs.length,
        refs: refCounts.get(name) ?? 0,
      }))
      .filter((row) => q.length === 0 || fuzzyMatch(q, row.name) !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [index, query]);

  // Rows grouped by the label prefix (before the first colon).
  const groups = useMemo(() => {
    const map = new Map<string, LabelRowData[]>();
    for (const row of rows) {
      const key = labelGroup(row.name);
      const list = map.get(key);
      if (list === undefined) map.set(key, [row]);
      else list.push(row);
    }
    return [...map.entries()];
  }, [rows]);

  const undefinedRefs = useMemo<UndefinedRefData[]>(() => {
    if (index === null) return [];
    const q = query.trim();
    const byName = new Map<string, UndefinedRefData>();
    for (const ref of index.refs) {
      if (labelNames.has(ref.name)) continue;
      if (q.length > 0 && fuzzyMatch(q, ref.name) === null) continue;
      const entry = byName.get(ref.name);
      if (entry === undefined) {
        byName.set(ref.name, { name: ref.name, file: ref.file, line: ref.line, count: 1 });
      } else {
        entry.count += 1;
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [index, labelNames, query]);

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

  function startRename(name: string) {
    setRenameError(null);
    setRename({ name, draft: name });
  }

  async function applyRename(oldName: string, draft: string) {
    const newName = draft.trim();
    const store = useProjectStore.getState();
    if (newName === oldName) {
      setRename(null);
      setRenameError(null);
      return;
    }
    if (newName.length === 0) {
      setRenameError("Enter a name.");
      return;
    }
    if (!isValidLabelName(newName)) {
      setRenameError("Not a valid label name.");
      return;
    }
    if (labelNames.has(newName)) {
      setRenameError(`A label "${newName}" already exists.`);
      return;
    }
    if (scanned === null) return;
    // Plan against the freshest content: the live editor for the
    // active file, buffers for dirty files, the scan for the rest.
    const live = useEditorStore.getState().content;
    const fresh = scanned.map((file) =>
      file.file === activeFile
        ? { ...file, content: live }
        : store.buffers[file.file] !== undefined
          ? { ...file, content: store.buffers[file.file] }
          : file,
    );
    const plan = planLabelRename(fresh, oldName, newName);
    if (plan.size === 0) {
      setRename(null);
      return;
    }
    let occurrences = 0;
    for (const [path, edits] of plan) {
      occurrences += edits.length;
      if (path === store.activeFile) {
        applyEditsInView(edits);
        continue;
      }
      const base = fresh.find((file) => file.file === path)?.content ?? "";
      const next = applyEdits(base, edits);
      if (store.buffers[path] !== undefined) {
        store.markDirty(path, next);
      } else if (store.project) {
        await writeProjectFile(store.project.path, path, next);
        void invalidateGitState();
      }
    }
    setRename(null);
    setRenameError(null);
    setMessage(
      `Renamed in ${plan.size} file${plan.size === 1 ? "" : "s"}, ` +
        `${occurrences} occurrence${occurrences === 1 ? "" : "s"}.`,
    );
    diskCache.current.files = [];
    setScanTick((tick) => tick + 1);
    window.setTimeout(() => setMessage(null), 5000);
  }

  function renderRow(row: LabelRowData) {
    const isRenaming = rename?.name === row.name;
    const group = labelGroup(row.name);
    const locations = `${row.def.file}:${row.def.line}` + (row.defCount > 1 ? ` (+${row.defCount - 1} more)` : "");
    return (
      <div
        key={row.name}
        onKeyDown={(e) => {
          if (e.key === "F2" && rename === null) {
            e.preventDefault();
            startRename(row.name);
          }
        }}
      >
        <div className="flex items-center rounded pl-6 hover:bg-accent">
          {isRenaming ? (
            <>
              <Input
                autoFocus
                className="h-6 min-w-0 flex-1 rounded-md px-1 text-xs"
                value={rename.draft}
                title="Enter to rename everywhere, Esc to cancel"
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setRename({ name: row.name, draft: e.target.value })}
                onBlur={() => {
                  setRename(null);
                  setRenameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void applyRename(row.name, rename.draft);
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
                title={locations}
                onClick={() => goTo(row.def.file, row.def.line)}
              >
                {group === row.name ? row.name : row.name.slice(group.length + 1)}
              </button>
              {row.refs === 0 ? (
                <span className="mr-1 shrink-0 rounded-full border border-amber-400/60 px-1.5 py-0 text-[10px] leading-4 text-amber-600 dark:text-amber-400">
                  unused
                </span>
              ) : (
                <span
                  className="mr-1.5 shrink-0 text-[10px] tabular-nums text-muted-foreground"
                  title={`${row.refs} reference${row.refs === 1 ? "" : "s"}`}
                >
                  {row.refs}×
                </span>
              )}
              <span className="max-w-24 shrink-0 truncate text-[10px] text-muted-foreground">
                {row.def.file}:{row.def.line}
              </span>
              <button
                type="button"
                className="ml-1 flex size-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                title={`Rename ${row.name} (F2)`}
                onClick={() => startRename(row.name)}
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
      <SectionHeader label="LABELS" collapsed={false} />
      <div className="flex shrink-0 items-center gap-1.5 px-2 pb-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 rounded-md pl-6 text-xs"
            placeholder="Search labels"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {scanned === null ? null : rows.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            {query.trim().length > 0
              ? "No labels match your search."
              : "No labels in this project yet."}
          </p>
        ) : (
          groups.map(([group, groupRows]) => {
            const key = `group:${group}`;
            const isCollapsed = collapsed.has(key);
            return (
              <div key={group} className="mb-1">
                <div className="flex items-center rounded hover:bg-accent">
                  {groupRows.length > 1 ? (
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
                    {group}
                  </span>
                  <span className="mr-1 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {groupRows.length}
                  </span>
                </div>
                {!isCollapsed && groupRows.map((row) => renderRow(row))}
              </div>
            );
          })
        )}

        {undefinedRefs.length > 0 && (
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
                Undefined references
              </span>
              <span className="mr-1 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {undefinedRefs.length}
              </span>
            </div>
            {!collapsed.has("undefined") &&
              undefinedRefs.map((ref) => (
                <div key={ref.name} className="flex items-center rounded pl-6 hover:bg-accent">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate py-1 text-left text-sm"
                    title={`${ref.count} reference${ref.count === 1 ? "" : "s"} without a label`}
                    onClick={() => goTo(ref.file, ref.line)}
                  >
                    {ref.name}
                  </button>
                  <span className="mr-1.5 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {ref.count}×
                  </span>
                  <span className="max-w-24 shrink-0 truncate text-[10px] text-muted-foreground">
                    {ref.file}:{ref.line}
                  </span>
                </div>
              ))}
          </div>
        )}

        {message !== null && (
          <p className="mt-2 px-2 text-xs text-muted-foreground">{message}</p>
        )}
      </div>
    </div>
  );
}
