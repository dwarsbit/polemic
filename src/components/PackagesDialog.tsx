import { useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ctanPageUrl,
  searchCtan,
  type CtanPackage,
} from "@/lib/ctan";
import { ensurePackages } from "@/lib/editor-figure";
import { removeUsepackage } from "@/lib/editor-preamble";
import { loadedPackages } from "@/lib/packages";
import { texPackageInfo, type TexPackageInfo } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "cn";

/**
 * The package manager: the document's packages at the top (add and
 * remove \usepackage lines), full CTAN search below, and a detail
 * pane with description, installed status, and the CTAN docs.
 */
export function PackagesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const content = useEditorStore((s) => s.content);
  const docPackages = useMemo(() => loadedPackages(content), [content]);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CtanPackage[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [infos, setInfos] = useState<Record<string, TexPackageInfo>>({});
  const [selected, setSelected] = useState<string | null>(null);

  // Local distribution info for the document's packages — only while
  // the dialog is open (the dialog stays mounted when closed, and the
  // distribution probes spawn TeX processes).
  useEffect(() => {
    if (!open || docPackages.length === 0) return;
    const known = docPackages.filter((name) => infos[name] === undefined);
    if (known.length === 0) return;
    void texPackageInfo(known)
      .then((list) => {
        setInfos((prev) => {
          const next = { ...prev };
          known.forEach((name, index) => {
            next[name] = list[index];
          });
          return next;
        });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, docPackages]);

  // CTAN search, debounced while typing.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      void searchCtan(trimmed)
        .then((list) => {
          if (!cancelled) {
            setResults(list);
            setSearchError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setSearchError(String(e));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Captions of the search results: the CTAN caption is the
  // "what does it do" description, already delivered with the search.
  const captions = useMemo(() => {
    const map: Record<string, string> = {};
    for (const pkg of results ?? []) {
      if (pkg.caption !== null) map[pkg.id] = pkg.caption;
    }
    return map;
  }, [results]);

  // Local distribution info for the selected package.
  useEffect(() => {
    if (!open || selected === null) return;
    let cancelled = false;
    void texPackageInfo([selected])
      .then(([info]) => {
        if (!cancelled) {
          setInfos((prev) => ({ ...prev, [selected]: info }));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, selected]);

  const selectedCaption =
    selected !== null ? captions[selected] : undefined;
  const detailLoading = selected !== null && infos[selected] === undefined;

  function add(name: string) {
    ensurePackages([name]);
  }

  const selectedInfo = selected !== null ? infos[selected] : undefined;
  // An empty query shows the catalog hint instead of stale results.
  const searching_ = query.trim().length > 0;
  const shownResults = searching_ ? results : null;
  const shownError = searching_ ? searchError : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[540px] max-h-[90vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle>Packages</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-0">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <Input
                autoFocus
                className="h-7 border-none bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                placeholder="Search CTAN…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
              />
              {searching && <Loader2 className="size-3.5 animate-spin" />}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 text-sm">
              {docPackages.length > 0 && (
                <>
                  <p className="px-1 pb-1 text-[10px] font-medium text-muted-foreground">
                    IN THIS DOCUMENT
                  </p>
                  <ul className="mb-3">
                    {docPackages.map((name) => {
                      const info = infos[name];
                      return (
                        <li key={name}>
                          <div
                            className={cn(
                              "flex items-center gap-2 rounded-lg px-2 py-1.5",
                              selected === name
                                ? "bg-accent"
                                : "hover:bg-accent/50",
                            )}
                          >
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left"
                              onClick={() => setSelected(name)}
                            >
                              <span className="font-mono">{name}</span>
                              {info?.description && (
                                <span
                                  className="ml-2 truncate text-xs text-muted-foreground"
                                  title={info.description}
                                >
                                  {info.description}
                                </span>
                              )}
                            </button>
                            <button
                              type="button"
                              title={`Remove ${name} from the document`}
                              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                              onClick={() => removeUsepackage(name)}
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              <p className="px-1 pb-1 text-[10px] font-medium text-muted-foreground">
                {shownResults === null
                  ? "CTAN CATALOG"
                  : `CTAN RESULTS (${shownResults.length})`}
              </p>
              {shownError && (
                <p className="px-2 py-1 text-xs text-destructive" title={shownError}>
                  CTAN search failed (offline?): {shownError}
                </p>
              )}
              {shownResults === null ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Type to search the CTAN catalog for packages and descriptions.
                </p>
              ) : (
                <ul>
                  {shownResults.map((pkg) => (
                    <li key={pkg.id}>
                      <button
                        type="button"
                        className={cn(
                          "block w-full rounded-lg px-2 py-1.5 text-left",
                          selected === pkg.id
                            ? "bg-accent"
                            : "hover:bg-accent/50",
                        )}
                        onClick={() => setSelected(pkg.id)}
                      >
                        <span className="font-mono">{pkg.id}</span>
                        {pkg.caption && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {pkg.caption}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="w-64 shrink-0 overflow-y-auto p-3 text-sm">
            {selected === null ? (
              <p className="text-xs text-muted-foreground">
                Select a package to see what it does.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="font-mono">{selected}</p>
                {detailLoading && (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                )}
                {selectedCaption && (
                  <p className="text-xs font-medium">{selectedCaption}</p>
                )}
                {selectedInfo?.description && selectedCaption !== selectedInfo.description && (
                  <p className="text-xs text-muted-foreground">
                    {selectedInfo.description}
                  </p>
                )}
                <p className="flex items-center gap-1.5 text-xs">
                  {selectedInfo === undefined ? (
                    "Checking your TeX distribution…"
                  ) : selectedInfo.installed ? (
                    <>
                      <Check className="size-3.5 text-green-600" />
                      Installed in your TeX distribution
                    </>
                  ) : (
                    <>
                      <CircleAlert className="size-3.5 text-amber-500" />
                      Not found in your TeX distribution
                    </>
                  )}
                </p>
                <div className="flex items-center gap-1.5 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void openUrl(ctanPageUrl(selected))}
                    title="Open the CTAN page with the documentation"
                  >
                    <ExternalLink />
                    Docs
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => add(selected)}
                    disabled={docPackages.includes(selected)}
                    title={
                      docPackages.includes(selected)
                        ? "Already in this document"
                        : "Add \\usepackage to the document"
                    }
                  >
                    <Plus />
                    {docPackages.includes(selected) ? "Added" : "Add"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
