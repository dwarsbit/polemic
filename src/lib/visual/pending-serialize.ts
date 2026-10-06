/**
 * The visual face serializes its document to TeX on a debounce, so
 * the store copy can lag a few hundred milliseconds behind the
 * editor. Paths that must not read a lagging store — saving,
 * flushing buffers, leaving the face — call the flush first. The
 * registry pattern is editor-insert's.
 */

type FlushHandler = () => void;

let handler: FlushHandler | null = null;

/** Register the active face's flush; returns the previous one. */
export function setPendingSerializeFlush(h: FlushHandler | null): FlushHandler | null {
  const prev = handler;
  handler = h;
  return prev;
}

/** Serialize pending visual edits into the store, now. */
export function flushPendingSerialize(): void {
  handler?.();
}
