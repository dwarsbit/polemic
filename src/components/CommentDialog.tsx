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
import { useCommentsStore } from "@/store/comments";

function anchorLabel(target: CommentTarget): string {
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
function CommentForm({ target, onClose }: { target: CommentTarget; onClose: () => void }) {
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
        await add({ file: target.file, category, text: text.trim(), anchor: target.anchor });
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
            <span
              className="size-2 rounded-full"
              style={{ background: entry.color }}
            />
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
            {target?.kind === "edit" ? "Edit comment" : "New comment"}
          </DialogTitle>
        </DialogHeader>
        {target !== null && <CommentForm target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
