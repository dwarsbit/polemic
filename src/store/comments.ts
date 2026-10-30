import { create } from "zustand";
import { listComments, saveComments, type Comment } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

interface CommentsState {
  comments: Comment[];
  loaded: boolean;
  /** Load the current project's comments from .polemic/comments/. */
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

/** The tail of the save queue: saves run one at a time, in call order. */
let saving: Promise<void> = Promise.resolve();

/** Persist the whole list (one small file per comment). Queued behind the
 *  saves before it, so an older list never lands on disk last. */
function persist(comments: Comment[]): Promise<void> {
  const { project } = useProjectStore.getState();
  if (!project) return Promise.resolve();
  const save = saving.then(() => saveComments(project.path, comments));
  saving = save.catch(() => {});
  return save;
}

/** The load in flight, if any. Changes wait for it, so they apply on top
 *  of the loaded list rather than being overwritten by it, and their save
 *  does not drop comments the list was missing. */
let loading: Promise<void> | null = null;
let loads = 0;

export const useCommentsStore = create<CommentsState>((set, get) => ({
  comments: [],
  loaded: false,

  load: () => {
    const { project } = useProjectStore.getState();
    if (!project) return Promise.resolve();
    const run = ++loads;
    loading = (async () => {
      let comments: Comment[];
      try {
        comments = await listComments(project.path);
      } catch {
        comments = [];
      }
      if (run === loads) loading = null;
      // Another project opened meanwhile: these comments are not its.
      if (useProjectStore.getState().project?.path !== project.path) return;
      set({ comments, loaded: true });
    })();
    return loading;
  },

  add: async (comment) => {
    if (loading) await loading;
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
    if (loading) await loading;
    const comments = get().comments.map((comment) =>
      comment.id === id ? { ...comment, ...patch } : comment,
    );
    set({ comments });
    await persist(comments);
  },

  remove: async (id) => {
    if (loading) await loading;
    const comments = get().comments.filter((comment) => comment.id !== id);
    set({ comments });
    await persist(comments);
  },

  resolveReplies: async (file, keys) => {
    if (loading) await loading;
    const hit = (c: Comment) =>
      c.file === file && !c.resolved && !!c.suggestion && keys.includes(c.suggestion);
    if (keys.length === 0 || !get().comments.some(hit)) return;
    const comments = get().comments.map((c) => (hit(c) ? { ...c, resolved: true } : c));
    set({ comments });
    await persist(comments);
  },

  rekeyReplies: async (file, from, to) => {
    if (loading) await loading;
    const hit = (c: Comment) => c.file === file && c.suggestion === from;
    if (from === to || !get().comments.some(hit)) return;
    const comments = get().comments.map((c) => (hit(c) ? { ...c, suggestion: to } : c));
    set({ comments });
    await persist(comments);
  },
}));
