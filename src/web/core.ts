/**
 * The browser build's stand-in for `@tauri-apps/api/core` (aliased in
 * vite.config.ts for `--mode web`). src/lib/tauri.ts keeps calling
 * `invoke` with the desktop command names; here each name maps to a
 * browser handler. Commands without one reject the way a failing Tauri
 * command does: with a message string.
 */

import { settingsCommands } from "@/web/settings";

/** Why a command fails in the browser. Shown to the user as is. */
export const NOT_AVAILABLE = "This isn't available in your browser yet.";

type Handler = (args: Record<string, unknown>) => unknown;

const commands: Record<string, Handler> = {
  ...settingsCommands,
  // No templates until projects can be created online.
  list_templates: () => [],
};

export async function invoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const handler = commands[cmd];
  if (!handler) throw NOT_AVAILABLE;
  return (await handler(args)) as T;
}

/** Tauri's message channel from Rust; nothing sends on it in the browser. */
export class Channel<T = unknown> {
  onmessage: (message: T) => void = () => {};
}
