import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaseSensitive, ChevronDown, Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findMathRegion } from "@/lib/math-region";
import { readProjectFile, type FileEntry } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { useSearchStore, type SearchScope } from "@/store/search";
import { cn } from "cn";

interface Hit {
  file: string;
  /** 1-based line number. */
  line: number;
  /** The full line text. */
  text: string;
  /** Match ranges within `text`. */
  matches: [number, number][];
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
 * Project-wide search, docked in the bottom tool area. Literal search
 * across all .tex files; the active file and open buffers are searched
 * from memory, other files from disk (cached until the tree changes).
 * The scope filter classifies each match via the math-region detector.
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

  const [hits, setHits] = useState<Hit[] | null>(null);

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

          const needle = caseSensitive ? trimmed : trimmed.toLowerCase();
          // Line start offsets, to classify matches against math regions.
          let lineStart = 0;
          for (const [index, line] of text.split("\n").entries()) {
            const hay = caseSensitive ? line : line.toLowerCase();
            const matches: [number, number][] = [];
            let at = hay.indexOf(needle);
            while (at !== -1) {
              if (scope === "all") {
                matches.push([at, at + needle.length]);
              } else {
                const inMath = findMathRegion(text, lineStart + at) !== null;
                if ((scope === "math") === inMath) {
                  matches.push([at, at + needle.length]);
                }
              }
              at = hay.indexOf(needle, at + needle.length);
            }
            if (matches.length > 0) {
              found.push({ file: path, line: index + 1, text: line, matches });
            }
            lineStart += line.length + 1;
          }
        }
        if (!cancelled) setHits(found);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, files, activeFile, buffers, content, query, caseSensitive, scope]);

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

  const fileCount =
    hits === null ? 0 : new Set(hits.map((hit) => hit.file)).size;
  // An empty query shows the hint instead of stale results.
  const shownHits = query.trim().length === 0 ? null : hits;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-2">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          autoFocus
          className="h-7 min-w-0 flex-1 rounded-md border-none bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
          placeholder="Search project"
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
              title={s === "all" ? "All matches" : s === "math" ? "Matches in math mode" : "Matches outside math"}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] capitalize transition-colors",
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
                    className="mt-1 block w-full truncate rounded px-1 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => goTo(hit.file, 1)}
                  >
                    {hit.file}
                  </button>
                )}
                <button
                  type="button"
                  className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
                  onClick={() => goTo(hit.file, hit.line)}
                >
                  <span className="w-8 shrink-0 pt-0.5 text-right tabular-nums text-muted-foreground">
                    {hit.line}
                  </span>
                  <span className="min-w-0 flex-1 truncate whitespace-pre">
                    <Highlighted hit={hit} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The line with every match highlighted. */
function Highlighted({ hit }: { hit: Hit }): ReactNode {
  const parts: ReactNode[] = [];
  let pos = 0;
  hit.matches.forEach(([from, to], index) => {
    if (from > pos) parts.push(hit.text.slice(pos, from));
    parts.push(
      <mark
        key={index}
        className="rounded-sm bg-amber-200/80 text-foreground dark:bg-amber-400/30"
      >
        {hit.text.slice(from, to)}
      </mark>,
    );
    pos = to;
  });
  parts.push(hit.text.slice(pos));
  return <>{parts}</>;
}
