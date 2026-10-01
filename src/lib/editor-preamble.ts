/**
 * \usepackage removal, served by the mounted editor (the same
 * handler pattern as editor-insert). The pure planning lives in
 * packages.ts; the handler applies the edit to the live view.
 */

type RemoveUsepackageHandler = (name: string) => boolean;

let handler: RemoveUsepackageHandler | null = null;

/** Called by the editor component to serve removal requests. */
export function setRemoveUsepackageHandler(h: RemoveUsepackageHandler | null) {
  handler = h;
}

/**
 * Remove the \usepackage that loads `name` from the open document.
 * Returns true when the document changed. No-op when the editor is
 * not mounted.
 */
export function removeUsepackage(name: string): boolean {
  return handler?.(name) ?? false;
}
