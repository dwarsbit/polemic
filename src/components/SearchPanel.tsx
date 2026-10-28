import { useEffect, useRef, useState, type ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  CaseSensitive,
  ChevronDown,
  Replace,
  Search as SearchIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyEditsInView } from "@/lib/editor-edits";
import { applyEdits } from "@/lib/label-index";
import { replaceEdits, searchText } from "@/lib/project-search";
import { invalidateGitState } from "@/lib/query-client";
import { readProjectFile, writeProjectFile, type FileEntry } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { useSearchStore, type SearchScope } from "@/store/search";
import { cn } from "cn";
import { formatShortcut } from "@/lib/platform";

interface Hit {
  file: string;
  /** 1-based line number. */
  line: number;
  /** The full line text. */
  text: string;
  /** Match ranges within `text`. */
  matches: [number, number][];
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "es"}`;
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

const SCOPES: SearchScope[] = ["all", "math", "text"];

/**
 * Project-wide search and replace, docked in the bottom tool area.
 * Literal search across all .tex files; the active file and open
 * buffers are searched from memory, other files from disk (cached
 * until the tree changes). The scope filter classifies each match via
 * the math-region detector, and replace honors it. Replacing edits the
 * active file as one undo step, dirty buffers in memory, and writes
 * the other files to disk.
 */
export function SearchPanel({ onToggle }: { onToggle: () => void }) {
  const project = useProjectStore((s) => s.project);
  const files = useProjectStore((s) => s.files);
  const activeFile = useProjectStore((s) => s.activeFile);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const caseSensitive = useSearchStore((s) => s.caseSensitive);
  const toggleCase = useSearchStore((s) => s.toggleCase);
  const scope = useSearchStore((s) => s.scope);
  const setScope = useSearchStore((s) => s.setScope);
  const replaceOpen = useSearchStore((s) => s.replaceOpen);
  const toggleReplace = useSearchStore((s) => s.toggleReplace);
  const replacement = useSearchStore((s) => s.replacement);
  const setReplacement = useSearchStore((s) => s.setReplacement);

  const [hits, setHits] = useState<Hit[] | null>(null);
  // Bumped after a replace wrote files on disk, to search them again.
  const [diskTick, setDiskTick] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  // Disk reads are cached per file tree; content of the active file and
  // open buffers always comes from memory.
  const diskCache = useRef<{ files: FileEntry[]; texts: Map<string, string> }>({
    files: [],
    texts: new Map(),
  });

  useEffect(() => {
    const trimmed = query.trim();
    if (!project || trimmed.length === 0) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const cache = diskCache.current;
        if (cache.files !== files) {
          cache.files = files;
          cache.texts.clear();
        }
        const found: Hit[] = [];
        for (const path of flattenTexPaths(files)) {
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
              cache.texts.set(path, cached ?? "");
            }
            text = cached === "" || cached === null ? null : cached;
          }
          if (text === null) continue;

          for (const hit of searchText(text, trimmed, { caseSensitive, scope })) {
            found.push({
              file: path,
              line: hit.line,
              text: hit.text,
              matches: hit.matches,
            });
          }
        }
        if (!cancelled) setHits(found);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    project,
    files,
    activeFile,
    buffers,
    content,
    query,
    caseSensitive,
    scope,
    diskTick,
  ]);

  /** The freshest text of a file: live editor, buffer, then disk. */
  async function currentText(path: string): Promise<string | null> {
    const store = useProjectStore.getState();
    if (path === store.activeFile) return useEditorStore.getState().content;
    if (store.buffers[path] !== undefined) return store.buffers[path];
    if (!store.project) return null;
    return readProjectFile(store.project.path, path).catch(() => null);
  }

  /** Replace in every hit's file, or in one line when given. */
  async function replace(target?: { file: string; line: number }) {
    const trimmed = query.trim();
    if (trimmed.length === 0 || hits === null || hits.length === 0) return;
    const targetFiles = target
      ? [target.file]
      : [...new Set(hits.map((hit) => hit.file))];
    if (target === undefined) {
      const total = hits.reduce((sum, hit) => sum + hit.matches.length, 0);
      const ok = await ask(
        `Replace ${pluralize(total, "match")} in ${targetFiles.length} ` +
          `file${targetFiles.length === 1 ? "" : "s"} with “${replacement}”? ` +
          "Files that are not open are saved right away.",
        { title: "Replace all", kind: "warning" },
      );
      if (!ok) return;
    }
    const options = { caseSensitive, scope };
    let replaced = 0;
    let wroteDisk = false;
    for (const path of targetFiles) {
      const text = await currentText(path);
      if (text === null) continue;
      const edits = replaceEdits(text, trimmed, replacement, options, target?.line);
      if (edits.length === 0) continue;
      const store = useProjectStore.getState();
      if (path === store.activeFile) {
        if (!applyEditsInView(edits, "input.replace")) continue;
      } else {
        const next = applyEdits(text, edits);
        if (store.buffers[path] !== undefined) {
          store.markDirty(path, next);
        } else if (store.project) {
          await writeProjectFile(store.project.path, path, next);
          diskCache.current.texts.set(path, next);
          wroteDisk = true;
        }
      }
      replaced += edits.length;
    }
    if (wroteDisk) {
      void invalidateGitState();
      setDiskTick((tick) => tick + 1);
    }
    if (target === undefined) {
      setMessage(`Replaced ${pluralize(replaced, "match")}.`);
      window.setTimeout(() => setMessage(null), 4000);
    }
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

  const fileCount = hits === null ? 0 : new Set(hits.map((hit) => hit.file)).size;
  // An empty query shows the hint instead of stale results.
  const shownHits = query.trim().length === 0 ? null : hits;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-2">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          autoFocus
          className="h-7 min-w-0 flex-1 rounded-md border-none bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
          placeholder="Search in project"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
        {shownHits !== null && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {shownHits.length === 1
              ? "1 match"
              : `${shownHits.length} matches in ${fileCount} files`}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-6 shrink-0", !replaceOpen && "text-muted-foreground")}
          title="Replace"
          aria-pressed={replaceOpen}
          onClick={toggleReplace}
        >
          <Replace className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-6 shrink-0", !caseSensitive && "text-muted-foreground")}
          title="Match case"
          onClick={toggleCase}
        >
          <CaseSensitive className="size-3.5" />
        </Button>
        <div className="flex shrink-0 items-center rounded-md border p-0.5">
          {SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              title={
                s === "all"
                  ? "All matches"
                  : s === "math"
                    ? "Matches in math mode"
                    : "Matches outside math"
              }
              className={cn(
                "rounded px-1.5 py-0.5 text-2xs capitalize transition-colors",
                scope === s
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setScope(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          title="Hide panel"
          onClick={onToggle}
        >
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
      {replaceOpen && (
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-2">
          <Replace className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            className="h-7 min-w-0 flex-1 rounded-md border-none bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
            placeholder="Replace with"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void replace();
            }}
          />
          {message !== null && (
            <span className="shrink-0 text-xs text-muted-foreground">{message}</span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={shownHits === null || shownHits.length === 0}
            title={`Replace all (${formatShortcut("Mod+Enter")})`}
            onClick={() => void replace()}
          >
            Replace all
          </Button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {shownHits === null ? (
          <p className="px-1 py-1 text-xs text-muted-foreground">
            Type to search across all .tex files in the project.
          </p>
        ) : shownHits.length === 0 ? (
          <p className="px-1 py-1 text-xs text-muted-foreground">No matches.</p>
        ) : (
          <ul className="space-y-0.5">
            {shownHits.map((hit, index) => (
              <li key={`${hit.file}-${hit.line}`}>
                {(index === 0 || shownHits[index - 1].file !== hit.file) && (
                  <button
                    type="button"
                    className="mt-1 block w-full truncate rounded px-1 py-0.5 text-left text-2xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => goTo(hit.file, 1)}
                  >
                    {hit.file}
                  </button>
                )}
                <div className="group relative">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
                    onClick={() => goTo(hit.file, hit.line)}
                  >
                    <span className="w-8 shrink-0 pt-0.5 text-right tabular-nums text-muted-foreground">
                      {hit.line}
                    </span>
                    <span className="min-w-0 flex-1 truncate whitespace-pre">
                      <Highlighted
                        hit={hit}
                        replacement={replaceOpen ? replacement : null}
                      />
                    </span>
                  </button>
                  {replaceOpen && (
                    <button
                      type="button"
                      className="absolute right-1 top-0.5 hidden rounded border bg-card px-1.5 text-2xs text-muted-foreground hover:text-foreground group-hover:block"
                      title="Replace the matches on this line"
                      onClick={() => void replace({ file: hit.file, line: hit.line })}
                    >
                      Replace
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The line with every match highlighted; with a replacement, the
 *  match shows struck through next to its replacement. */
function Highlighted({
  hit,
  replacement,
}: {
  hit: Hit;
  replacement: string | null;
}): ReactNode {
  const parts: ReactNode[] = [];
  let pos = 0;
  hit.matches.forEach(([from, to], index) => {
    if (from > pos) parts.push(hit.text.slice(pos, from));
    parts.push(
      <mark
        key={index}
        className={cn(
          "rounded-sm bg-amber-200/80 text-foreground dark:bg-amber-400/30",
          replacement !== null && "line-through",
        )}
      >
        {hit.text.slice(from, to)}
      </mark>,
    );
    if (replacement !== null) {
      parts.push(
        <ins
          key={`r${index}`}
          className="rounded-sm bg-green-200/70 text-foreground no-underline dark:bg-green-500/25"
        >
          {replacement}
        </ins>,
      );
    }
    pos = to;
  });
  parts.push(hit.text.slice(pos));
  return <>{parts}</>;
}
