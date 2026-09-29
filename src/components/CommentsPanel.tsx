import { useMemo, useState } from "react";
import { Check, MessageSquareOff, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolveAnchor } from "@/lib/comment-anchor";
import { commentCategory } from "@/lib/comment-categories";
import { openCommentDialog } from "@/lib/editor-comments";
import { useEditorStore } from "@/store/editor";
import { useCommentsStore } from "@/store/comments";
import { useProjectStore } from "@/store/project";
import { cn } from "cn";

export function CommentsPanel() {
  const comments = useCommentsStore((s) => s.comments);
  const update = useCommentsStore((s) => s.update);
  const remove = useCommentsStore((s) => s.remove);
  const activeFile = useProjectStore((s) => s.activeFile);

  const [hideResolved, setHideResolved] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  /** The anchored line for a comment, or null when orphaned. */
  function lineOf(comment: { anchor: { text: string; line: number } | null }): number | null {
    if (comment.anchor === null) return null;
    if (comment.anchor.text === "") return null;
    return resolveAnchor(useEditorStore.getState().content, comment.anchor);
  }

  const shown = useMemo(
    () =>
      comments.filter(
        (comment) =>
          (!hideResolved || !comment.resolved) &&
          (categoryFilter === null || comment.category === categoryFilter),
      ),
    [comments, hideResolved, categoryFilter],
  );

  // Group by file: active file first, then others that exist in the tree.
  const byFile = useMemo(() => {
    const groups = new Map<string, typeof shown>();
    for (const comment of shown) {
      const list = groups.get(comment.file) ?? [];
      list.push(comment);
      groups.set(comment.file, list);
    }
    const names = [...groups.keys()].sort((a, b) =>
      a === activeFile ? -1 : b === activeFile ? 1 : a.localeCompare(b),
    );
    return names.map((file) => ({ file, items: groups.get(file)! }));
  }, [shown, activeFile]);

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

  if (comments.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <MessageSquareOff className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          No comments yet. Right-click in the editor to add one.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <Button
          variant={hideResolved ? "default" : "outline"}
          size="xs"
          onClick={() => setHideResolved((value) => !value)}
          title="Hide or show resolved comments"
        >
          <Check />
          Hide resolved
        </Button>
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
        {[...new Set(comments.map((comment) => comment.category))].map((id) => {
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
      </div>
      <div className="flex flex-col gap-3 p-2">
        {byFile.map(({ file, items }) => (
          <div key={file}>
            <p className="mb-1 truncate px-1 text-xs font-medium text-muted-foreground">
              {file}
            </p>
            <div className="flex flex-col gap-1.5">
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
                    <div className="flex items-center gap-1.5 text-xs">
                      <span
                        className="size-2 shrink-0 rounded-full"
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
                        <span className="block truncate text-foreground">
                          {comment.text}
                        </span>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={comment.resolved ? "Mark unresolved" : "Mark resolved"}
                        onClick={() =>
                          void update(comment.id, { resolved: !comment.resolved })
                        }
                      >
                        <Check
                          className={cn(
                            "size-3",
                            comment.resolved
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground",
                          )}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 group-hover:opacity-100"
                        title="Edit comment"
                        onClick={() => openCommentDialog({ kind: "edit", id: comment.id })}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 group-hover:opacity-100"
                        title="Delete comment"
                        onClick={() => void remove(comment.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                    <p className="mt-0.5 pl-3.5 text-[10px] text-muted-foreground">
                      {orphaned
                        ? "anchor not found"
                        : comment.anchor === null
                          ? "file"
                          : file === activeFile && line !== null
                            ? `line ${line}`
                            : `line ${comment.anchor.line}`}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
