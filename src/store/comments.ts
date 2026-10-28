import { create } from "zustand";
import { listComments, saveComments, type Comment } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

interface CommentsState {
  comments: Comment[];
  loaded: boolean;
  /** Load the current project's comments from .polemic/comments.json. */
  load: () => Promise<void>;
  add: (comment: {
    file: string;
    category: string;
    text: string;
    anchor: Comment["anchor"];
    suggestion?: string | null;
  }) => Promise<void>;
  update: (id: string, patch: Partial<Omit<Comment, "id" | "file">>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Resolves the replies to these suggestion notes (accepted or
   *  rejected, or the note deleted). */
  resolveReplies: (file: string, keys: string[]) => Promise<void>;
  /** Moves replies to a note whose text changed. */
  rekeyReplies: (file: string, from: string, to: string) => Promise<void>;
}

/** Persist the whole list (comments.json is small). */
function persist(comments: Comment[]): Promise<void> {
  const { project } = useProjectStore.getState();
  if (!project) return Promise.resolve();
  return saveComments(project.path, comments);
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  comments: [],
  loaded: false,

  load: async () => {
    const { project } = useProjectStore.getState();
    if (!project) return;
    try {
      set({ comments: await listComments(project.path), loaded: true });
    } catch {
      set({ comments: [], loaded: true });
    }
  },

  add: async (comment) => {
    const entry: Comment = {
      id: crypto.randomUUID(),
      file: comment.file,
      category: comment.category,
      text: comment.text,
      createdAt: Date.now(),
      resolved: false,
      anchor: comment.anchor,
      ...(comment.suggestion ? { suggestion: comment.suggestion } : {}),
    };
    const comments = [...get().comments, entry];
    set({ comments });
    await persist(comments);
  },

  update: async (id, patch) => {
    const comments = get().comments.map((comment) =>
      comment.id === id ? { ...comment, ...patch } : comment,
    );
    set({ comments });
    await persist(comments);
  },

  remove: async (id) => {
    const comments = get().comments.filter((comment) => comment.id !== id);
    set({ comments });
    await persist(comments);
  },

  resolveReplies: async (file, keys) => {
    const hit = (c: Comment) =>
      c.file === file && !c.resolved && !!c.suggestion && keys.includes(c.suggestion);
    if (keys.length === 0 || !get().comments.some(hit)) return;
    const comments = get().comments.map((c) => (hit(c) ? { ...c, resolved: true } : c));
    set({ comments });
    await persist(comments);
  },

  rekeyReplies: async (file, from, to) => {
    const hit = (c: Comment) => c.file === file && c.suggestion === from;
    if (from === to || !get().comments.some(hit)) return;
    const comments = get().comments.map((c) => (hit(c) ? { ...c, suggestion: to } : c));
    set({ comments });
    await persist(comments);
  },
}));
