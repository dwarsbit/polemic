/**
 * Presence in the browser build: who else has the open project open,
 * which file they're in and where their cursor is. It travels as
 * awareness on the project's sync connection; the server sets who each
 * state belongs to (`user`), so nobody shows up under another name.
 * Cursors are relative positions in the file's Y.Text, so they stay
 * put while others type.
 */

import type { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { carryOffset, textAt } from "@/lib/project-doc";
import { setPresenceReporter, usePresenceStore, type Peer } from "@/store/presence";
import { onProjectConnect, signedInAccount, type OpenProject } from "@/web/projects";

type Awareness = NonNullable<HocuspocusProvider["awareness"]>;

/** What this tab shares. */
interface LocalPresence {
  file: string | null;
  cursor: { anchor: unknown; head: unknown } | null;
}

/** Cursor colors, picked by account so a person keeps theirs. */
const COLORS = [
  "#d6336c",
  "#1c7ed6",
  "#0ca678",
  "#e8590c",
  "#7048e8",
  "#1098ad",
  "#ae3ec9",
  "#5c940d",
];

export function colorFor(id: string): string {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

function resolve(doc: Y.Doc, ytext: Y.Text, json: unknown): number | null {
  try {
    const position = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(json),
      doc,
    );
    return position && position.type === ytext ? position.index : null;
  } catch {
    return null;
  }
}

/** Everyone in the project but this tab and the account's other tabs. */
export function peersOf(
  open: OpenProject,
  awareness: Awareness,
  selfId: string | null,
): Peer[] {
  const peers: Peer[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue;
    const user = state.user as { id?: unknown; name?: unknown } | undefined;
    const userId = typeof user?.id === "string" ? user.id : `client-${clientId}`;
    if (userId === selfId) continue;
    const name =
      typeof user?.name === "string" && user.name !== "" ? user.name : "Someone";
    const file = typeof state.file === "string" ? state.file : null;
    let selection: Peer["selection"] = null;
    let text: string | null = null;
    const cursor = state.cursor as LocalPresence["cursor"] | undefined;
    const ytext = file ? textAt(open.doc, file) : null;
    if (ytext && cursor) {
      const anchor = resolve(open.doc, ytext, cursor.anchor);
      const head = resolve(open.doc, ytext, cursor.head);
      if (anchor !== null && head !== null) {
        selection = { anchor, head };
        text = ytext.toString();
      }
    }
    peers.push({
      clientId,
      userId,
      name,
      color: colorFor(userId),
      file,
      selection,
      text,
    });
  }
  return peers.sort((a, b) => a.name.localeCompare(b.name) || a.clientId - b.clientId);
}

/** Shares presence for whichever project is open; returns a stop. */
export function startPresence(): () => void {
  let target: { open: OpenProject; awareness: Awareness } | null = null;
  let sent = "";
  let detach = () => {};

  const attach = (open: OpenProject) => {
    const awareness = open.provider.awareness;
    if (!awareness) return () => {};
    target = { open, awareness };
    sent = "";
    let selfId: string | null = null;
    let frame = 0;
    const refresh = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        usePresenceStore.setState({ peers: peersOf(open, awareness, selfId) });
      });
    };
    void signedInAccount().then((account) => {
      selfId = account?.id ?? null;
      refresh();
    });
    awareness.on("change", refresh);
    // Their cursors move with the text as it changes.
    open.doc.on("update", refresh);
    refresh();
    return () => {
      awareness.off("change", refresh);
      open.doc.off("update", refresh);
      cancelAnimationFrame(frame);
      target = null;
      usePresenceStore.setState({ peers: [] });
    };
  };

  const stopConnect = onProjectConnect((open) => {
    detach();
    detach = open ? attach(open) : () => {};
  });

  setPresenceReporter((file, selection) => {
    if (!target) return;
    const { open, awareness } = target;
    const state: LocalPresence = { file, cursor: null };
    const ytext = file ? textAt(open.doc, file) : null;
    if (ytext && selection) {
      // The editor may hold edits the document doesn't have yet.
      const live = ytext.toString();
      const position = (offset: number) =>
        Y.relativePositionToJSON(
          Y.createRelativePositionFromTypeIndex(
            ytext,
            carryOffset(selection.text, live, offset),
          ),
        );
      state.cursor = {
        anchor: position(selection.anchor),
        head: position(selection.head),
      };
    }
    const json = JSON.stringify(state);
    if (json === sent) return;
    sent = json;
    awareness.setLocalState(state);
  });

  return () => {
    stopConnect();
    detach();
    setPresenceReporter(null);
  };
}
