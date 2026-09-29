type FormatHandler = () => boolean;

let handler: FormatHandler | null = null;

/** Called by the editor component to serve format requests. */
export function setFormatDocumentHandler(h: FormatHandler | null) {
  handler = h;
}

/**
 * Format the active document. Returns true when the document changed.
 * No-op when no project file is open or the editor is not mounted.
 */
export function formatDocument(): boolean {
  return handler?.() ?? false;
}
