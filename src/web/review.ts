/**
 * Share for review in the browser build: the share_* commands of
 * src/lib/tauri.ts for the open project. The desktop app publishes a
 * folder to a server copy (src-tauri/src/share.rs); here the project
 * already is the server's, so publishing fixes its document as it is
 * now, with the PDF and SyncTeX of this tab's last compile.
 */

import type { PublishedSnapshot } from "@/lib/share";
import type {
  HistoryFiles,
  HistorySnapshot,
  ProjectInvite,
  ProjectMember,
  ProjectMembers,
  ReviewLink,
  ShareError,
  ShareStatus,
} from "@/lib/tauri";
import { readProject, sha256Hex, type FolderEntry } from "@/lib/project-doc";
import {
  edgesSynced,
  project,
  signedInAccount,
  type OpenProject,
} from "@/web/projects";
import { request, ServerError } from "@/web/server";

type Args = Record<string, unknown>;

const shareError = (kind: ShareError["kind"], message: string): ShareError => ({
  kind,
  message,
});

/** A refused share request, as share.rs maps the answers. */
export function shareErrorFor(e: unknown): unknown {
  if (!(e instanceof ServerError)) return e;
  if (e.status === 0) return shareError("unavailable", e.message);
  if (e.status === 402)
    return shareError("planRequired", "Sharing needs a paid plan on this server.");
  if (e.status === 409 && e.code === "review_link_limit") {
    return shareError("limitReached", e.message);
  }
  if (e.status === 404) {
    return shareError(
      "notFound",
      "This project doesn't exist or isn't shared with you.",
    );
  }
  if (e.status === 413 && e.code === "quota_exceeded") {
    return shareError(
      "tooLarge",
      "Your storage is full. Delete files or other projects to make room, or change your plan on your account page.",
    );
  }
  if (e.status === 413) return shareError("tooLarge", e.message);
  if (e.status >= 500) {
    return shareError(
      "unavailable",
      "Sharing is unavailable right now. Try again later.",
    );
  }
  return shareError("failed", e.message);
}

/** Only the owner shares a project; one from the desktop app is shared there. */
function shareable(open: OpenProject): void {
  if (open.info.role !== "owner") {
    throw shareError(
      "failed",
      `Only ${open.info.owner.name} can share this project for review.`,
    );
  }
  publishedHere(open);
}

/** A project published one way from the desktop app is shared there. */
function publishedHere(open: OpenProject): void {
  if (open.info.role === "owner" && open.info.source === "desktop") {
    throw shareError(
      "failed",
      "This project is published from the desktop app. Share it from there.",
    );
  }
}

async function call<T>(path: string, init: Parameters<typeof request>[1] = {}) {
  try {
    return await request<T>(path, init);
  } catch (e) {
    throw shareErrorFor(e);
  }
}

/** Uploads `bytes` as an asset of the project (the server skips one it has). */
async function upload(open: OpenProject, bytes: Uint8Array, type: string) {
  const hash = await sha256Hex(bytes);
  await call(`/api/projects/${open.id}/assets/${hash}`, {
    method: "PUT",
    headers: { "content-type": type },
    body: bytes as Uint8Array<ArrayBuffer>,
  });
  return hash;
}

/** Fixes the project as reviewers see it, with this tab's last PDF. */
async function publish(open: OpenProject, main: string | null) {
  shareable(open);
  await edgesSynced(
    open,
    shareError(
      "unavailable",
      "Your latest edits haven't reached Polemic yet. Check your connection and publish again.",
    ),
  );
  const pdf = open.pdf ? await upload(open, open.pdf, "application/pdf") : null;
  const synctex =
    pdf && open.synctexGz
      ? await upload(open, open.synctexGz, "application/gzip")
      : null;
  return call<PublishedSnapshot>(`/api/projects/${open.id}/snapshots`, {
    method: "POST",
    // The server takes no nulls: an absent field is "none".
    json: {
      main: main ?? undefined,
      pdf: pdf ?? undefined,
      synctex: synctex ?? undefined,
    },
  });
}

/** The server's review page for a link; it must be this site's. */
function checkedUrl(url: unknown): string {
  const parsed = new URL(String(url), window.location.origin);
  if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith("/r/")) {
    throw shareError("failed", "The server sent an unexpected review link.");
  }
  return parsed.href;
}

