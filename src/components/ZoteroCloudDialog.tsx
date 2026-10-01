import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { zoteroWebValidateKey } from "@/lib/zotero";
import { useSourcesStore, type SourceDef } from "@/store/sources";

/**
 * Create or edit a Zotero cloud source: a label plus the user ID and
 * API key, with a validation step that fills in the user ID
 * automatically from the key. Saved into the sources list in the
 * app settings; pass null to add a new source.
 */
export function ZoteroCloudDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: SourceDef | null;
}) {
  const addSource = useSourcesStore((s) => s.addSource);
  const updateSource = useSourcesStore((s) => s.updateSource);

  const [name, setName] = useState(source?.name ?? "");
  const [userId, setUserId] = useState(source?.userId ?? "");
  const [apiKey, setApiKey] = useState(source?.apiKey ?? "");
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function validate() {
    setError(null);
    setInfo(null);
    setValidating(true);
    const result = await zoteroWebValidateKey(apiKey);
    setValidating(false);
    if (result === null) {
      setError("The key could not be validated. Check it and your connection.");
      return;
    }
    setUserId(result.userID);
    setInfo(
      `Key valid${result.username.length > 0 ? ` for ${result.username}` : ""}.`,
    );
  }

  async function save() {
    const draft = {
      kind: "zotero-cloud" as const,
      enabled: source?.enabled ?? true,
      name: name.trim().length > 0 ? name.trim() : null,
      path: null,
      userId: userId.trim(),
      apiKey: apiKey.trim(),
    };
    if (source === null) {
      await addSource(draft);
    } else {
      await updateSource(source.id, draft);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {source === null ? "Add Zotero cloud source" : "Edit Zotero cloud source"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            A Zotero cloud source searches your library at zotero.org. Create
            a key at zotero.org/settings/keys with library read access, then
            paste it below — the user ID is filled in automatically.
          </p>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Label
            </label>
            <Input
              className="h-7 rounded-md text-xs"
              placeholder="e.g. Work library"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              API key
            </label>
            <div className="flex gap-1.5">
              <Input
                className="h-7 min-w-0 flex-1 rounded-md font-mono text-xs"
                placeholder="e.g. 9xXxXxXxXxXxXxXxXxXxXxXxX"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                disabled={apiKey.trim().length === 0 || validating}
                onClick={() => void validate()}
              >
                {validating ? <Loader2 className="size-3 animate-spin" /> : "Validate"}
              </Button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              User ID
            </label>
            <Input
              className="h-7 rounded-md text-xs"
              placeholder="Your Zotero user ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
          </div>
          {error !== null && <p className="text-xs text-destructive">{error}</p>}
          {info !== null && (
            <p className="text-xs text-muted-foreground">{info}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={userId.trim().length === 0 || apiKey.trim().length === 0}
            onClick={() => void save()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
