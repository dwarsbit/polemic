import { useCallback, useEffect, useState } from "react";
import { type PublishedSnapshot } from "@/lib/share";
import { keepLinks, rememberLink } from "@/lib/review-links";
import {
  isShareError,
  shareCreate,
  shareCreateLink,
  shareDeleteLink,
  shareInfo,
  shareLeave,
  shareLinks,
  shareMembers,
  sharePublish,
  shareSnapshots,
  shareStatus,
  shareStop,
  type AccountProject,
  type ProjectMembers,
  type ReviewLink,
  type ShareError,
  type ShareStatus,
} from "@/lib/tauri";
import { features } from "@/lib/target";
import { useLinkStore, type LinkStatus } from "@/store/link";
import { useProjectStore } from "@/store/project";

export type ShareStep = "sharing" | "syncing" | "publishing";

export const STEP_LABELS: Record<ShareStep, string> = {
  sharing: "Sharing…",
  syncing: "Syncing…",
  publishing: "Publishing…",
};

/** Why the project isn't in sync, in words; null while it is. */
export function syncProblem(status: LinkStatus | null): string | null {
  switch (status?.kind) {
    case undefined:
    case "syncing":
    case "synced":
      return null;
    case "offline":
      return "You're offline. Your changes sync when you're back online.";
    case "signedOut":
      return "Sign in to your Polemic account to keep this project in sync.";
    case "full":
    case "failed":
      return status.message;
  }
}

function toShareError(e: unknown): ShareError {
  if (isShareError(e)) return e;
  return { kind: "failed", message: typeof e === "string" ? e : String(e) };
}

interface ShareState {
  status: ShareStatus;
  /** The account's role and the owner; null while not shared. */
  info: AccountProject | null;
  latest: PublishedSnapshot | null;
  links: ReviewLink[];
  /** Members and invites, for the owner; null for others, or from a server without invites. */
  people: ProjectMembers | null;
}

/**
 * The folder's link, then, when shared, the account's role; for the
 * owner also what was published last, the links and the people.
 */
async function loadShare(dir: string): Promise<ShareState> {
  const status = await shareStatus(dir);
  const none = { status, info: null, latest: null, links: [], people: null };
  if (!status.signedIn || !status.link) return none;
  const info = await shareInfo(dir);
  if (info.role !== "owner") return { ...none, info };
  const [snapshots, links, people] = await Promise.all([
    shareSnapshots(dir),
    shareLinks(dir),
    shareMembers(dir).catch(() => null),
  ]);
  return { status, info, latest: snapshots[0] ?? null, links, people };
}

export function formatShareDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Copies text; false where the clipboard refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sharing of the open project, for the toolbar's popover and the Share
 * dialog. On the desktop, sharing links the folder with a copy on the
 * account's server that syncs both ways (store/link.ts), so the project
 * also opens in the browser. The owner invites people to edit or
 * comment; publishing fixes what reviewers see, with the PDF of the
 * last compile, and the review links open it. Someone invited sees
 * whose project it is and can leave it.
 *
 * Mount it while the popover or dialog is open: each opening loads
 * fresh.
 */
