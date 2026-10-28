import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import type { AuthorStyle } from "@/lib/changes-view";
import { openCommentDialog } from "@/lib/editor-comments";
import { useProjectStore } from "@/store/project";
import {
  changeAt,
  resolveVisualChange,
  setVisualNote,
  type VisualChange,
} from "@/lib/visual/track-changes";

const KIND_LABEL = { added: "Added", deleted: "Deleted", replaced: "Replaced" };

interface Hovered {
  change: VisualChange;
  left: number;
  top: number;
}

/**
 * The Visual view's hover card for a suggestion: author, kind, note,
 * Accept and Reject. It follows the pointer over `.vis-change` spans
 * inside `container` and stays while the pointer is on the card.
 */
export function VisualChangeCard({
  editor,
  container,
  styles,
}: {
  editor: Editor;
  container: HTMLElement | null;
  styles: Map<string | null, AuthorStyle>;
}) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (container === null) return;
    const cancelHide = () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
    const onMove = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest(
        ".vis-ins, .vis-del",
      );
      if (!target || editor.isDestroyed) {
        if (hideTimer.current === null) {
          hideTimer.current = setTimeout(() => setHovered(null), 300);
        }
        return;
      }
      cancelHide();
      const pos = editor.view.posAtDOM(target, 0);
      const change = changeAt(editor.state, pos);
      if (change === null) return;
      const rect = target.getBoundingClientRect();
      setHovered((prev) =>
        prev !== null && prev.change.runs[0].from === change.runs[0].from
          ? prev
          : { change, left: rect.left, top: rect.top },
      );
    };
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", () => {
      if (hideTimer.current === null) {
        hideTimer.current = setTimeout(() => setHovered(null), 300);
      }
    });
    return () => {
      cancelHide();
      container.removeEventListener("mousemove", onMove);
    };
  }, [container, editor]);

  // Any edit moves the text under the card: drop it.
  useEffect(() => {
    const hide = () => setHovered(null);
    editor.on("update", hide);
    return () => {
      editor.off("update", hide);
    };
  }, [editor]);

  if (hovered === null) return null;
  const { change } = hovered;
  const style = styles.get(change.author);
  const resolve = (how: "accept" | "reject") => {
    resolveVisualChange(editor.view, change, how);
    setHovered(null);
    editor.commands.focus();
  };
  return (
    <div
      className="fixed z-40 w-max max-w-80 -translate-y-full rounded-xl border bg-card p-2 text-xs shadow-sm"
      style={{ left: hovered.left, top: hovered.top - 4 }}
      data-change-card
      onMouseEnter={() => {
        if (hideTimer.current !== null) clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }}
      onMouseLeave={() => setHovered(null)}
    >
      <div className="flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: style?.color }} />
        <span className="font-medium">
          {style?.name ?? change.author ?? "Unknown author"}
        </span>
        <span className="text-muted-foreground">{KIND_LABEL[change.kind]}</span>
      </div>
      {change.note !== null && (
        <p className="mt-1 whitespace-pre-wrap">{change.note}</p>
      )}
      <div className="mt-1.5 flex gap-1">
        <Button
          variant="outline"
          size="xs"
          title="A note on this suggestion, shown in the Comments panel"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const file = useProjectStore.getState().activeFile;
            setHovered(null);
            if (file === null) return;
            openCommentDialog({
              kind: "note",
              file,
              at: null,
              note: change.note,
              author: change.author,
              apply: (note) => setVisualNote(editor.view, change, note),
            });
          }}
        >
          {change.note === null ? "Note" : "Edit note"}
        </Button>
        <Button
          variant="outline"
          size="xs"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => resolve("accept")}
        >
          Accept
        </Button>
        <Button
          variant="outline"
          size="xs"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => resolve("reject")}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
