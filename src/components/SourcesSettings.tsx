import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BookOpen,
  Boxes,
  ChevronRight,
  Cloud,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
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
import { parseBibEntries } from "@/lib/bib-entries";
import { zoteroLocalStatus, zoteroWebValidateKey } from "@/lib/zotero";
import { sourceName, useSourcesStore, type SourceDef } from "@/store/sources";
import { cn } from "cn";

/** A Zotero connection's state: pulsing while it initializes, gray
 *  while the source is disabled. */
type ZoteroStatus = "checking" | "ok" | "error" | "off";

/** The status dot next to a Zotero source. */
function Dot({ state }: { state: ZoteroStatus }) {
  const color =
    state === "ok"
      ? "bg-emerald-500"
      : state === "error"
        ? "bg-rose-500"
        : state === "off"
          ? "bg-muted-foreground/40"
          : "bg-muted-foreground/60";
  return (
    <span className="relative flex size-2 shrink-0">
      {state === "checking" && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            color,
          )}
        />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}

const KIND_ICONS = { bib: BookOpen, "zotero-app": Boxes, "zotero-cloud": Cloud };

function sourceSubtitle(
  source: SourceDef,
  entryCount: number | null,
  status: ZoteroStatus,
): string {
  if (source.kind === "bib") {
    const where =
      source.path === null || source.path.length === 0
        ? "No path set"
        : source.path.endsWith(".bib")
          ? source.path
          : `The folder ${source.path}`;
    return entryCount === null ? where : `${where} · ${entryCount} entries`;
  }
  // A disabled source is not searched, so its connection is moot.
  if (!source.enabled) return "Disabled";
  if (source.kind === "zotero-app") {
    if (status === "checking") return "Checking…";
    if (status === "ok") return "Connected";
    return "Not detected — enable “Allow other applications…” in Zotero's settings";
  }
  const configured =
    (source.userId ?? "").length > 0 && (source.apiKey ?? "").length > 0;
  if (!configured) return "Not connected";
  if (status === "checking") return `Checking · User ${source.userId}`;
  if (status === "ok") return `Connected · User ${source.userId}`;
  return "Key rejected — check the API key";
}

/** Probe a Zotero connection: app server reachability, or key
 *  validity for cloud sources. */
async function checkZotero(source: SourceDef): Promise<ZoteroStatus> {
  if (source.kind === "zotero-app") {
    return (await zoteroLocalStatus()) ? "ok" : "error";
  }
  if ((source.userId ?? "").length === 0 || (source.apiKey ?? "").length === 0) {
    return "error";
  }
  return (await zoteroWebValidateKey(source.apiKey ?? "")) !== null ? "ok" : "error";
}

/**
 * The Bibliography section's source list: every reference source the
 * "Add from Sources…" search covers. Bib sources reference .bib
 * files or folders anywhere on the filesystem, in place. Zotero rows
 * carry a live connection status: pulsing while checking, green when
 * set up, red on errors, with a refresh button per row.
 */
export function SourcesSettingsCard() {
  const sources = useSourcesStore((s) => s.sources);
  const sourceFiles = useSourcesStore((s) => s.sourceFiles);
  const bibTexts = useSourcesStore((s) => s.bibTexts);
  const error = useSourcesStore((s) => s.error);
  const loading = useSourcesStore((s) => s.loading);
  const addSource = useSourcesStore((s) => s.addSource);
  const removeSource = useSourcesStore((s) => s.removeSource);
  const setSourceEnabled = useSourcesStore((s) => s.setSourceEnabled);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, ZoteroStatus>>({});
  const [cloudDialog, setCloudDialog] = useState<{
    open: boolean;
    source: SourceDef | null;
  }>({ open: false, source: null });

  /** Probe one Zotero connection; the dot pulses while it runs. */
  const probeSource = useCallback(async (source: SourceDef) => {
    if (source.kind !== "zotero-app" && source.kind !== "zotero-cloud") return;
    setStatuses((prev) => ({ ...prev, [source.id]: "checking" }));
    const status = await checkZotero(source);
    setStatuses((prev) => ({ ...prev, [source.id]: status }));
  }, []);

  // Load the source list and probe the connections.
  useEffect(() => {
    void useSourcesStore.getState().refresh();
  }, []);
  useEffect(() => {
    if (loading) return;
    // Probe every enabled Zotero connection (also rechecks after
    // edits), deferred past the commit so no state is set during it.
    const timer = setTimeout(() => {
      for (const source of sources) {
        if (
          source.enabled &&
          (source.kind === "zotero-app" || source.kind === "zotero-cloud")
        ) {
          void probeSource(source);
        }
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [loading, sources, probeSource]);

  const hasZoteroApp = useMemo(
    () => sources.some((source) => source.kind === "zotero-app"),
    [sources],
  );

  /** Bib sources reference their files in place — nothing is copied. */
  async function addBibFile() {
    const picked = await openDialog({ multiple: false });
    if (typeof picked !== "string" || picked.length === 0) return;
    await addSource({
      kind: "bib",
      enabled: true,
      name: null,
      path: picked,
      userId: null,
      apiKey: null,
    });
  }

  async function addBibFolder() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string" || picked.length === 0) return;
    await addSource({
      kind: "bib",
      enabled: true,
      name: null,
      path: picked,
      userId: null,
      apiKey: null,
    });
  }

  async function addZoteroApp() {
    if (hasZoteroApp) return;
    await addSource({ kind: "zotero-app", enabled: true, name: null, path: null, userId: null, apiKey: null });
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
            const files = sourceFiles[source.id] ?? [];
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
            const isZotero =
              source.kind === "zotero-app" || source.kind === "zotero-cloud";
            // A disabled source is gray, whatever its last check said.
            const status: ZoteroStatus = source.enabled
              ? statuses[source.id] ?? "checking"
              : "off";
            return (
              <div key={source.id} className="py-2.5">
                <div className="flex items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      {isZotero && <Dot state={status} />}
                      {sourceName(source)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {sourceSubtitle(source, entryCount, status)}
                    </p>
                  </div>
                  {isZotero && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0"
                      title={
                        source.enabled
                          ? "Recheck the connection"
                          : "Enable the source to recheck the connection"
                      }
                      disabled={!source.enabled || status === "checking"}
                      onClick={() => void probeSource(source)}
                    >
                      <RefreshCw
                        className={cn(
                          "size-3.5",
                          status === "checking" && "animate-spin",
                        )}
                      />
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
                          <li
                            key={file}
                            className="truncate text-xs text-muted-foreground"
                            title={file}
                          >
                            {file}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {source.kind === "bib" && files.length === 0 && (
                  <p className="mt-0.5 pl-11 text-xs text-muted-foreground">
                    No .bib files here (yet).
                  </p>
                )}
              </div>
            );
          })}
        </div>
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
          Referenced in place — nothing is copied into your projects.
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
