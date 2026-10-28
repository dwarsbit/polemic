import { useMemo, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  MessageSquareOff,
  Pencil,
  Reply,
  Trash2,
} from "lucide-react";
import { useProjectTexts } from "@/hooks/useProjectTexts";
import { parseAuthors } from "@/lib/changes";
import { authorStyles } from "@/lib/changes-view";
import { notesIn, type SuggestionNote } from "@/lib/suggestion-notes";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { resolveAnchor } from "@/lib/comment-anchor";
import { commentCategory } from "@/lib/comment-categories";
import { openCommentDialog } from "@/lib/editor-comments";
import { useEditorStore } from "@/store/editor";
import { useCommentsStore } from "@/store/comments";
import { useProjectStore } from "@/store/project";
import { cn } from "cn";
import { formatShortcut } from "@/lib/platform";

/** The pseudo-category of the notes on suggestions. */
const NOTES = "__suggestion-notes";

/** A suggestion's note with its replies, marked as a suggestion note. */
function NoteRow({
  note,
  color,
  authorName,
  replies,
  onJump,
}: {
  note: SuggestionNote;
  color: string | undefined;
  authorName: string;
  replies: { id: string; text: string; resolved: boolean }[];
  onJump: () => void;
}) {
  const update = useCommentsStore((s) => s.update);
  const remove = useCommentsStore((s) => s.remove);
  return (
    <div
      className="group rounded-lg border border-dashed bg-card/60 p-2"
      data-suggestion-note
    >
      <div className="flex items-start gap-1.5 text-xs">
        <span
          className="mt-1 size-2 shrink-0 rounded-full"
          style={{ background: color }}
        />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          title={`Jump to line ${note.line}`}
          onClick={onJump}
        >
          <span className="line-clamp-3 break-words text-foreground">{note.note}</span>
        </button>
      </div>
      <div className="mt-0.5 flex items-center pl-3.5 text-2xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          Suggestion note · {authorName} · line {note.line}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          title="Reply"
          onClick={() =>
            openCommentDialog({
              kind: "new",
              file: note.file,
              anchor: null,
              suggestion: note.key,
            })
          }
        >
          <Reply className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          title="Edit note"
          onClick={() =>
            openCommentDialog({
              kind: "note",
              file: note.file,
              at: note.at,
              note: note.note,
              author: note.author,
            })
          }
        >
          <Pencil className="size-3" />
        </Button>
      </div>
      {replies.map((reply) => (
        <div
          key={reply.id}
          className={cn(
            "mt-1 ml-3.5 flex items-start gap-1 border-l pl-2 text-xs",
            reply.resolved && "opacity-50",
          )}
        >
          <span className="min-w-0 flex-1 break-words">{reply.text}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5"
            title={reply.resolved ? "Mark unresolved" : "Mark resolved"}
            onClick={() => void update(reply.id, { resolved: !reply.resolved })}
          >
            <Check className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5"
            title="Delete reply"
            onClick={() => void remove(reply.id)}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function CommentsPanel() {
  const comments = useCommentsStore((s) => s.comments);
  const update = useCommentsStore((s) => s.update);
  const remove = useCommentsStore((s) => s.remove);
  const activeFile = useProjectStore((s) => s.activeFile);

  const [hideResolved, setHideResolved] = useState(true);
  // A category id, NOTES for suggestion notes only, or null for all.
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  // Notes on suggestions live in the markup of every .tex file.
  const { texts } = useProjectTexts();
  const notes = useMemo(
    () => [...(texts ?? [])].flatMap(([file, text]) => notesIn(file, text)),
    [texts],
  );
  const noteStyles = useMemo(
    () =>
      authorStyles(
        [...(texts?.values() ?? [])].flatMap((text) => parseAuthors(text)),
        notes.map((note) => note.author),
      ),
    [texts, notes],
  );
  const noteKeys = useMemo(
    () => new Set(notes.map((note) => `${note.file}\u0000${note.key}`)),
    [notes],
  );
  /** Replies shown under their note (not in the comment list). */
  const isThreaded = (comment: { file: string; suggestion?: string | null }) =>
    !!comment.suggestion && noteKeys.has(`${comment.file}\u0000${comment.suggestion}`);

  /** The anchored line for a comment, or null when orphaned. */
  function lineOf(comment: {
    anchor: { text: string; line: number } | null;
  }): number | null {
    if (comment.anchor === null) return null;
    if (comment.anchor.text === "") return null;
    return resolveAnchor(useEditorStore.getState().content, comment.anchor);
  }

  const shown = comments.filter(
    (comment) =>
      !isThreaded(comment) &&
      (!hideResolved || !comment.resolved) &&
      categoryFilter !== NOTES &&
      (categoryFilter === null || comment.category === categoryFilter),
  );
  const shownNotes = categoryFilter === null || categoryFilter === NOTES ? notes : [];

  // Group by file: active file first, then others that exist in the tree.
  const byFile = (() => {
    const groups = new Map<string, { items: typeof shown; notes: SuggestionNote[] }>();
    const group = (file: string) => {
      let entry = groups.get(file);
      if (entry === undefined) {
        entry = { items: [], notes: [] };
        groups.set(file, entry);
      }
      return entry;
    };
    for (const comment of shown) group(comment.file).items.push(comment);
    for (const note of shownNotes) group(note.file).notes.push(note);
    const names = [...groups.keys()].sort((a, b) =>
      a === activeFile ? -1 : b === activeFile ? 1 : a.localeCompare(b),
    );
    return names.map((file) => ({ file, ...groups.get(file)! }));
  })();

  async function jumpToNote(note: SuggestionNote): Promise<void> {
    if (note.file !== activeFile) await useProjectStore.getState().openFile(note.file);
    useEditorStore.getState().jumpTo(note.line);
  }

  async function jumpTo(file: string, id: string): Promise<void> {
    const comment = comments.find((entry) => entry.id === id);
    if (comment === undefined) return;
    if (file !== activeFile) {
      await useProjectStore.getState().openFile(file);
    }
    if (comment.anchor === null) return;
    const line = resolveAnchor(useEditorStore.getState().content, comment.anchor);
    if (line !== null) useEditorStore.getState().jumpTo(line);
  }

  if (comments.length === 0 && notes.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <SectionHeader label="Comments" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
          <MessageSquareOff className="size-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            No comments yet. Select text and press {formatShortcut("Mod+Alt+C")}, or
            right-click in the editor.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-card">
        <SectionHeader
          label="Comments"

          actions={
            <Button
              variant={hideResolved ? "secondary" : "ghost"}
              size="icon-xs"
              aria-pressed={hideResolved}
              onClick={() => setHideResolved((value) => !value)}
              title={hideResolved ? "Show resolved comments" : "Hide resolved comments"}
            >
              {hideResolved ? <EyeOff /> : <Eye />}
            </Button>
          }
        />
      </div>
      <div className="flex flex-wrap gap-1 px-2 py-1.5">
        <button
          type="button"
          className={cn(
            "rounded-full border px-2 py-0.5 text-xs",
            categoryFilter === null
              ? "bg-muted"
              : "text-muted-foreground hover:bg-muted/50",
          )}
          onClick={() => setCategoryFilter(null)}
        >
          All
        </button>
        {[
          ...new Set(
            comments.filter((c) => !isThreaded(c)).map((comment) => comment.category),
          ),
        ].map((id) => {
          const category = commentCategory(id);
          const active = categoryFilter === id;
          return (
            <button
              key={id}
              type="button"
              title={category.label}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                active ? "bg-muted" : "text-muted-foreground hover:bg-muted/50",
              )}
              onClick={() => setCategoryFilter(active ? null : id)}
            >
              <span
                className="size-2 rounded-full"
                style={{ background: category.color }}
              />
              {category.label}
            </button>
          );
        })}
        {notes.length > 0 && (
          <button
            type="button"
            title="Notes on suggestions"
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
              categoryFilter === NOTES
                ? "bg-muted"
                : "text-muted-foreground hover:bg-muted/50",
            )}
            onClick={() => setCategoryFilter(categoryFilter === NOTES ? null : NOTES)}
          >
            <span className="size-2 rounded-full border border-dashed border-current" />
            Suggestion notes
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3 p-2">
        {byFile.map(({ file, items, notes: fileNotes }) => (
          <div key={file}>
            <p className="mb-1 truncate px-1 text-xs font-medium text-muted-foreground">
              {file}
            </p>
            <div className="flex flex-col gap-1.5">
              {fileNotes.map((note) => (
                <NoteRow
                  key={`${note.at}:${note.key}`}
                  note={note}
                  color={noteStyles.get(note.author)?.color}
                  authorName={
                    noteStyles.get(note.author)?.name ?? note.author ?? "Unknown author"
                  }
                  replies={comments.filter(
                    (c) =>
                      c.file === file &&
                      c.suggestion === note.key &&
                      (!hideResolved || !c.resolved),
                  )}
                  onJump={() => void jumpToNote(note)}
                />
              ))}
              {items.map((comment) => {
                const category = commentCategory(comment.category);
                const line = file === activeFile ? lineOf(comment) : null;
                const orphaned =
                  comment.anchor !== null && file === activeFile && line === null;
                return (
                  <div
                    key={comment.id}
                    className={cn(
                      "group rounded-lg border bg-card/60 p-2",
                      comment.resolved && "opacity-50",
                    )}
                  >
                    <div className="flex items-start gap-1.5 text-xs">
                      <span
                        className="mt-1 size-2 shrink-0 rounded-full"
                        style={{ background: category.color }}
                        title={category.label}
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        title={
                          comment.anchor === null
                            ? "File comment"
                            : line !== null
                              ? `Jump to line ${line}`
                              : orphaned
                                ? "Anchor no longer found"
                                : "Open file"
                        }
                        onClick={() => void jumpTo(file, comment.id)}
                      >
                        <span className="line-clamp-3 break-words text-foreground">
                          {comment.text}
                        </span>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={comment.resolved ? "Reopen" : "Resolve"}
                        onClick={() =>
                          void update(comment.id, { resolved: !comment.resolved })
                        }
                      >
                        <Check
                          className={cn(
                            "size-3",
                            comment.resolved ? "text-success" : "text-muted-foreground",
                          )}
                        />
                      </Button>
                    </div>
                    {/* Edit and delete sit on the meta line so the text
                        keeps the row's full width. */}
                    <div className="mt-0.5 flex items-center pl-3.5 text-2xs text-muted-foreground">
                      <span className="flex-1">
                        {orphaned
                          ? "anchor not found"
                          : comment.anchor === null
                            ? "file"
                            : file === activeFile && line !== null
                              ? `line ${line}`
                              : `line ${comment.anchor.line}`}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                        title="Edit comment"
                        onClick={() =>
                          openCommentDialog({ kind: "edit", id: comment.id })
                        }
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                        title="Delete comment"
                        onClick={() => void remove(comment.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
