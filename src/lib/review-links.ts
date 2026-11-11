/**
 * Review link addresses, kept on this device. The server shows a
 * link's address only when the link is made, so the app remembers the
 * ones made here and can copy them again; a link made on another
 * device has no address here.
 */

const KEY = "polemic.reviewLinks";

/** Project id → link id → address. */
type Stored = Record<string, Record<string, string>>;

function read(): Stored {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return typeof value === "object" && value !== null ? (value as Stored) : {};
  } catch {
    return {};
  }
}

function write(stored: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // No storage: the link can still be copied until the app closes.
  }
}

export function rememberLink(projectId: string, linkId: string, url: string): void {
  const stored = read();
  stored[projectId] = { ...stored[projectId], [linkId]: url };
  write(stored);
}

/** Drops the addresses of links the project no longer has; returns the rest. */
export function keepLinks(
  projectId: string,
  linkIds: string[],
): Record<string, string> {
  const stored = read();
  const known = stored[projectId] ?? {};
  const kept = Object.fromEntries(
    Object.entries(known).filter(([id]) => linkIds.includes(id)),
  );
  if (Object.keys(kept).length === Object.keys(known).length) return known;
  if (Object.keys(kept).length > 0) stored[projectId] = kept;
  else delete stored[projectId];
  write(stored);
  return kept;
}
