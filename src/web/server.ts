/**
 * The browser build's way to polemic-server: the same origin, signed in
 * with the services app's session cookie. Request and answer shapes
 * follow packages/contracts in dwarsbit/polemic-server.
 */

/** A project as GET /api/projects lists it. */
export interface ServerProject {
  id: string;
  name: string;
  role: "owner" | "editor" | "commenter" | "viewer";
  owner: { id: string; name: string };
  source: "desktop" | "online";
  /** False for commenters and viewers, and for projects published from the desktop app. */
  writable: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A non-2xx answer: the status and the server's `{ error, message }`. */
export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

/** Where the services app signs people in, and brings them back here. */
export function signInUrl(): string {
  const back = window.location.pathname + window.location.search;
  return `/sign-in?next=${encodeURIComponent(back)}`;
}

/** Off to the sign-in page; the promise never settles, the page goes. */
export function goSignIn(): Promise<never> {
  window.location.assign(signInUrl());
  return new Promise<never>(() => {});
}

const UNREACHABLE = "Could not reach Polemic. Check your connection and try again.";

/** A request to the API: JSON in (`json`) and out, or raw bytes out (`bytes`). */
export async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown; bytes?: boolean } = {},
): Promise<T> {
  const { json, bytes, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ServerError(0, "unreachable", UNREACHABLE);
  }
  if (response.status === 401) return goSignIn();
  if (!response.ok) throw await errorOf(response);
  if (response.status === 204) return undefined as T;
  return (bytes ? await response.arrayBuffer() : await response.json()) as T;
}

async function errorOf(response: Response): Promise<ServerError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Not JSON: a proxy's page.
  }
  const retry = Number(response.headers.get("retry-after"));
  return new ServerError(
    response.status,
    typeof body.error === "string" ? body.error : "",
    typeof body.message === "string" && body.message !== ""
      ? body.message
      : `Polemic answered ${response.status}.`,
    body,
    Number.isFinite(retry) && retry > 0 ? retry : null,
  );
}

/** Bytes from the API (assets, compile outputs). */
export async function fetchBytes(
  url: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const buffer = await request<ArrayBuffer>(url, { signal, bytes: true });
  return new Uint8Array(buffer);
}
