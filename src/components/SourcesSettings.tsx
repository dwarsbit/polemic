import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BookOpen,
  Boxes,
  ChevronRight,
  Cloud,
  FileText,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { ZoteroCloudDialog } from "@/components/ZoteroCloudDialog";
import { flattenBibPaths, parseBibEntries } from "@/lib/bib-entries";
import {
  getLibraryRoot,
  importLibraryFile,
  listLibraryFiles,
} from "@/lib/tauri";
import { zoteroLocalStatus } from "@/lib/zotero";
import {
  bibSourceFiles,
  sourceName,
  useSourcesStore,
  type SourceDef,
} from "@/store/sources";
import { useProjectStore } from "@/store/project";
import { useUiStore } from "@/store/ui";
import { cn } from "cn";

/** The status dot next to a Zotero source. */
function Dot({ ok }: { ok: boolean | null }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        ok === null ? "bg-muted-foreground/40" : ok ? "bg-emerald-500" : "bg-amber-500",
      )}
    />
  );
}

const KIND_ICONS = { bib: BookOpen, "zotero-app": Boxes, "zotero-cloud": Cloud };

function sourceSubtitle(source: SourceDef, entryCount: number | null): string {
  if (source.kind === "bib") {
    const where =
      source.path === null || source.path.length === 0
        ? "All .bib files in the library folder"
        : source.path.endsWith(".bib")
          ? source.path
          : `The folder ${source.path}`;
    return entryCount === null ? where : `${where} · ${entryCount} entries`;
  }
  if (source.kind === "zotero-app") return "The Zotero app on this computer (live, no key)";
  const userId = source.userId ?? "";
  return userId.length > 0 ? `Your library at zotero.org · User ${userId}` : "Not connected";
}

/**
 * The Bibliography section's source list: every reference source the
 * "Add from Sources…" search covers. Add, enable, edit, or remove;
 * bib sources open their files in the editor.
 */
