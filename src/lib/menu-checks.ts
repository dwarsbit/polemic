import { setMenuChecked } from "@/lib/tauri";

/**
 * Keeps the View menu's checkmarks in step with the window. The editor
 * view registers a function reporting what is shown; the native check
 * items flip themselves when clicked, so every menu action asks for a
 * resync afterwards, even when the click changed nothing.
 */
export type MenuChecks = Record<string, boolean>;

let source: (() => MenuChecks) | null = null;
const last = new Map<string, boolean>();

export function setMenuCheckSource(fn: (() => MenuChecks) | null): void {
  source = fn;
}

/** Push the current checkmarks to the native menu. With force, every
 *  item is sent, not only the ones that changed since the last push. */
export function syncMenuChecks(force = false): void {
  const checks = source?.() ?? {
    face_visual: false,
    face_code: false,
    toggle_sidebar: false,
    toggle_preview: false,
    toggle_right: false,
    issues: false,
    log: false,
  };
  for (const [id, checked] of Object.entries(checks)) {
    if (!force && last.get(id) === checked) continue;
    last.set(id, checked);
    void setMenuChecked(id, checked).catch(() => undefined);
  }
}

/** Resync after a menu click has settled (state updates applied). */
export function resyncMenuChecksSoon(): void {
  setTimeout(() => syncMenuChecks(true), 0);
}
