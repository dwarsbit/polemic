import { create } from "zustand";
import { suggestionAuthor, useSettingsStore } from "@/store/settings";

interface SuggestState {
  /** Suggest mode: edits become suggestions. For this editing session
   *  only, never stored in the project or the settings. */
  enabled: boolean;
  /** A short notice (a refused edit, a missing name); null when none. */
  message: string | null;
  /** Turns suggest mode on or off; on needs a name in Settings. */
  setEnabled: (enabled: boolean) => void;
  /** Shows a notice for a few seconds. */
  flash: (message: string) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useSuggestStore = create<SuggestState>((set, get) => ({
  enabled: false,
  message: null,
  setEnabled: (enabled) => {
    if (enabled && suggestionAuthor(useSettingsStore.getState()) === null) {
      get().flash("Add your name in Settings to suggest changes.");
      useSettingsStore.getState().openSettings("general");
      return;
    }
    set({ enabled });
  },
  flash: (message) => {
    if (timer !== undefined) clearTimeout(timer);
    set({ message });
    timer = setTimeout(() => set({ message: null }), 4000);
  },
}));
