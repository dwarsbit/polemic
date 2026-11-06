/**
 * The browser build's stand-in for `@tauri-apps/plugin-dialog`. `ask`
 * shows the app's own confirm dialog (ConfirmDialog, mounted by App).
 * `open` picks files with the browser's file input and answers names
 * that stand for them (src/web/uploads.ts), which the commands that
 * take files, like import_assets, read. A browser can't pick folders
 * or a place to save, so those answer "cancelled" and the features
 * that need them are hidden (`features.localFiles`).
 */

import { useConfirmStore } from "@/store/confirm";
import { pickFiles, rememberFile } from "@/web/uploads";

export interface AskOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
  okLabel?: string;
  cancelLabel?: string;
}

export function ask(
  message: string,
  options: AskOptions | string = {},
): Promise<boolean> {
  const opts = typeof options === "string" ? { title: options } : options;
  return useConfirmStore.getState().request({ message, ...opts });
}

export const confirm = ask;

export interface OpenOptions {
  multiple?: boolean;
  directory?: boolean;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

export async function open(
  options: OpenOptions = {},
): Promise<string | string[] | null> {
  if (options.directory) return null;
  const accept = (options.filters ?? [])
    .flatMap((filter) => filter.extensions)
    .map((ext) => `.${ext}`)
    .join(",");
  const files = await pickFiles({ multiple: options.multiple ?? false, accept });
  if (files.length === 0) return null;
  const picked = files.map(rememberFile);
  return options.multiple ? picked : picked[0];
}

export async function save(): Promise<null> {
  return null;
}
