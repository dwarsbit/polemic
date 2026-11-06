import { create } from "zustand";

/** Someone else in the open project (the browser build's live sync). */
export interface Peer {
  /** Their connection; one person in two tabs is two peers. */
  clientId: number;
  /** Their account, as the server vouches for it. */
  userId: string;
  name: string;
  color: string;
  /** The file they have open, or null. */
  file: string | null;
  /** Their cursor in that file, as offsets into `text`; null when unknown. */
  selection: { anchor: number; head: number } | null;
  /** The file's text the offsets point into. */
  text: string | null;
}

interface PresenceState {
  peers: Peer[];
}

/** Who else is in the open project. Empty on the desktop. */
export const usePresenceStore = create<PresenceState>(() => ({ peers: [] }));

type Reporter = (
  file: string | null,
  selection: { anchor: number; head: number; text: string } | null,
) => void;

let reporter: Reporter | null = null;

/** Set by the platform that shares presence (the browser build). */
export function setPresenceReporter(r: Reporter | null): void {
  reporter = r;
}

/** Where this window's cursor is: offsets into `text`, the editor's text of `file`. */
export function reportPresence(
  file: string | null,
  selection: { anchor: number; head: number; text: string } | null,
): void {
  reporter?.(file, selection);
}
