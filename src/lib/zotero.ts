/**
 * The Zotero connection layer: live queries against the Zotero
 * desktop server (localhost:23119, no key — the "app" source) and
 * the Zotero Web API (api.zotero.org with user ID + API key — the
 * "cloud" source). No sync: searches hit Zotero directly and results
 * are converted at insert time (see zotero-convert.ts). The desktop
 * server drops webview requests (they carry an Origin header), so
 * its requests go through the Rust-side zotero_local_fetch command.
 */

import type { ZoteroItemData } from "./zotero-convert";
import { zoteroLocalFetch } from "./tauri";

const WEB_BASE = "https://api.zotero.org";

export interface ZoteroCollection {
  key: string;
  name: string;
}

/** The shape both Zotero APIs return for items. */
interface ZoteroResponseItem {
  data: ZoteroItemData;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", ...init?.headers },
    });
    if (!response.ok) {
      throw new Error(`Zotero request failed (${response.status})`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function itemParams(query: string, collection: string | null, limit: number) {
  const params = new URLSearchParams({ format: "json", limit: String(limit) });
  if (query.trim().length > 0) params.set("q", query.trim());
  const base = params.toString();
  return { params: base, collection };
}

function toItems(payload: unknown): ZoteroItemData[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((entry): entry is ZoteroResponseItem =>
      typeof entry === "object" && entry !== null && "data" in entry,
    )
    .map((entry) => entry.data);
}

// --- Local (desktop Zotero) ------------------------------------------------

/** One GET against the desktop server, through Rust. */
async function localJson(path: string, query: string): Promise<unknown> {
  return JSON.parse(await zoteroLocalFetch(path, query));
}

/** Is the Zotero desktop server reachable? */
export async function zoteroLocalStatus(): Promise<boolean> {
  try {
    await localJson("users/0/items", "limit=1");
    return true;
  } catch {
    return false;
  }
}

export async function zoteroLocalSearch(
  query: string,
  collection: string | null,
): Promise<ZoteroItemData[]> {
  const { params, collection: collectionKey } = itemParams(query, collection, 50);
  const path =
    collectionKey === null
      ? "users/0/items"
      : `users/0/collections/${collectionKey}/items`;
  return toItems(await localJson(path, params));
}

export async function zoteroLocalCollections(): Promise<ZoteroCollection[]> {
  const payload = await localJson("users/0/collections", "v=3");
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((entry): entry is ZoteroResponseItem =>
      typeof entry === "object" && entry !== null && "data" in entry,
    )
    .map((entry) => ({
      key: entry.data.key ?? "",
      name: (entry.data as { name?: string }).name ?? "",
    }))
    .filter((entry) => entry.key.length > 0);
}

// --- Web (cloud) -----------------------------------------------------------

export async function zoteroWebSearch(
  query: string,
  collection: string | null,
  userId: string,
  apiKey: string,
): Promise<ZoteroItemData[]> {
  const { params, collection: collectionKey } = itemParams(query, collection, 50);
  const headers = { "Zotero-API-Key": apiKey, "Zotero-API-Version": "3" };
  const url =
    collectionKey === null
      ? `${WEB_BASE}/users/${userId}/items?${params}`
      : `${WEB_BASE}/users/${userId}/collections/${collectionKey}/items?${params}`;
  return toItems(await fetchJson(url, { headers }));
}

export async function zoteroWebCollections(
  userId: string,
  apiKey: string,
): Promise<ZoteroCollection[]> {
  const headers = { "Zotero-API-Key": apiKey, "Zotero-API-Version": "3" };
  const payload = await fetchJson(`${WEB_BASE}/users/${userId}/collections?v=3`, {
    headers,
  });
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((entry): entry is ZoteroResponseItem =>
      typeof entry === "object" && entry !== null && "data" in entry,
    )
    .map((entry) => ({
      key: entry.data.key ?? "",
      name: (entry.data as { name?: string }).name ?? "",
    }))
    .filter((entry) => entry.key.length > 0);
}

/**
 * Validate an API key: the keys endpoint reports the key's user ID,
 * which is also how we fill in the user ID automatically. Returns
 * null when the key is invalid or the network is unavailable.
 */
export async function zoteroWebValidateKey(
  apiKey: string,
): Promise<{ userID: string; username: string } | null> {
  try {
    const payload = (await fetchJson(`${WEB_BASE}/keys/${apiKey.trim()}`)) as {
      userID?: number;
      username?: string;
    };
    if (payload.userID === undefined) return null;
    return { userID: String(payload.userID), username: payload.username ?? "" };
  } catch {
    return null;
  }
}
