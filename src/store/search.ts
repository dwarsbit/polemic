import { create } from "zustand";

export type SearchScope = "all" | "math" | "text";

interface SearchState {
  query: string;
  caseSensitive: boolean;
  scope: SearchScope;
  setQuery: (query: string) => void;
  toggleCase: () => void;
  setScope: (scope: SearchScope) => void;
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
}));
