/**
 * What the browser build adds around the editor: the address follows
 * the open project (`/projects/<id>`), edits save as you type, and
 * changes from others reach the open file. Started once by App.
 */

import { useCommentsStore } from "@/store/comments";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import {
  closeProject,
  hasUnsyncedChanges,
  onProjectChange,
  projectIdOf,
} from "@/web/projects";

const START = "/projects/";

/** The project the address names, to open at startup. */
export function projectFromAddress(): string | null {
  const path = window.location.pathname;
  return projectIdOf(path) ? path.replace(/\/+$/, "") : null;
}

/** How long typing pauses before the edits are saved. */
const SAVE_DELAY_MS = 800;

export function startWebSession(): () => void {
  const stops: (() => void)[] = [];

  // Changes from others: reload the file tree and the open file, and
  // the comments when theirs (or a reviewer's) changed.
  stops.push(
    onProjectChange((change) => {
      void useProjectStore.getState().syncFromDisk();
      if (change.comments) void useCommentsStore.getState().load();
    }),
  );

  // Saving as you type: a background save after a pause, so the
  // compile and everyone else see the edit.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const save = async () => {
    saveTimer = null;
    const store = useProjectStore.getState();
    if (!store.project || store.project.readOnly) return;
    try {
      await store.flushBuffers();
      await store.saveActiveFile({ background: true });
    } catch {
      // Tried again after the next edit; the tab warns before closing.
    }
  };
  stops.push(
    useEditorStore.subscribe((state, previous) => {
      // A loaded file (docVersion moved) is not an edit.
      if (
        state.content === previous.content ||
        state.docVersion !== previous.docVersion
      )
        return;
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void save(), SAVE_DELAY_MS);
    }),
  );

  // The address and the tab title follow the open project.
  stops.push(
    useProjectStore.subscribe((state, previous) => {
      if (state.project?.path === previous.project?.path) return;
      const want = state.project?.path ?? START;
      if (window.location.pathname !== want) window.history.pushState(null, "", want);
      document.title = state.project ? `${state.project.name} · Polemic` : "Polemic";
      if (!state.project) closeProject();
    }),
  );
  const onPopState = () => {
    const path = projectFromAddress();
    const store = useProjectStore.getState();
    if (path === (store.project?.path ?? null)) return;
    if (path) void store.openProject(path).catch(() => undefined);
    else void store.leaveProject();
  };
  window.addEventListener("popstate", onPopState);
  stops.push(() => window.removeEventListener("popstate", onPopState));

  // Edits still on their way to the server: ask before the tab closes.
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (saveTimer !== null || hasUnsyncedChanges()) event.preventDefault();
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  stops.push(() => window.removeEventListener("beforeunload", onBeforeUnload));

  return () => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    for (const stop of stops) stop();
  };
}
