import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  entryTitle,
  formatEntry,
  parseBibEntries,
  type BibEntry,
} from "@/lib/bib-entries";
import { fuzzyMatch } from "@/lib/fuzzy";
import { appendBibEntryToProject, projectBibKeys } from "@/lib/project-bib";
import { zoteroItemToBib, zoteroCreators, type ZoteroItemData } from "@/lib/zotero-convert";
import { zoteroLocalSearch, zoteroWebSearch } from "@/lib/zotero";
import { sourceName, useSourcesStore, type SourceDef } from "@/store/sources";
import { useSettingsStore } from "@/store/settings";
import { cn } from "cn";

interface BibHit {
  source: SourceDef;
  entry: BibEntry;
  file: string;
}

interface ZoteroHit {
  source: SourceDef;
  item: ZoteroItemData;
}

/**
 * "Add from Sources…": search every enabled source and copy picked
 * references into the project's bibliography. Bib sources read their
 * cached files; Zotero sources are queried live. Stays open for
 * batch adds; keys are deduped against the project.
 */
export function SourcesSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sources = useSourcesStore((s) => s.sources);
  const sourceFiles = useSourcesStore((s) => s.sourceFiles);
  const bibTexts = useSourcesStore((s) => s.bibTexts);
  const error = useSourcesStore((s) => s.error);

  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [zoteroHits, setZoteroHits] = useState<ZoteroHit[]>([]);

  // Refresh the sources scan while the dialog is open.
  useEffect(() => {
    if (open) void useSourcesStore.getState().refresh();
  }, [open]);

  const bibSources = useMemo(
    () => sources.filter((s) => s.kind === "bib" && s.enabled),
    [sources],
  );
  const zoteroSources = useMemo(
    () =>
      sources.filter(
        (s) =>
          s.enabled &&
          (s.kind === "zotero-app" ||
            (s.kind === "zotero-cloud" &&
              (s.userId ?? "").length > 0 &&
              (s.apiKey ?? "").length > 0)),
      ),
    [sources],
  );

  // Live Zotero search (debounced), across every enabled connection.
  useEffect(() => {
    const trimmed = query.trim();
    const eligible = open && trimmed.length > 0 && zoteroSources.length > 0;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!eligible) {
          if (!cancelled) setZoteroHits([]);
          return;
        }
        const requests = await Promise.allSettled(
          zoteroSources.map((source) =>
            source.kind === "zotero-app"
              ? zoteroLocalSearch(trimmed, null)
              : zoteroWebSearch(
                  trimmed,
                  null,
                  source.userId ?? "",
                  source.apiKey ?? "",
                ),
          ),
        );
        if (cancelled) return;
        const hits: ZoteroHit[] = [];
        requests.forEach((request, index) => {
          if (request.status !== "fulfilled") return;
          for (const item of request.value) {
            hits.push({ source: zoteroSources[index], item });
          }
        });
        setZoteroHits(hits);
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, zoteroSources]);

  const bibHits = useMemo<BibHit[]>(() => {
    const q = query.trim();
    const out: BibHit[] = [];
    for (const source of bibSources) {
      for (const file of sourceFiles[source.id] ?? []) {
        for (const entry of parseBibEntries(bibTexts[file] ?? "").entries) {
          if (
            q.length === 0 ||
            fuzzyMatch(q, `${entry.key} ${entryTitle(entry)}`) !== null
          ) {
            out.push({ source, entry, file });
          }
        }
      }
    }
    return out.sort((a, b) => a.entry.key.localeCompare(b.entry.key));
  }, [bibSources, sourceFiles, bibTexts, query]);

  async function addBib(hit: BibHit) {
    const raw = (bibTexts[hit.file] ?? "").slice(hit.entry.from, hit.entry.to);
    const result = await appendBibEntryToProject(raw, hit.entry.key);
    if (result === null) return;
    setAdded((prev) => new Set([...prev, hit.entry.key]));
    setMessage(
      result.alreadyPresent
        ? `${hit.entry.key} is already in the project.`
        : `Added ${hit.entry.key} to ${result.target}.`,
    );
  }

  async function addZotero(hit: ZoteroHit) {
    const taken = await projectBibKeys();
    const bib = zoteroItemToBib(hit.item, taken);
    const raw = formatEntry(bib.type, bib.key, bib.fields);
    const result = await appendBibEntryToProject(raw, bib.key);
    if (result === null) return;
    setAdded((prev) => new Set([...prev, hit.item.key ?? bib.key]));
    setMessage(
      result.alreadyPresent
        ? `${bib.key} is already in the project.`
        : `Added ${bib.key} to ${result.target}.`,
    );
  }

  /** One section per source, in the configured order. */
  const sections = useMemo(() => {
    const zoteroBySource = new Map<string, ZoteroHit[]>();
    for (const hit of zoteroHits) {
      const list = zoteroBySource.get(hit.source.id);
      if (list === undefined) zoteroBySource.set(hit.source.id, [hit]);
      else list.push(hit);
    }
    const bibBySource = new Map<string, BibHit[]>();
    for (const hit of bibHits) {
      const list = bibBySource.get(hit.source.id);
      if (list === undefined) bibBySource.set(hit.source.id, [hit]);
      else list.push(hit);
    }
    return sources
      .filter(
        (source) =>
          (bibBySource.get(source.id)?.length ?? 0) > 0 ||
          (zoteroBySource.get(source.id)?.length ?? 0) > 0,
      )
      .map((source) => ({
        source,
        bib: bibBySource.get(source.id) ?? [],
        zotero: zoteroBySource.get(source.id) ?? [],
      }));
  }, [sources, bibHits, zoteroHits]);

  const trim = query.trim();
  const anySource = bibSources.length > 0 || zoteroSources.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add from Sources</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="h-7 rounded-md pl-6 text-xs"
            placeholder="Search your sources"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {error !== null ? (
            <p className="p-2 text-xs text-destructive" title={error}>
              {error}
            </p>
          ) : !anySource ? (
            <div className="p-2">
              <p className="text-xs text-muted-foreground">
                No sources are available. Add or enable one in Settings.
              </p>
              <Button
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => {
                  onOpenChange(false);
                  useSettingsStore.getState().openSettings("bibliography");
                }}
              >
                Open Settings
              </Button>
            </div>
          ) : (
            <>
              {sections.length === 0 && (
                <p className="p-2 text-xs text-muted-foreground">
                  {trim.length > 0
                    ? "No references match your search."
                    : "Type in the search field to search your sources."}
                </p>
              )}
              {sections.map(({ source, bib, zotero }) => (
                <div key={source.id}>
                  <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
                    {sourceName(source)}
                  </p>
                  <ul className="space-y-0.5 p-1">
                    {bib.slice(0, 50).map((hit) => {
                      const present = added.has(hit.entry.key);
                      return (
                        <li key={`${hit.file}:${hit.entry.key}`}>
                          <HitRow
                            label={hit.entry.key}
                            title={entryTitle(hit.entry)}
                            tag={hit.entry.type}
                            present={present}
                            onClick={() => void addBib(hit)}
                          />
                        </li>
                      );
                    })}
                    {zotero.slice(0, 50).map((hit) => {
                      const id = hit.item.key ?? hit.item.title ?? "";
                      const present = added.has(id);
                      return (
                        <li key={`${source.id}:${id}`}>
                          <HitRow
                            label={zoteroCreators(hit.item.creators?.slice(0, 1))}
                            title={hit.item.title ?? "(untitled)"}
                            tag={hit.item.itemType}
                            present={present}
                            onClick={() => void addZotero(hit)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>
        {message !== null && (
          <p className="text-xs text-muted-foreground">{message}</p>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HitRow({
  label,
  title,
  tag,
  present,
  onClick,
}: {
  label: string;
  title: string;
  tag: string;
  present: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-accent"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate">
        <span className="font-mono">{label}</span>
        {title.length > 0 && (
          <span className="ml-2 text-muted-foreground">{title}</span>
        )}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{tag}</span>
      <span
        className={cn(
          "shrink-0 rounded-full border px-1.5 py-0 text-[10px] leading-4",
          present ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {present ? "in project" : "add"}
      </span>
      <Plus
        className={cn(
          "size-3 shrink-0",
          present ? "text-muted-foreground" : "text-foreground",
        )}
      />
    </button>
  );
}
