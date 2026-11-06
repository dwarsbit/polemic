/**
 * The browser build's stand-in for `@tauri-apps/plugin-dialog`. `ask`
 * shows the app's own confirm dialog (ConfirmDialog, mounted by App).
 * The file pickers return paths on this computer, which a browser
 * cannot give: they answer "cancelled", and the features that need
 * them are hidden (`features.localFiles`).
 */

import { useConfirmStore } from "@/store/confirm";

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

export async function open(): Promise<null> {
  return null;
}

export async function save(): Promise<null> {
  return null;
}
