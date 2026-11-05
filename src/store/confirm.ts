import { create } from "zustand";

/** A question for ConfirmDialog, the browser build's `ask`. */
export interface ConfirmRequest {
  message: string;
  title?: string;
  kind?: "info" | "warning" | "error";
  okLabel?: string;
  cancelLabel?: string;
}

interface ConfirmState {
  /** The question on screen, or null. */
  current: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null;
  /** Show a question; resolves true for OK, false for Cancel or Escape.
   *  A new question while one is open cancels the open one. */
  request: (question: ConfirmRequest) => Promise<boolean>;
  answer: (ok: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  current: null,
  request: (question) => {
    get().current?.resolve(false);
    return new Promise<boolean>((resolve) =>
      set({ current: { ...question, resolve } }),
    );
  },
  answer: (ok) => {
    const current = get().current;
    if (!current) return;
    set({ current: null });
    current.resolve(ok);
  },
}));
