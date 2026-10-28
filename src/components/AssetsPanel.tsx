import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogsStore } from "@/store/dialogs";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ChevronRight, Plus, Search, X } from "lucide-react";
import { ask, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { AssetThumb } from "@/components/AssetThumb";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  assetFilterOf,
  assetInsert,
  assetKind,
  collectAssetPaths,
  formatBytes,
  isInsertableGraphics,
  type AssetFilter,
  type AssetKind,
} from "@/lib/assets";
import { ensurePackages } from "@/lib/editor-figure";
import { insertAtCursor } from "@/lib/editor-insert";
import { startAssetDrag, wasDragged } from "@/lib/editor-drag";
import { fuzzyMatch } from "@/lib/fuzzy";
import {
  extractGraphicsPaths,
  extractGraphicsRefs,
  isCheckableRef,
  resolveGraphicsRef,
} from "@/lib/graphics-refs";
import { showNativeContextMenu } from "@/lib/native-menu";
import { importAssets, readAsset, readProjectFile, type FileEntry } from "@/lib/tauri";
import { useAssetsStore } from "@/store/assets";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { cn } from "cn";

/** An \includegraphics path no project file matches. */
interface MissingRef {
  path: string;
  /** Where it first occurs. */
  file: string;
  line: number;
  count: number;
}

const FILTERS: { id: AssetFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "pdf", label: "PDFs" },
  { id: "data", label: "Data" },
  { id: "other", label: "Other" },
];

/**
 * The asset manager: every non-.tex file in the project as a flat,
 * searchable grid. Click selects (inspector at the bottom), double
 * click inserts a reference at the editor cursor, drag drops a
 * figure; the + button copies files in from disk (into assets/).
 */
