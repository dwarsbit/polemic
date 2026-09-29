import { StateEffect, RangeSet, StateField, type Text } from "@codemirror/state";
import { GutterMarker, gutter, type EditorView } from "@codemirror/view";
import { resolveAnchor } from "@/lib/comment-anchor";
import { commentCategory } from "@/lib/comment-categories";
import { openCommentDialog } from "@/lib/editor-comments";
import { useCommentsStore } from "@/store/comments";
import { useProjectStore } from "@/store/project";

/** Force a recompute (the comments live outside the editor state). */
export const refreshComments = StateEffect.define<null>();

interface AnchoredComment {
  id: string;
  category: string;
  resolved: boolean;
  line: number;
}

class CommentMarker extends GutterMarker {
  constructor(private readonly comment: AnchoredComment) {
    super();
  }

  override toDOM() {
    const dom = document.createElement("div");
    dom.className = "cm-comment-bar";
    dom.style.background = commentCategory(this.comment.category).color;
    dom.title = commentCategory(this.comment.category).label;
    if (this.comment.resolved) dom.classList.add("resolved");
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openCommentDialog({ kind: "edit", id: this.comment.id });
    });
    return dom;
  }

  override eq(other: CommentMarker): boolean {
    return (
      other.comment.id === this.comment.id && other.comment.resolved === this.comment.resolved
    );
  }
}

/**
 * Comments anchored in the current document (the store is the source
 * of truth; the view dispatches refreshComments whenever it changes).
 */
export function anchoredComments(doc: Text, file: string): AnchoredComment[] {
  const { comments } = useCommentsStore.getState();
  const out: AnchoredComment[] = [];
  for (const comment of comments) {
    if (comment.file !== file || comment.anchor === null) continue;
    const line = resolveAnchor(doc.toString(), comment.anchor);
    if (line === null) continue; // orphaned: shown in the panel
    out.push({
      id: comment.id,
      category: comment.category,
      resolved: comment.resolved,
      line,
    });
  }
  out.sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
  return out;
}

const field = StateField.define<AnchoredComment[]>({
  create: (state) => anchoredComments(state.doc, useProjectStore.getState().activeFile ?? ""),
  update(value, tr) {
    if (tr.docChanged || tr.effects.some((effect) => effect.is(refreshComments))) {
      return anchoredComments(tr.state.doc, useProjectStore.getState().activeFile ?? "");
    }
    return value;
  },
});

/**
 * Colored, clickable comment bars in a dedicated gutter (styled in
 * index.css as .cm-comment-bar).
 */
export const commentGutter = [
  field,
  gutter({
    class: "cm-comment-gutter",
    markers(view: EditorView) {
      const comments = view.state.field(field);
      if (comments.length === 0) return RangeSet.empty;
      return RangeSet.of(
        comments.map((comment) => {
          const line = view.state.doc.line(Math.min(comment.line, view.state.doc.lines));
          return new CommentMarker(comment).range(line.from);
        }),
      );
    },
  }),
];