export function SourcesSettingsCard() {
  const sources = useSourcesStore((s) => s.sources);
  const bibTexts = useSourcesStore((s) => s.bibTexts);
  const error = useSourcesStore((s) => s.error);
  const loading = useSourcesStore((s) => s.loading);
  const addSource = useSourcesStore((s) => s.addSource);
  const removeSource = useSourcesStore((s) => s.removeSource);
  const setSourceEnabled = useSourcesStore((s) => s.setSourceEnabled);

  const [libraryRoot, setLibraryRoot] = useState<string | null>(null);
  const [allBib, setAllBib] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [zoteroRunning, setZoteroRunning] = useState<boolean | null>(null);
  const [cloudDialog, setCloudDialog] = useState<{
    open: boolean;
    source: SourceDef | null;
  }>({ open: false, source: null });

  // Load the source list and the library's file listing.
  useEffect(() => {
    void useSourcesStore.getState().refresh();
  }, []);
  useEffect(() => {
    if (!loading) {
      void getLibraryRoot().then((root) => setLibraryRoot(root.path));
      void listLibraryFiles()
        .then((files) => setAllBib(flattenBibPaths(files)))
        .catch(() => setAllBib([]));
      void zoteroLocalStatus().then((running) => setZoteroRunning(running));
    }
  }, [loading, sources.length]);

  const hasZoteroApp = useMemo(
    () => sources.some((source) => source.kind === "zotero-app"),
    [sources],
  );

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 6000);
  }

  /** Absolute → library-relative; null when outside the library. */
  function toLibraryRelative(absolute: string): string | null {
    const root = libraryRoot?.replace(/\/+$/, "").toLowerCase() ?? "";
    const path = absolute.replace(/\/+$/, "");
    if (root.length === 0) return null;
    if (path.toLowerCase() === root) return "";
    if (path.toLowerCase().startsWith(`${root}/`)) {
      return path.slice(root.length + 1);
    }
    return null;
  }

  async function addBibFile() {
    const picked = await openDialog({
      multiple: false,
      defaultPath: libraryRoot ?? undefined,
    });
    if (typeof picked !== "string" || picked.length === 0) return;
    const relative = toLibraryRelative(picked);
    if (relative !== null && relative.length > 0) {
      await addSource({ kind: "bib", enabled: true, name: null, path: relative, userId: null, apiKey: null });
      return;
    }
    if (relative === "") {
      flash("That is the library folder itself — add it as a folder source.");
      return;
    }
    // Outside the library: copy the file in, like asset imports.
    try {
      const copied = await importLibraryFile(picked);
      await addSource({ kind: "bib", enabled: true, name: null, path: copied, userId: null, apiKey: null });
      flash(`Copied the file into the library as ${copied}.`);
    } catch (e) {
      flash(String(e));
    }
  }

  async function addBibFolder() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: libraryRoot ?? undefined,
    });
    if (typeof picked !== "string" || picked.length === 0) return;
    const relative = toLibraryRelative(picked);
    if (relative === null) {
      flash("Folder sources must live inside the library folder.");
      return;
    }
    await addSource({
      kind: "bib",
      enabled: true,
      name: null,
      path: relative.length === 0 ? null : relative,
      userId: null,
      apiKey: null,
    });
  }

  async function addZoteroApp() {
    if (hasZoteroApp) return;
    await addSource({ kind: "zotero-app", enabled: true, name: null, path: null, userId: null, apiKey: null });
  }

  function openBibFile(path: string) {
    void useProjectStore.getState().openLibraryFile(path);
    useUiStore.getState().setMode("editor");
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <p className="mb-1.5 font-medium">Sources</p>
      <p className="mb-2 text-xs text-muted-foreground">
        Where "Add from Sources…" searches. Entries are copied into each
        project's bibliography as you cite them.
      </p>
      {error !== null ? (
        <p className="py-2 text-xs text-destructive" title={error}>
          {error}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {sources.map((source) => {
            const files = bibSourceFiles(source, allBib);
            const entryCount =
              source.enabled && source.kind === "bib"
                ? files.reduce(
                    (sum, file) =>
                      sum + parseBibEntries(bibTexts[file] ?? "").entries.length,
                    0,
                  )
                : null;
            const Icon = KIND_ICONS[source.kind];
            const isExpanded = expanded.has(source.id);
            return (
              <div key={source.id} className="py-2.5">
                <div className="flex items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      {source.kind === "zotero-app" && (
                        <Dot ok={zoteroRunning} />
                      )}
                      {sourceName(source)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {sourceSubtitle(source, entryCount)}
                    </p>
                  </div>
                  {source.kind === "bib" && files.length === 1 && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0"
                      title="Open in the editor"
                      onClick={() => openBibFile(files[0])}
                    >
                      <FileText className="size-3.5" />
                    </Button>
                  )}
                  {source.kind === "zotero-cloud" && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0"
                      title="Edit source"
                      onClick={() => setCloudDialog({ open: true, source })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    title="Remove source"
                    onClick={() => void removeSource(source.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                  <Switch
                    checked={source.enabled}
                    onCheckedChange={(on) => void setSourceEnabled(source.id, on)}
                    title="Include this source when adding references to a project"
                  />
                </div>
                {source.kind === "bib" && files.length > 1 && (
                  <div className="mt-0.5 pl-11">
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => toggleExpanded(source.id)}
                    >
                      <ChevronRight
                        className={cn("size-3 transition-transform", isExpanded && "rotate-90")}
                      />
                      {files.length} files
                    </button>
                    {isExpanded && (
                      <ul className="mt-1 space-y-0.5">
                        {files.map((file) => (
                          <li key={file} className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left text-xs hover:underline"
                              title={file}
                              onClick={() => openBibFile(file)}
                            >
                              {file}
                            </button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="size-5 shrink-0"
                              title="Open in the editor"
                              onClick={() => openBibFile(file)}
                            >
                              <FileText className="size-3" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {source.kind === "bib" && files.length === 0 && (
                  <p className="mt-0.5 pl-11 text-xs text-muted-foreground">
                    No .bib files {source.path === null ? "in the library" : "here"} yet.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {message !== null && (
        <p className="mt-2 text-xs text-muted-foreground">{message}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus />
              Add source
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => void addBibFile()}>
              <BookOpen />
              BibTeX file…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void addBibFolder()}>
              <FolderOpen />
              BibTeX folder…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={hasZoteroApp}
              title={hasZoteroApp ? "The Zotero app source already exists" : undefined}
              onClick={() => void addZoteroApp()}
            >
              <Boxes />
              Zotero app
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setCloudDialog({ open: true, source: null })}
            >
              <Cloud />
              Zotero cloud…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="text-xs text-muted-foreground">
          Files outside the library folder are copied into it.
        </p>
      </div>

      {cloudDialog.open && (
        <ZoteroCloudDialog
          key={cloudDialog.source?.id ?? "new"}
          open
          onOpenChange={(open) => setCloudDialog({ open, source: null })}
          source={cloudDialog.source}
        />
      )}
    </div>
  );
}