export function AssetsPanel() {
  const project = useProjectStore((s) => s.project);
  const files = useProjectStore((s) => s.files);
  const activeFile = useProjectStore((s) => s.activeFile);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);
  const tags = useAssetsStore((s) => s.tags);
  const setTags = useAssetsStore((s) => s.setTags);

  const paths = useMemo(() => collectAssetPaths(files), [files]);
  const fileByPath = useMemo(() => {
    const map = new Map<string, FileEntry>();
    const walk = (list: FileEntry[]) => {
      for (const entry of list) {
        if (entry.isDir) {
          walk(entry.children);
        } else {
          map.set(entry.path, entry);
        }
      }
    };
    walk(files);
    return map;
  }, [files]);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetFilter>("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Map<string, number>>(new Map());
  const [missing, setMissing] = useState<MissingRef[]>([]);
  const [missingOpen, setMissingOpen] = useState(true);

  useEffect(() => {
    void useAssetsStore.getState().load();
  }, []);

  // Used-in-document counts and missing graphics (debounced): scan
  // every .tex file for \includegraphics references, resolved like
  // LaTeX does (\graphicspath, implied extensions); the active file
  // and buffers come from memory, others from disk (cached until the
  // tree changes).
  const diskCache = useRef<{ files: FileEntry[]; texts: Map<string, string> }>({
    files: [],
    texts: new Map(),
  });
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!project) return;
        const cache = diskCache.current;
        if (cache.files !== files) {
          cache.files = files;
          cache.texts.clear();
        }
        const texPaths: string[] = [];
        const walk = (list: FileEntry[]) => {
          for (const entry of list) {
            if (entry.isDir) {
              walk(entry.children);
            } else if (entry.path.toLowerCase().endsWith(".tex")) {
              texPaths.push(entry.path);
            }
          }
        };
        walk(files);
        const texts: [string, string][] = [];
        for (const path of texPaths) {
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
                cached = "";
              }
              cache.texts.set(path, cached);
            }
            text = cached === "" ? null : cached;
          }
          if (text !== null) texts.push([path, text]);
        }
        const graphicsPaths = texts.flatMap(([, text]) => extractGraphicsPaths(text));
        const projectFiles = new Set(paths);
        const counts = new Map<string, number>();
        const missingByRef = new Map<string, MissingRef>();
        for (const [file, text] of texts) {
          for (const ref of extractGraphicsRefs(text)) {
            if (!isCheckableRef(ref.path)) continue;
            const asset = resolveGraphicsRef(ref.path, projectFiles, graphicsPaths);
            if (asset !== null) {
              counts.set(asset, (counts.get(asset) ?? 0) + 1);
              continue;
            }
            const entry = missingByRef.get(ref.path);
            if (entry === undefined) {
              const line = text.slice(0, ref.from).split("\n").length;
              missingByRef.set(ref.path, { path: ref.path, file, line, count: 1 });
            } else {
              entry.count += 1;
            }
          }
        }
        if (!cancelled) {
          setMissing(
            [...missingByRef.values()].sort((a, b) => a.path.localeCompare(b.path)),
          );
        }
        if (!cancelled) setUsage(counts);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, files, paths, activeFile, buffers, content]);

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

  const allTags = useMemo(
    () => [...new Set(Object.values(tags).flat())].sort(),
    [tags],
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    return paths.filter((path) => {
      if (typeFilter !== "all" && assetFilterOf(path) !== typeFilter) {
        return false;
      }
      if (tagFilter.length > 0) {
        const assetTags = tags[path] ?? [];
        if (!tagFilter.some((tag) => assetTags.includes(tag))) return false;
      }
      if (q.length > 0) {
        const name = path.split("/").pop() ?? path;
        const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        const assetTags = (tags[path] ?? []).join(" ");
        if (fuzzyMatch(q, `${name} ${folder} ${assetTags}`) === null) {
          return false;
        }
      }
      return true;
    });
  }, [paths, query, typeFilter, tagFilter, tags]);

  async function importFiles() {
    setImportError(null);
    const { project } = useProjectStore.getState();
    if (!project) return;
    const picked = await openFileDialog({
      multiple: true,
      title: "Import assets (copied into the project)",
    });
    if (picked === null) return;
    const sources = Array.isArray(picked) ? picked : [picked];
    if (sources.length === 0) return;
    try {
      await importAssets(project.path, sources);
      await useProjectStore.getState().refreshFiles();
    } catch (e) {
      setImportError(String(e));
    }
  }

  function insert(path: string) {
    // Data files open the table / plot assistant instead.
    if (/\.(csv|tsv)$/i.test(path)) {
      useDialogsStore.getState().setCsvImport({ path });
      return;
    }
    const siblings = paths.filter(isInsertableGraphics);
    const { text, packages } = assetInsert(path, siblings);
    ensurePackages(packages);
    insertAtCursor(text);
  }

  // --- inspector ------------------------------------------------------------

  const selectedEntry = selected !== null ? (fileByPath.get(selected) ?? null) : null;
  const selectedTags = selected !== null ? (tags[selected] ?? []) : [];
  const usageCount = selected !== null ? (usage.get(selected) ?? 0) : 0;

  function addTag(raw: string) {
    if (selected === null) return;
    const tag = raw.trim();
    if (!tag || selectedTags.includes(tag)) return;
    setTags(selected, [...selectedTags, tag]);
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        label="ASSETS"
        collapsed={false}
        actions={
          <Button
            variant="ghost"
            size="icon-sm"
            title="Import assets (copies files into assets/)"
            onClick={() => void importFiles()}
          >
            <Plus className="size-4" />
          </Button>
        }
      />
      <div className="flex shrink-0 items-center gap-1.5 px-2 pb-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 rounded-md pl-6 text-xs"
            placeholder="Search assets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
        </div>
        <Select
          value={typeFilter}
          onValueChange={(value) => {
            if (value) setTypeFilter(value as AssetFilter);
          }}
        >
          <SelectTrigger className="h-7 w-[74px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((filter) => (
              <SelectItem key={filter.id} value={filter.id}>
                {filter.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {allTags.length > 0 && (
        <div className="flex gap-1 overflow-x-auto px-2 pb-2">
          {allTags.map((tag) => {
            const active = tagFilter.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={cn(
                  "shrink-0 rounded-full border px-1.5 py-0.5 text-2xs transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                onClick={() =>
                  setTagFilter((prev) =>
                    prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
                  )
                }
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {paths.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            No assets yet. Import image, PDF, or data files with the + button — they are
            copied into the project's assets/ folder.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            No assets match your filters.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((path) => {
              const kind = assetKind(path);
              return (
                <button
                  key={path}
                  type="button"
                  className={cn(
                    "group flex flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors hover:bg-accent",
                    selected === path && "ring-2 ring-inset ring-primary",
                  )}
                  title={`${path} — double-click to insert, drag into the editor for a figure`}
                  onClick={() => {
                    if (wasDragged()) return;
                    setSelected((prev) => (prev === path ? null : path));
                  }}
                  onDoubleClick={() => insert(path)}
                  onPointerDown={(event) => startAssetDrag(path, event)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void showNativeContextMenu([
                      {
                        id: "insert",
                        text: "Insert",
                        action: () => insert(path),
                      },
                      {
                        id: "delete",
                        text: "Delete",
                        action: () => {
                          void (async () => {
                            const confirmed = await ask(`Move ${path} to the trash?`, {
                              title: "Delete asset",
                              kind: "warning",
                              okLabel: "Delete",
                            }).catch(() => false);
                            if (!confirmed) return;
                            await useProjectStore.getState().deleteEntry(path);
                          })().catch(setImportError);
                        },
                      },
                    ]);
                  }}
                >
                  <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md bg-muted">
                    <AssetThumb path={path} kind={kind} />
                  </div>
                  <span className="truncate text-2xs">{path.split("/").pop()}</span>
                </button>
              );
            })}
          </div>
        )}
        {missing.length > 0 && (
          <div className="mt-2 border-t pt-1">
            <div className="flex items-center rounded hover:bg-accent">
              <button
                type="button"
                title={missingOpen ? "Collapse" : "Expand"}
                className="flex size-5 shrink-0 items-center justify-center"
                onClick={() => setMissingOpen((open) => !open)}
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform",
                    missingOpen && "rotate-90",
                  )}
                />
              </button>
              <span className="min-w-0 flex-1 truncate py-1 text-sm font-medium text-warning">
                Missing files
              </span>
              <span className="mr-1 shrink-0 text-2xs tabular-nums text-muted-foreground">
                {missing.length}
              </span>
            </div>
            {missingOpen &&
              missing.map((ref) => (
                <div
                  key={ref.path}
                  className="flex items-center rounded pl-6 hover:bg-accent"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate py-1 text-left text-sm"
                    title={`${ref.count} reference${ref.count === 1 ? "" : "s"} to a file not in the project`}
                    onClick={() => goTo(ref.file, ref.line)}
                  >
                    {ref.path}
                  </button>
                  <span className="mr-1.5 shrink-0 text-2xs tabular-nums text-muted-foreground">
                    {ref.count}×
                  </span>
                  <span className="max-w-24 shrink-0 truncate text-2xs text-muted-foreground">
                    {ref.file}:{ref.line}
                  </span>
                </div>
              ))}
          </div>
        )}
        {importError && (
          <p className="mt-2 px-2 text-xs text-destructive" title={importError}>
            {importError}
          </p>
        )}
      </div>

      {selected !== null && selectedEntry && (
        <div className="relative shrink-0 border-t px-2 pt-2 pb-1.5">
          <button
            type="button"
            title="Close inspector"
            className="absolute top-1.5 right-1.5 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setSelected(null)}
          >
            <X className="size-3" />
          </button>
          <div className="flex items-start gap-2">
            <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
              <AssetThumb path={selected} kind={assetKind(selected)} />
            </div>
            <InspectorDetails
              key={selected}
              path={selected}
              entry={selectedEntry}
              kind={assetKind(selected)}
              usageCount={usageCount}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {selectedTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-2xs"
              >
                {tag}
                <button
                  type="button"
                  title={`Remove ${tag}`}
                  onClick={() =>
                    setTags(
                      selected,
                      selectedTags.filter((t) => t !== tag),
                    )
                  }
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
            <input
              className="min-w-0 flex-1 border-b bg-transparent text-2xs outline-none focus:border-primary"
              placeholder="Add tag…"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addTag(tagDraft);
                  setTagDraft("");
                }
                if (e.key === "Escape") setTagDraft("");
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** The metadata column of the inspector. Remounts per asset (key), so
 *  its dimensions effect runs once per selection. */
function InspectorDetails({
  path,
  entry,
  kind,
  usageCount,
}: {
  path: string;
  entry: FileEntry;
  kind: AssetKind;
  usageCount: number;
}) {
  const [dims, setDims] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      const { project } = useProjectStore.getState();
      if (!project || kind === "file") return;
      try {
        const bytes = await readAsset(project.path, path);
        if (kind === "raster") {
          objectUrl = URL.createObjectURL(
            new Blob([bytes.slice().buffer as ArrayBuffer]),
          );
          const img = new Image();
          img.onload = () => {
            if (!cancelled) {
              setDims(`${img.naturalWidth} × ${img.naturalHeight} px`);
            }
          };
          img.src = objectUrl;
        } else {
          const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
          const page = await doc.getPage(1);
          const base = page.getViewport({ scale: 1 });
          doc.cleanup();
          if (!cancelled) {
            setDims(`${Math.round(base.width)} × ${Math.round(base.height)} pt`);
          }
        }
      } catch {
        // Dimensions unavailable; the row is simply omitted.
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [path, kind]);

  return (
    <div className="min-w-0 flex-1 space-y-0.5 text-2xs">
      <p className="truncate font-medium" title={path}>
        {entry.name}
      </p>
      {dims && <p className="text-muted-foreground">{dims}</p>}
      <p className="text-muted-foreground">
        {formatBytes(entry.size)} ·{" "}
        {kind === "raster" ? "Image" : kind === "pdf" ? "PDF" : "File"}
      </p>
      <p className="truncate text-muted-foreground" title={path}>
        {path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "(root)"}
      </p>
      {entry.modified !== null && (
        <p className="text-muted-foreground">
          {new Date(entry.modified * 1000).toLocaleDateString()}
        </p>
      )}
      <p className={cn(usageCount === 0 ? "text-warning" : "text-muted-foreground")}>
        {usageCount === 0
          ? "Unused"
          : `Used in ${usageCount} place${usageCount === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}
