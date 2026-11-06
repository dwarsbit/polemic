/**
 * The browser build's stand-in for `@tauri-apps/api/core` (aliased in
 * vite.config.ts for `--mode web`). src/lib/tauri.ts keeps calling
 * `invoke` with the desktop command names; here each name maps to a
 * browser handler. Commands without one reject the way a failing Tauri
 * command does: with a message string.
 */

import { projectCommands } from "@/web/projects";
import { settingsCommands } from "@/web/settings";

/** Why a command fails in the browser. Shown to the user as is. */
export const NOT_AVAILABLE = "This isn't available in your browser yet.";

type Handler = (args: Record<string, unknown>) => unknown;

/** Desktop features with nothing to do in the browser; their panels are hidden. */
const nothing: Record<string, Handler> = {
  list_snapshots: () => [],
  git_available: () => false,
  set_project_menu_enabled: () => undefined,
  set_menu_checked: () => undefined,
};

const commands: Record<string, Handler> = {
  ...settingsCommands,
  ...projectCommands,
  ...nothing,
};

export async function invoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const handler = commands[cmd];
  if (!handler) throw NOT_AVAILABLE;
  try {
    return (await handler(args)) as T;
  } catch (e) {
    // As from Tauri: the message alone (compile errors stay objects).
    if (e instanceof Error && e.name !== "AbortError") throw e.message;
    throw e;
  }
}

/** Tauri's message channel from Rust; nothing sends on it in the browser. */
export class Channel<T = unknown> {
  onmessage: (message: T) => void = () => {};
}
