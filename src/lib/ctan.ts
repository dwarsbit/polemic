/**
 * The CTAN JSON API client, used by the package manager for
 * discovery. Online by design (local-first checks stay local).
 *
 * The 2.0 API is lean: `/packages?key=…` returns a bare JSON array of
 * matches, each with the package key, display name, and a one-line
 * caption — which is exactly the "what does it do" description. The
 * API has no per-package detail endpoint (those paths redirect to
 * the full list), so the caption is the catalog text we use.
 */

export interface CtanPackage {
  id: string;
  name: string;
  /** One-line description of the package. */
  caption: string | null;
}

interface CtanListEntry {
  key?: string;
  name?: string;
  caption?: string;
}

function parseList(json: unknown): CtanPackage[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((entry) => entry as CtanListEntry)
    .map((entry) => ({
      id: entry.key ?? "",
      name: entry.name ?? entry.key ?? "",
      caption: entry.caption ?? null,
    }))
    .filter((pkg) => pkg.id.length > 0);
}

export async function searchCtan(query: string): Promise<CtanPackage[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const response = await fetch(
    `https://ctan.org/json/2.0/packages?key=${encodeURIComponent(trimmed)}`,
  );
  if (!response.ok) {
    throw new Error(`CTAN search failed: ${response.status}`);
  }
  return parseList(await response.json());
}

/** The CTAN package page, for the Docs button. */
export function ctanPageUrl(id: string): string {
  return `https://ctan.org/pkg/${encodeURIComponent(id)}`;
}
