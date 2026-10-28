import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { CitationPreview } from "@/components/CitationPreview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  commonFields,
  entryTypes,
  isRequiredField,
  missingFieldNames,
  missingFields,
  suggestKey,
  typeLabel,
  type BibBackend,
  type EntryDraft,
} from "@/lib/bib-entries";
import type { CiteStyle } from "@/lib/citation-preview";
import { cn } from "cn";

/** A key is anything BibTeX can parse: no commas, braces, or spaces. */
function isValidKey(key: string): boolean {
  return /^[^,\s{}"]+$/.test(key);
}

/**
 * The .bib entry editor: key, type, and fields with per-type
 * validation following the project's backend (BibTeX or biblatex). The dialog is dumb — the panel applies the draft to
 * the project (see planEntryEdits / formatEntry).
 */
export function EntryEditorDialog({
  open,
  onOpenChange,
  title,
  initial,
  existingKeys,
  bibFiles,
  allowFile,
  autoKey,
  previewStyle = "numeric",
  previewNote,
  backend = "bibtex",
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The entry as it currently exists (or a new-entry skeleton). */
  initial: EntryDraft & { file: string };
  /** Keys that exist elsewhere in the project's .bib files. */
  existingKeys: string[];
  /** .bib files in the project; for the new-entry target picker. */
  bibFiles: string[];
  /** Whether the target .bib file can be changed (new entries). */
  allowFile: boolean;
  /** Suggest a key from author/year until the user edits the key. */
  autoKey: boolean;
  /** The biblatex style the citation preview starts on (default numeric). */
  previewStyle?: CiteStyle;
  /** Shown under the preview, e.g. when the project's style is approximated. */
  previewNote?: string;
  /** Which entry types and fields validate (the project's backend). */
  backend?: BibBackend;
  /** Called with the draft and the chosen .bib file. */
  onSave: (draft: EntryDraft, file: string) => void;
}) {
  const [draft, setDraft] = useState<EntryDraft>(initial);
  const [file, setFile] = useState(initial.file);
  const [keyEdited, setKeyEdited] = useState(!autoKey);

  const effectiveKey = keyEdited
    ? draft.key
    : suggestKey(draft.type, draft.fields, existingKeys);
  const keyTaken = useMemo(
    () => existingKeys.includes(effectiveKey) && effectiveKey !== initial.key,
    [existingKeys, effectiveKey, initial],
  );
  const keyInvalid = !isValidKey(effectiveKey);
  const missing = missingFields(draft, backend);
  // Missing required fields first, then the usual ones.
  const addable = [
    ...new Set([...missingFieldNames(draft, backend), ...commonFields(backend)]),
  ].filter((name) => !draft.fields.some((field) => field.name === name));
  // An entry of a type outside the list keeps its type selectable.
  const types = entryTypes(backend);
  if (!types.includes(draft.type)) types.push(draft.type);

  function close() {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">
                Citation key
              </label>
              <Input
                autoFocus
                className={cn(
                  "h-7 rounded-md font-mono text-xs",
                  (keyTaken || keyInvalid) && "border-destructive",
                )}
                value={effectiveKey}
                onChange={(e) => {
                  setKeyEdited(true);
                  setDraft({ ...draft, key: e.target.value });
                }}
              />
            </div>
            <div className="w-36">
              <label className="mb-1 block text-xs text-muted-foreground">Type</label>
              <Select
                value={draft.type}
                onValueChange={(type) => setDraft({ ...draft, type })}
              >
                <SelectTrigger className="h-7 w-full text-xs" title={draft.type}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {types.map((type) => (
                    <SelectItem key={type} value={type}>
                      {typeLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {keyTaken && (
            <p className="text-xs text-destructive">
              A different entry with this key already exists.
            </p>
          )}
          {keyInvalid && effectiveKey.length > 0 && (
            <p className="text-xs text-destructive">
              Keys cannot contain commas, spaces, braces, or quotes.
            </p>
          )}
          {allowFile && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Save into
              </label>
              <Select value={file} onValueChange={setFile}>
                <SelectTrigger className="h-7 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bibFiles.map((path) => (
                    <SelectItem key={path} value={path}>
                      {path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {draft.fields.length > 0 && (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {draft.fields.map((field, index) => (
                <div key={field.name} className="flex items-center gap-2">
                  <label className="w-20 shrink-0 truncate text-xs text-muted-foreground">
                    {field.name}
                    {isRequiredField(draft.type, field.name, backend) && (
                      <span className="text-destructive"> *</span>
                    )}
                  </label>
                  <Input
                    className="h-7 min-w-0 flex-1 rounded-md text-xs"
                    value={field.value}
                    onChange={(e) => {
                      const fields = [...draft.fields];
                      fields[index] = { ...field, value: e.target.value };
                      setDraft({ ...draft, fields });
                    }}
                  />
                  <button
                    type="button"
                    title={`Remove ${field.name}`}
                    className="flex size-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        fields: draft.fields.filter((f) => f.name !== field.name),
                      })
                    }
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {addable.length > 0 && (
            <div>
              <Select
                value=""
                onValueChange={(name) => {
                  if (!name) return;
                  setDraft({
                    ...draft,
                    fields: [...draft.fields, { name, value: "" }],
                  });
                }}
              >
                <SelectTrigger className="h-7 w-full text-xs">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Plus className="size-3" />
                    Add field
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {addable.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {missing.length > 0 && (
            <p className="text-xs text-warning">
              Missing for {typeLabel(draft.type)}: {missing.join(", ")} — a warning
              only, saving works.
            </p>
          )}
          <CitationPreview
            entry={{ type: draft.type, key: effectiveKey, fields: draft.fields }}
            defaultStyle={previewStyle}
            note={previewNote}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={keyInvalid || keyTaken || effectiveKey.length === 0}
            onClick={() => {
              onSave(
                {
                  ...draft,
                  key: effectiveKey,
                  fields: draft.fields.filter((f) => f.value.trim().length > 0),
                },
                file,
              );
              close();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
