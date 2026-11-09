import { create } from "zustand";
import { accountStatus, type AccountStatus } from "@/lib/tauri";

interface AccountState {
  /** null until first asked. */
  status: AccountStatus | null;
  setStatus: (status: AccountStatus) => void;
  /** Asks again who is signed in; a failure keeps what is known. */
  refresh: () => Promise<void>;
}

/** Who is signed in to Polemic, for the toolbar's avatar. Settings keeps it current. */
export const useAccountStore = create<AccountState>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
  refresh: async () => {
    try {
      set({ status: await accountStatus() });
    } catch {
      // Not worth an error in the toolbar.
    }
  },
}));
