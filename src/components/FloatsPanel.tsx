import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { AssetThumb } from "@/components/AssetThumb";
import { SectionHeader } from "@/components/SectionHeader";
import { Input } from "@/components/ui/input";
import { useDocumentOrder } from "@/hooks/useDocumentOrder";
import { assetKind, collectAssetPaths } from "@/lib/assets";
import { parseFloats, type FloatInfo, type FloatKind } from "@/lib/floats";
import { fuzzyMatch } from "@/lib/fuzzy";
import { extractGraphicsPaths, resolveGraphicsRef } from "@/lib/graphics-refs";
import { readProjectFile } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { cn } from "cn";

interface FloatRow extends FloatInfo {
  file: string;
  /** 1-based number within its kind, in document order. */
  number: number;
}

const GROUPS: { kind: FloatKind; label: string }[] = [
  { kind: "figure", label: "Figures" },
  { kind: "table", label: "Tables" },
  { kind: "listing", label: "Listings" },
  { kind: "algorithm", label: "Algorithms" },
];

/**
 * The floats navigator: every figure, table, listing, and algorithm in
 * document order, grouped by kind, with a thumbnail for figures and
 * badges for a missing caption or label. Click jumps to the source.
 */
export function FloatsPanel() {
  const project = useProjectStore((s) => s.project);
  const activeFile = useProjectStore((s) => s.activeFile);
  const buffers = useProjectStore((s) => s.buffers);
  const files = useProjectStore((s) => s.files);
  const graphicsPathsByFile = useProjectStore((s) => s.graphicsPathsByFile);
  const content = useEditorStore((s) => s.content);
  const order = useDocumentOrder();
  const [floats, setFloats] = useState<FloatRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<FloatKind>>(new Set());

  // Parse floats per ordered file (debounced): the active file from
  // the live editor content, other files from buffers or disk.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!project || order === null) {
          setFloats(null);
          return;
        }
        const rows: FloatRow[] = [];
        const counts = new Map<FloatKind, number>();
        for (const path of order) {
          let text: string | null;
          if (path === activeFile) {
            text = content;
          } else if (buffers[path] !== undefined) {
            text = buffers[path];
          } else {
            try {
              text = await readProjectFile(project.path, path);
            } catch {
              text = null;
            }
          }
          if (text === null) continue;
          for (const float of parseFloats(text)) {
            const number = (counts.get(float.kind) ?? 0) + 1;
            counts.set(float.kind, number);
            rows.push({ ...float, file: path, number });
          }
        }
        if (!cancelled) setFloats(rows);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, order, activeFile, buffers, content]);

  const projectFiles = useMemo(() => new Set(collectAssetPaths(files)), [files]);
  const graphicsPaths = useMemo(
    () => [
      ...Object.entries(graphicsPathsByFile)
        .filter(([file]) => file !== activeFile)
        .flatMap(([, dirs]) => dirs),
      ...extractGraphicsPaths(content),
    ],
    [graphicsPathsByFile, activeFile, content],
  );

  const visible = useMemo(() => {
    if (floats === null) return [];
    const q = query.trim();
    return floats.filter((float) => {
      if (issuesOnly && float.caption !== null && float.label !== null) return false;
      if (q.length === 0) return true;
      const haystack = [float.caption, float.label, float.graphic, float.file]
        .filter((part) => part !== null)
        .join(" ");
      return fuzzyMatch(q, haystack) !== null;
    });
  }, [floats, query, issuesOnly]);

  const issueCount = useMemo(
    () => (floats ?? []).filter((f) => f.caption === null || f.label === null).length,
    [floats],
  );

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

  function toggle(kind: FloatKind) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader label="Figures & tables" />
      <div className="flex shrink-0 items-center gap-1.5 p-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 rounded-md pl-6 text-xs"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
        </div>
        <button
          type="button"
          title="Show only floats without a caption or label"
          aria-pressed={issuesOnly}
          className={cn(
            "h-7 shrink-0 rounded-md border px-2 text-2xs tabular-nums transition-colors hover:bg-accent",
            issuesOnly && "border-warning/50 bg-warning/10 text-warning",
          )}
          onClick={() => setIssuesOnly((on) => !on)}
        >
          Issues {issueCount}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {floats === null && order !== null ? null : floats === null ||
          floats.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            {activeFile
              ? "No figures or tables in this document yet."
              : "No file open."}
          </p>
        ) : visible.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            No floats match your filters.
          </p>
        ) : (
          GROUPS.map(({ kind, label }) => {
            const rows = visible.filter((float) => float.kind === kind);
            if (rows.length === 0) return null;
            const isCollapsed = collapsed.has(kind);
            return (
              <div key={kind} className="mb-1">
                <div className="flex items-center rounded hover:bg-accent">
                  <button
                    type="button"
                    title={isCollapsed ? "Expand" : "Collapse"}
                    className="flex size-5 shrink-0 items-center justify-center"
                    onClick={() => toggle(kind)}
                  >
                    <ChevronRight
                      className={cn(
                        "size-3 transition-transform",
                        !isCollapsed && "rotate-90",
                      )}
                    />
                  </button>
                  <span className="min-w-0 flex-1 truncate py-1.5 text-xs font-medium text-muted-foreground">
                    {label}
                  </span>
                  <span className="mr-1 shrink-0 text-2xs tabular-nums text-muted-foreground">
                    {rows.length}
                  </span>
                </div>
                {!isCollapsed &&
                  rows.map((float) => {
                    const image =
                      float.graphic === null
                        ? null
                        : resolveGraphicsRef(
                            float.graphic,
                            projectFiles,
                            graphicsPaths,
                          );
                    return (
                      <button
                        key={`${float.file}:${float.line}`}
                        type="button"
                        className="flex w-full items-start gap-2 rounded py-1 pr-1 pl-6 text-left hover:bg-accent"
                        title={`${float.env} — ${float.file}:${float.line}`}
                        onClick={() => goTo(float.file, float.line)}
                      >
                        {kind === "figure" && (
                          <span className="flex h-8 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                            {image !== null && (
                              <AssetThumb path={image} kind={assetKind(image)} />
                            )}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-1.5">
                            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                              {float.number}
                            </span>
                            {float.caption !== null ? (
                              <span className="truncate text-xs">{float.caption}</span>
                            ) : (
                              <span className="truncate text-xs text-warning italic">
                                No caption
                              </span>
                            )}
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5 text-2xs whitespace-nowrap text-muted-foreground">
                            {float.label !== null ? (
                              <span className="min-w-0 truncate font-mono">
                                {float.label}
                              </span>
                            ) : (
                              <span className="shrink-0 text-warning">No label</span>
                            )}
                            <span className="ml-auto min-w-0 truncate">
                              {float.file}:{float.line}
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
