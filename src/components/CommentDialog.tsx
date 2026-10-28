import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { COMMENT_CATEGORIES } from "@/lib/comment-categories";
import type { CommentTarget } from "@/lib/editor-comments";
import { setNote } from "@/lib/changes";
import { currentText, writeFileEdits } from "@/lib/project-texts";
import { changeForNote, noteKey } from "@/lib/suggestion-notes";
import { flushPendingSerialize } from "@/lib/visual/pending-serialize";
import { useCommentsStore } from "@/store/comments";

function anchorLabel(target: Exclude<CommentTarget, { kind: "note" }>): string {
  if (target.kind === "new" && target.suggestion) return "a suggestion's note";
  if (target.kind === "edit") {
    const comment = useCommentsStore
      .getState()
      .comments.find((entry) => entry.id === target.id);
    if (!comment) return "";
    if (comment.anchor === null) return "whole file";
    return comment.anchor.text.includes("\n")
      ? "selection"
      : `line ${comment.anchor.line}`;
  }
  if (target.anchor === null) return "whole file";
  return target.anchor.text.includes("\n") ? "selection" : `line ${target.anchor.line}`;
}

/** The form; remounts per open (the dialog unmounts it when closed). */
function CommentForm({
  target,
  onClose,
}: {
  target: Exclude<CommentTarget, { kind: "note" }>;
  onClose: () => void;
}) {
  const comments = useCommentsStore((s) => s.comments);
  const add = useCommentsStore((s) => s.add);
  const update = useCommentsStore((s) => s.update);
  const remove = useCommentsStore((s) => s.remove);

  const existing =
    target.kind === "edit"
      ? (comments.find((comment) => comment.id === target.id) ?? null)
      : null;

  const [category, setCategory] = useState(existing?.category ?? "change");
  const [text, setText] = useState(existing?.text ?? "");
  const [resolved, setResolved] = useState(existing?.resolved ?? false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (text.trim() === "") return;
    try {
      if (target.kind === "edit") {
        await update(target.id, { category, text: text.trim(), resolved });
      } else {
        await add({
          file: target.file,
          category,
          text: text.trim(),
          anchor: target.anchor,
          suggestion: target.suggestion ?? null,
        });
      }
      onClose();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">
        Attached to: {anchorLabel(target)}
      </p>
      <div className="flex flex-wrap gap-1">
        {COMMENT_CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            title={entry.label}
            onClick={() => setCategory(entry.id)}
            className={
              category === entry.id
                ? "flex items-center gap-1.5 rounded-full border bg-muted px-2 py-1 text-xs"
                : "flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50"
            }
          >
            <span className="size-2 rounded-full" style={{ background: entry.color }} />
            {entry.label}
          </button>
        ))}
      </div>
      <Textarea
        autoFocus
        rows={4}
        value={text}
        placeholder="Write a comment…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        {target.kind === "edit" && (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={resolved}
                onCheckedChange={setResolved}
                title="Resolved"
              />
              Resolved
            </div>
            <Button
              variant="destructive"
              size="icon-sm"
              title="Delete comment"
              onClick={() => {
                void remove(target.id).finally(onClose);
              }}
            >
              <Trash2 />
            </Button>
          </>
        )}
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={text.trim() === ""} onClick={() => void save()}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

/** The note text as the markup will hold it (one line, trimmed). */
const noteText = (text: string) => text.replace(/\r?\n/g, " ").trim();

/** A suggestion's note: written into the markup (`comment=`), its
 *  replies following it in comments.json. */
function NoteForm({
  target,
  onClose,
}: {
  target: Extract<CommentTarget, { kind: "note" }>;
  onClose: () => void;
}) {
  const [text, setText] = useState(target.note ?? "");
  const [error, setError] = useState<string | null>(null);

  async function write(next: string | null) {
    const value = next === null || noteText(next) === "" ? null : noteText(next);
    if (target.apply) {
      target.apply(value);
    } else {
      // The Visual view writes its edits back with a delay.
      flushPendingSerialize();
      const source = await currentText(target.file);
      if (source === null) return;
      const found =
        target.note === null
          ? null
          : changeForNote(source, noteKey(target.author, target.note));
      const ref = found?.range ?? target.at;
      if (ref === null) {
        setError("The suggestion is no longer there.");
        return;
      }
      const edits = setNote(source, ref, value);
      await writeFileEdits(target.file, source, edits, "input.suggestionNote", {
        isolate: true,
      });
    }
    // The thread follows the note; it ends when the note goes.
    if (target.note !== null) {
      const store = useCommentsStore.getState();
      const from = noteKey(target.author, target.note);
      if (value === null) await store.resolveReplies(target.file, [from]);
      else await store.rekeyReplies(target.file, from, noteKey(target.author, value));
    }
    onClose();
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">
        Stored in the suggestion itself, so it travels with the file.
      </p>
      <Textarea
        autoFocus
        rows={3}
        value={text}
        placeholder="Write a note…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void write(text);
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        {target.note !== null && (
          <Button
            variant="destructive"
            size="icon-sm"
            title="Delete note"
            onClick={() => void write(null)}
          >
            <Trash2 />
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={noteText(text) === ""} onClick={() => void write(text)}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

export function CommentDialog({
  target,
  onClose,
}: {
  target: CommentTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {target?.kind === "note"
              ? target.note === null
                ? "Note on suggestion"
                : "Edit suggestion note"
              : target?.kind === "edit"
                ? "Edit comment"
                : target?.suggestion
                  ? "Reply"
                  : "New comment"}
          </DialogTitle>
        </DialogHeader>
        {target !== null &&
          (target.kind === "note" ? (
            <NoteForm target={target} onClose={onClose} />
          ) : (
            <CommentForm target={target} onClose={onClose} />
          ))}
      </DialogContent>
    </Dialog>
  );
}