export const reviewCommands: Record<string, (args: Args) => unknown> = {
  share_status: (args): ShareStatus => {
    const open = project(args);
    publishedHere(open);
    const server = window.location.origin;
    return {
      server,
      signedIn: true,
      link: { server, projectId: open.id, name: open.info.name, twoWay: true },
    };
  },

  share_publish: (args) =>
    publish(project(args), typeof args.main === "string" ? args.main : null),

  share_snapshots: async (args) => {
    const open = project(args);
    const { snapshots } = await call<{ snapshots: PublishedSnapshot[] }>(
      `/api/projects/${open.id}/snapshots`,
    );
    return snapshots;
  },

  share_links: async (args) => {
    const open = project(args);
    const { links } = await call<{ links: ReviewLink[] }>(
      `/api/projects/${open.id}/links`,
    );
    return links;
  },

  share_create_link: async (args) => {
    const open = project(args);
    const made = await call<ReviewLink>(`/api/projects/${open.id}/links`, {
      method: "POST",
      json: { role: args.role, expiresInDays: args.expiresInDays ?? undefined },
    });
    return { ...made, url: checkedUrl(made.url) };
  },

  share_delete_link: (args) =>
    call(
      `/api/projects/${project(args).id}/links/${encodeURIComponent(String(args.linkId))}`,
      {
        method: "DELETE",
      },
    ),

  share_info: (args) => project(args).info,

  share_members: (args) =>
    call<ProjectMembers>(`/api/projects/${project(args).id}/members`),

  share_invite: (args) =>
    call<ProjectInvite>(`/api/projects/${project(args).id}/invites`, {
      method: "POST",
      json: { email: String(args.email ?? "").trim(), role: args.role },
    }),

  share_cancel_invite: (args) =>
    gone(
      call(
        `/api/projects/${project(args).id}/invites/${encodeURIComponent(String(args.inviteId))}`,
        { method: "DELETE" },
      ),
    ),

  share_set_role: (args) =>
    call<ProjectMember>(
      `/api/projects/${project(args).id}/members/${encodeURIComponent(String(args.userId))}`,
      { method: "PATCH", json: { role: args.role } },
    ),

  share_remove_member: (args) =>
    gone(
      call(
        `/api/projects/${project(args).id}/members/${encodeURIComponent(String(args.userId))}`,
        { method: "DELETE" },
      ),
    ),

  share_leave: async (args) => {
    const open = project(args);
    const me = await signedInAccount();
    if (!me) throw shareError("signedOut", "Sign in to your Polemic account first.");
    await gone(
      call(`/api/projects/${open.id}/members/${encodeURIComponent(me.id)}`, {
        method: "DELETE",
      }),
    );
  },

  /** The project as it is now, as the desktop app reads a folder. */
  share_folder: (args): FolderEntry[] => {
    const { texts, assets } = readProject(project(args).doc);
    return [
      ...[...texts].map(([path, { text }]): FolderEntry => ({ path, kind: "text", text })),
      ...[...assets].map(([path, asset]): FolderEntry => ({ path, kind: "asset", ...asset })),
    ];
  },

  share_history: async (args) => {
    const open = project(args);
    const { snapshots } = await call<{ snapshots: HistorySnapshot[] }>(
      `/api/projects/${open.id}/history`,
    );
    return snapshots;
  },

  share_history_files: (args) =>
    aboutSnapshot(
      call<HistoryFiles>(
        `/api/projects/${project(args).id}/history/${encodeURIComponent(String(args.snapshotId))}`,
      ),
    ),

  share_restore: (args) =>
    aboutSnapshot(
      call(
        `/api/projects/${project(args).id}/history/${encodeURIComponent(String(args.snapshotId))}/restore`,
        {
          method: "POST",
          json: Array.isArray(args.paths) ? { paths: args.paths } : {},
        },
      ),
    ),
};

/** A snapshot that is gone, as share.rs says it. */
async function aboutSnapshot<T>(pending: Promise<T>): Promise<T> {
  try {
    return await pending;
  } catch (e) {
    if (isShareErrorOf(e, "notFound")) {
      throw shareError("failed", "This snapshot is no longer kept. Pick a newer one.");
    }
    throw e;
  }
}

/** Someone or something already gone is what a delete asked for. */
async function gone(pending: Promise<unknown>): Promise<void> {
  try {
    await pending;
  } catch (e) {
    if (isShareErrorOf(e, "notFound")) return;
    throw e;
  }
}

const isShareErrorOf = (e: unknown, kind: ShareError["kind"]) =>
  typeof e === "object" && e !== null && (e as ShareError).kind === kind;
