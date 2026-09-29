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
  }) => Promise<void>;
  update: (id: string, patch: Partial<Omit<Comment, "id" | "file">>) => Promise<void>;
  remove: (id: string) => Promise<void>;
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
}));
