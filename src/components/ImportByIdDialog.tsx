import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { CitationPreview } from "@/components/CitationPreview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatEntry, type EntryDraft } from "@/lib/bib-entries";
import { bibtexToDraft, parseLookupId } from "@/lib/bib-lookup";
import type { CiteStyle } from "@/lib/citation-preview";
import { appendBibEntryToProject, projectBibKeys } from "@/lib/project-bib";
import { lookupBibtex } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";

/**
 * "Import by DOI or arXiv ID": paste an identifier, fetch its BibTeX
 * from doi.org, review it (with a citation preview), and add it to the
 * project's bibliography. Online lookup is opt-in: until the user
 * enables it, the dialog explains what is sent and offers the switch.
 */
export function ImportByIdDialog({
  open,
  onOpenChange,
  defaultStyle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultStyle: CiteStyle;
}) {
  const onlineLookup = useSettingsStore((s) => s.onlineLookup);
  const setOnlineLookup = useSettingsStore((s) => s.setOnlineLookup);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const parsed = useMemo(() => parseLookupId(input), [input]);
  const trimmed = input.trim();

  async function fetchEntry() {
    if (parsed === null || busy) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    setMessage(null);
    try {
      const raw = await lookupBibtex(parsed.doi);
      const next = bibtexToDraft(raw, await projectBibKeys(), parsed);
      if (next === null) setError("The registry's answer contained no entry.");
      else setDraft(next);
    } catch (e) {
      setError(
        typeof e === "string"
          ? e
          : e instanceof Error
            ? e.message
            : "The lookup failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (draft === null) return;
    const result = await appendBibEntryToProject(
      formatEntry(draft.type, draft.key, draft.fields),
      draft.key,
    );
    if (result === null) return;
    setMessage(`Added ${draft.key} to ${result.target}.`);
    setDraft(null);
    setInput("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import by DOI or arXiv ID</DialogTitle>
          <DialogDescription className="text-xs">
            Paste a DOI (10.1145/…), an arXiv ID (1706.03762), or a doi.org / arxiv.org
            link.
          </DialogDescription>
        </DialogHeader>
        {!onlineLookup ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Online lookup is off. Turning it on lets Polemic contact doi.org to fetch
              the entry; only the identifier you paste is sent.
            </p>
            <Button size="sm" onClick={() => void setOnlineLookup(true)}>
              Enable online lookup
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                autoFocus
                className="h-7 min-w-0 flex-1 rounded-md font-mono text-xs"
                placeholder="10.1145/3292500.3330701 or arXiv:1706.03762"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void fetchEntry();
                }}
              />
              <Button
                size="sm"
                className="h-7"
                disabled={parsed === null || busy}
                onClick={() => void fetchEntry()}
              >
                {busy && <Loader2 className="size-3 animate-spin" />}
                Fetch
              </Button>
            </div>
            {trimmed.length > 0 && parsed === null && (
              <p className="text-xs text-muted-foreground">
                That does not look like a DOI or an arXiv ID.
              </p>
            )}
            {error !== null && <p className="text-xs text-destructive">{error}</p>}
            {draft !== null && (
              <div className="space-y-2">
                <div className="rounded-md border p-2 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono">{draft.key}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {draft.type}
                    </span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    {draft.fields.find((f) => f.name === "title")?.value ??
                      "(untitled)"}
                  </p>
                </div>
                <CitationPreview
                  entry={{ type: draft.type, key: draft.key, fields: draft.fields }}
                  defaultStyle={defaultStyle}
                />
              </div>
            )}
            {message !== null && (
              <p className="text-xs text-muted-foreground">{message}</p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {draft === null ? "Done" : "Cancel"}
          </Button>
          {draft !== null && (
            <Button size="sm" onClick={() => void add()}>
              Add to project
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
