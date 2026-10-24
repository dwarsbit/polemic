import { create } from "zustand";
import type { SearchScope } from "@/lib/project-search";

export type { SearchScope };

interface SearchState {
  query: string;
  caseSensitive: boolean;
  scope: SearchScope;
  /** The replace row is open. */
  replaceOpen: boolean;
  replacement: string;
  setQuery: (query: string) => void;
  toggleCase: () => void;
  setScope: (scope: SearchScope) => void;
  toggleReplace: () => void;
  setReplacement: (replacement: string) => void;
}

/** Project-search settings, kept in the store so the query survives
 *  switching the bottom dock to another tool and back. */
export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  caseSensitive: false,
  scope: "all",
  setQuery: (query) => set({ query }),
  toggleCase: () => set((s) => ({ caseSensitive: !s.caseSensitive })),
  setScope: (scope) => set({ scope }),
  replaceOpen: false,
  replacement: "",
  toggleReplace: () => set((s) => ({ replaceOpen: !s.replaceOpen })),
  setReplacement: (replacement) => set({ replacement }),
}));