export function useShare() {
  const project = useProjectStore((s) => s.project);
  const mainFile = useProjectStore((s) => s.mainFile);
  const leaveProject = useProjectStore((s) => s.leaveProject);
  const linkStatus = useLinkStore((s) => s.status);

  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [info, setInfo] = useState<AccountProject | null>(null);
  const [people, setPeople] = useState<ProjectMembers | null>(null);
  const [latest, setLatest] = useState<PublishedSnapshot | null>(null);
  const [links, setLinks] = useState<ReviewLink[]>([]);
  /** Addresses of the links made on this device, by link id. */
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [step, setStep] = useState<ShareStep | null>(null);
  const [busy, setBusy] = useState<"link" | "stop" | "leave" | null>(null);
  const [error, setError] = useState<ShareError | null>(null);

  const dir = project?.path ?? null;

  const showLinks = useCallback((projectId: string | undefined, list: ReviewLink[]) => {
    setLinks(list);
    setUrls(
      projectId
        ? keepLinks(
            projectId,
            list.map((l) => l.id),
          )
        : {},
    );
  }, []);

  const show = useCallback(
    (state: ShareState) => {
      setStatus(state.status);
      setInfo(state.info);
      setLatest(state.latest);
      setPeople(state.people);
      // Someone invited sees no links: the owner's addresses stay untouched.
      if (state.info?.role === "owner") {
        showLinks(state.status.link?.projectId, state.links);
      } else {
        setLinks([]);
        setUrls({});
      }
    },
    [showLinks],
  );

  const refresh = useCallback(async () => {
    if (dir) show(await loadShare(dir));
  }, [dir, show]);

  useEffect(() => {
    if (!dir) return;
    let live = true;
    loadShare(dir)
      .then((state) => live && show(state))
      .catch(async (e) => {
        if (!live) return;
        setError(toShareError(e));
        // A server copy deleted elsewhere: the link is gone; show that state.
        const status = await shareStatus(dir).catch(() => null);
        if (live) setStatus(status);
      });
    return () => {
      live = false;
    };
  }, [dir, show]);

  /** Runs an action, showing its error; undefined when it failed. */
  async function attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await action();
    } catch (e) {
      setError(toShareError(e));
      await refresh().catch(() => {});
      return undefined;
    }
  }

  /** Links the folder with a server copy that syncs both ways. */
  async function linkFolder() {
    if (!dir || !project) return;
    setStep("sharing");
    await shareCreate(dir, project.name);
    await useLinkStore.getState().start(dir);
    await refresh();
  }

  const share = () =>
    attempt(async () => {
      try {
        await linkFolder();
      } finally {
        setStep(null);
      }
    });

  async function publishNow() {
    if (!dir || !project) return;
    try {
      // The browser's project is the server's: nothing to sync first.
      if (features.localFiles) {
        if (status?.link) {
          setStep("syncing");
          await useLinkStore.getState().syncNow();
        } else {
          await linkFolder();
        }
        const synced = useLinkStore.getState().status;
        if (synced?.kind !== "synced") {
          throw {
            kind: synced?.kind === "signedOut" ? "signedOut" : "failed",
            message: `Your latest changes haven't synced yet, so they can't be published. ${syncProblem(synced) ?? "Try again in a moment."}`,
          } satisfies ShareError;
        }
      }
      setStep("publishing");
      setLatest(await sharePublish(dir, mainFile));
    } finally {
      setStep(null);
    }
  }

  const publish = () =>
    attempt(async () => {
      await publishNow();
      await refresh();
    });

  /** Makes a review link, publishing first when nothing is published yet. */
  const createLink = (role: ReviewLink["role"], expiresInDays: number | null) =>
    attempt(async () => {
      if (!dir) return undefined;
      setBusy("link");
      try {
        if (latest === null) await publishNow();
        const made = await shareCreateLink(dir, role, expiresInDays);
        // After a first publish from an unshared folder, the link is new.
        const projectId =
          status?.link?.projectId ?? (await shareStatus(dir)).link?.projectId;
        if (made.url && projectId) rememberLink(projectId, made.id, made.url);
        showLinks(projectId, await shareLinks(dir));
        return made;
      } finally {
        setBusy(null);
      }
    });

  const deleteLink = (id: string) =>
    attempt(async () => {
      if (!dir) return;
      await shareDeleteLink(dir, id);
      showLinks(status?.link?.projectId, await shareLinks(dir));
    });

  const stop = () =>
    attempt(async () => {
      if (!dir) return;
      setBusy("stop");
      try {
        useLinkStore.getState().stop();
        await shareStop(dir);
        await refresh();
      } finally {
        setBusy(null);
      }
    });

  /** Someone invited leaves: the server copy stays the owner's; the folder stays as it is. */
  const leave = () =>
    attempt(async () => {
      if (!dir) return;
      setBusy("leave");
      try {
        useLinkStore.getState().stop();
        await shareLeave(dir);
        // In the browser the project was the server's: back to the list.
        if (!features.localFiles) {
          await leaveProject();
          return;
        }
        await refresh();
      } finally {
        setBusy(null);
      }
    });

  const shared = status?.link != null;
  const invited = shared && info !== null && info.role !== "owner";

  return {
    dir,
    status,
    info,
    people,
    setPeople,
    latest,
    links,
    urls,
    step,
    busy,
    error,
    linkStatus,
    loading: status === null && error === null,
    signedOut: status !== null && (!status.signedIn || error?.kind === "signedOut"),
    shared,
    /** Before sharing, the folder is this account's to share. */
    owner: !shared || info?.role === "owner",
    invited,
    accountPage: status ? `${status.server}/account` : null,
    /** The project in the browser; null on the web, where it is open there. */
    projectPage:
      features.localFiles && status?.link
        ? `${status.server}/projects/${status.link.projectId}`
        : null,
    attempt,
    share,
    publish,
    createLink,
    deleteLink,
    stop,
    leave,
  };
}

export type Share = ReturnType<typeof useShare>;
