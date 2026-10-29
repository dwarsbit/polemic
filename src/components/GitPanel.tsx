import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileDiff,
  GitBranch,
  Minus,
  Plus,
  RefreshCcw,
  Undo2,
} from "lucide-react";
import { GitDiffDialog } from "@/components/GitDiffDialog";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  gitAbortMerge,
  gitCommit,
  gitFetch,
  gitInit,
  gitMarkResolved,
  gitPull,
  gitPush,
  gitResolveConflict,
  gitSetRemote,
  gitStage,
  gitStatus,
  gitUnstage,
  HOSTING_NAMES,
  publishTo,
  type Hosting,
  suggestedRepoName,
  type GitEntry,
  type GitStatus,
} from "@/lib/tauri";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

const MERGE_MESSAGE = "Merge remote changes";

function codeLabel(code: string): string {
  switch (code) {
    case "M":
      return "M";
    case "A":
      return "A";
    case "D":
      return "D";
    case "R":
      return "R";
    case "C":
      return "C";
    case "?":
      return "?";
    default:
      return "·";
  }
}

function statusWord(entry: GitEntry): string {
  if (entry.x === "?") return "untracked";
  if (entry.x !== " ") return "staged";
  return "modified";
}

function entryColor(entry: GitEntry): string {
  if (entry.x === "?") return "text-muted-foreground";
  if (entry.x !== " ") return "text-success";
  return "text-info";
}

/** The remote as the panel names it: host and path, no scheme or .git. */
export function remoteLabel(url: string): string {
  return url
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/\.git$/, "");
}

/** What a pull, push or fetch reports in the panel. */
export function syncNotice(
  kind: "fetched" | "pushed" | "upToDate" | "updated" | "conflicts",
  count = 0,
): string {
  switch (kind) {
    case "fetched":
      return "Fetched.";
    case "pushed":
      return "Pushed.";
    case "upToDate":
      return "Already up to date.";
    case "updated":
      return "Updated from the remote.";
    case "conflicts":
      return `Both sides changed ${count === 1 ? "one file" : `${count} files`}: fix the marked lines, mark each file resolved, then commit.`;
  }
}

export function GitPanel() {
  const project = useProjectStore((s) => s.project);
  const openFile = useProjectStore((s) => s.openFile);
  const syncFromDisk = useProjectStore((s) => s.syncFromDisk);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [diffTarget, setDiffTarget] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ["git-status", project?.path],
    queryFn: () => gitStatus(project!.path),
    enabled: project !== null,
    refetchOnWindowFocus: true,
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["git-status"] });
    await queryClient.invalidateQueries({ queryKey: ["git-log"] });
    // HEAD changed (commit): editor change bars need a recompute; the
    // ignored list can change when a repo is initialized.
    await queryClient.invalidateQueries({ queryKey: ["git-head"] });
    await queryClient.invalidateQueries({ queryKey: ["git-ignored"] });
  }

  /** Run an action, then refresh; false (with the error shown) on failure. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }

  /** A remote operation: the buttons wait, the files refresh after. */
  async function sync(
    kind: NonNullable<Busy>,
    action: () => Promise<string>,
  ): Promise<boolean> {
    setBusy(kind);
    try {
      let message = "";
      const ok = await run(async () => {
        message = await action();
      });
      // run() clears the notice first; set it after.
      if (ok) setNotice(message);
      return ok;
    } finally {
      setBusy(null);
      // A pull changes files on disk; the editor picks them up.
      if (kind === "pull") await syncFromDisk();
    }
  }

  const staged = (status?.entries ?? []).filter(
    (entry) => entry.x !== " " && entry.x !== "?",
  );
  // Unstaged and untracked entries; a path can appear in both lists
  // (e.g. staged and then edited again).
  const unstaged = (status?.entries ?? []).filter(
    (entry) => entry.x === "?" || entry.y !== " ",
  );
  const conflicts = status?.conflicts ?? [];
  const merging = status?.merging ?? false;
  const hasStaged = staged.length > 0;
  // A merge commits once every conflict is marked resolved; its message
  // has a default.
  const canCommit =
    conflicts.length === 0 && (merging ? true : hasStaged && message.trim() !== "");

  function commit() {
    const msg = message.trim() || (merging ? MERGE_MESSAGE : "");
    if (!msg) return;
    setMessage("");
    void run(async () => {
      await gitCommit(project!.path, msg);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        label="Git"
        actions={
          <div className="flex items-center gap-0.5">
            {status?.branch && (
              <span className="mr-1 flex items-center gap-1 text-2xs text-muted-foreground">
                <GitBranch className="size-3" />
                {status.branch}
                {(status.ahead > 0 || status.behind > 0) && (
                  <span>
                    {" "}
                    ↑{status.ahead} ↓{status.behind}
                  </span>
                )}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title="Refresh git status"
              onClick={() => void refresh()}
            >
              <RefreshCcw className="size-3.5" />
            </Button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-1.5">
        {status === undefined && (
          <p className="px-2 text-xs text-muted-foreground">Loading…</p>
        )}
        {status !== undefined && !status.available && (
          <p className="px-2 text-xs text-muted-foreground">
            Git is not installed. Snapshots are used instead.
          </p>
        )}
        {status !== undefined && status.available && !status.isRepo && (
          <div className="space-y-1.5 px-2 text-xs text-muted-foreground">
            <p>This project is not under version control yet.</p>
            <Button
              variant="outline"
              size="xs"
              onClick={() => void run(() => gitInit(project!.path))}
            >
              Initialize repository
            </Button>
          </div>
        )}
        {status !== undefined && status.isRepo && (
          <>
            <RemoteRow
              status={status}
              busy={busy}
              onFetch={() =>
                void sync("fetch", async () => {
                  await gitFetch(project!.path);
                  return syncNotice("fetched");
                })
              }
              onPull={() =>
                void sync("pull", async () => {
                  const outcome = await gitPull(project!.path);
                  return outcome.kind === "conflicts"
                    ? syncNotice("conflicts", outcome.paths.length)
                    : syncNotice(outcome.kind);
                })
              }
              onPush={() =>
                void sync("push", async () => {
                  await gitPush(project!.path);
                  return syncNotice("pushed");
                })
              }
              onSetRemote={(url) => run(() => gitSetRemote(project!.path, url))}
              projectName={project!.name}
              onPublish={(provider, name, isPrivate) =>
                sync("publish", async () => {
                  const url = await publishTo(provider, project!.path, name, isPrivate);
                  return `Published to ${remoteLabel(url)}.`;
                })
              }
            />
            {notice && (
              <p className="mt-1 px-2 text-xs text-muted-foreground">{notice}</p>
            )}

            {conflicts.length > 0 && (
              <>
                <p className="mt-2 px-2 text-2xs font-medium tracking-wide text-warning uppercase">
                  Conflicts
                </p>
                {conflicts.map((path) => (
                  <ConflictRow
                    key={`c-${path}`}
                    path={path}
                    onOpen={() => void openFile(path)}
                    onKeep={(side) =>
                      void run(() => gitResolveConflict(project!.path, path, side))
                    }
                    onResolved={() =>
                      void run(() => gitMarkResolved(project!.path, path))
                    }
                  />
                ))}
              </>
            )}
            {merging && (
              <div className="mt-1.5 px-2">
                <Button
                  variant="outline"
                  size="xs"
                  title="Drop the merge and go back to before the pull"
                  onClick={() => void run(() => gitAbortMerge(project!.path))}
                >
                  <Undo2 />
                  Abort merge
                </Button>
              </div>
            )}

            {status.entries.length === 0 && conflicts.length === 0 && !merging && (
              <p className="mt-2 px-2 text-xs text-muted-foreground">
                No changes since the last commit.
              </p>
            )}

            {staged.length > 0 && (
              <>
                <p className="mt-2 px-2 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                  Staged
                </p>
                {staged.map((entry) => (
                  <GitRow
                    key={`s-${entry.path}`}
                    entry={entry}
                    action="unstage"
                    onDiff={() => setDiffTarget(entry.path)}
                    onAction={() =>
                      void run(() => gitUnstage(project!.path, [entry.path]))
                    }
                  />
                ))}
              </>
            )}

            {unstaged.length > 0 && (
              <>
                <p className="mt-2 px-2 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                  Changes
                </p>
                {unstaged.map((entry) => (
                  <GitRow
                    key={`u-${entry.path}`}
                    entry={entry}
                    action="stage"
                    onDiff={() => setDiffTarget(entry.path)}
                    onAction={() =>
                      void run(() => gitStage(project!.path, [entry.path]))
                    }
                  />
                ))}
              </>
            )}

            <div className="mt-3 flex flex-col gap-1.5 px-2">
              <Input
                className="h-7 rounded-3xl text-xs"
                placeholder={merging ? MERGE_MESSAGE : "Commit message"}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canCommit) commit();
                }}
              />
              <Button
                size="sm"
                className="h-7 w-full px-2"
                disabled={!canCommit}
                title={
                  conflicts.length > 0
                    ? "Resolve the conflicts first"
                    : merging
                      ? "Commit the merge"
                      : hasStaged
                        ? "Commit staged changes"
                        : "Nothing staged"
                }
                onClick={commit}
              >
                <Check className="size-3.5" />
                {merging ? "Finish merge" : "Commit"}
              </Button>
            </div>
            {error && (
              <p className="mt-1 px-2 text-xs text-destructive">
                {error}
                {/git(hub)? account/i.test(error) && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => openSettings("git")}
                    >
                      Open git accounts
                    </button>
                  </>
                )}
              </p>
            )}
          </>
        )}
      </div>

      {diffTarget && (
        <GitDiffDialog path={diffTarget} onClose={() => setDiffTarget(null)} />
      )}
    </div>
  );
}

/**
 * The remote and the sync actions. Without a remote: a way to add one;
 * with one: Fetch, Pull (with the count behind) and Push (ahead).
 */
type Busy = "fetch" | "pull" | "push" | "publish" | null;

function RemoteRow({
  status,
  busy,
  onFetch,
  onPull,
  onPush,
  onSetRemote,
  projectName,
  onPublish,
}: {
  status: GitStatus;
  busy: Busy;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onSetRemote: (url: string) => Promise<boolean>;
  projectName: string;
  onPublish: (provider: Hosting, name: string, isPrivate: boolean) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [publishing, setPublishing] = useState<{
    provider: Hosting;
    name: string;
    isPrivate: boolean;
  } | null>(null);

  function startEditing() {
    setUrl(status.remote ?? "");
    setEditing(true);
  }

  async function save() {
    // A refused URL keeps the field, with the error below it.
    if (await onSetRemote(url)) setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 px-2 pt-1">
        <Input
          autoFocus
          className="h-7 text-xs"
          placeholder="https://github.com/you/paper.git"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
            if (event.key === "Escape") setEditing(false);
          }}
        />
        <div className="flex gap-1">
          <Button size="xs" onClick={() => void save()}>
            {url.trim() === "" && status.remote ? "Remove remote" : "Save remote"}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (publishing !== null && !status.remote) {
    const publish = async () => {
      // A failed publish keeps the form, with the error below it.
      if (await onPublish(publishing.provider, publishing.name, publishing.isPrivate)) {
        setPublishing(null);
      }
    };
    return (
      <div className="flex flex-col gap-1.5 px-2 pt-1">
        <select
          aria-label="Host"
          className="h-7 rounded-md border bg-background px-2 text-xs"
          value={publishing.provider}
          disabled={busy === "publish"}
          onChange={(event) =>
            setPublishing({ ...publishing, provider: event.target.value as Hosting })
          }
        >
          {(Object.keys(HOSTING_NAMES) as Hosting[]).map((provider) => (
            <option key={provider} value={provider}>
              {HOSTING_NAMES[provider]}
            </option>
          ))}
        </select>
        <Input
          autoFocus
          aria-label="Repository name"
          className="h-7 text-xs"
          value={publishing.name}
          disabled={busy === "publish"}
          onChange={(event) =>
            setPublishing({ ...publishing, name: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" && publishing.name.trim()) void publish();
            if (event.key === "Escape") setPublishing(null);
          }}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={publishing.isPrivate}
            disabled={busy === "publish"}
            onChange={(event) =>
              setPublishing({ ...publishing, isPrivate: event.target.checked })
            }
          />
          Private repository
        </label>
        <div className="flex gap-1">
          <Button
            size="xs"
            disabled={busy !== null || publishing.name.trim() === ""}
            onClick={() => void publish()}
          >
            {busy === "publish" ? "Publishing…" : "Publish"}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={busy === "publish"}
            onClick={() => setPublishing(null)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (!status.remote) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-1 px-2 pt-1 text-xs text-muted-foreground">
        <span>No remote yet.</span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="xs"
            title="Create a repository on GitHub or GitLab for this project and push it"
            onClick={() =>
              setPublishing({
                provider: "github",
                name: suggestedRepoName(projectName),
                isPrivate: true,
              })
            }
          >
            Publish…
          </Button>
          <Button variant="outline" size="xs" onClick={startEditing}>
            Add remote…
          </Button>
        </div>
      </div>
    );
  }

  const working = busy !== null;
  return (
    <div className="flex items-center gap-1 px-2 pt-1">
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground hover:underline"
        title={`${status.remote}\nClick to change the remote`}
        onClick={startEditing}
      >
        {remoteLabel(status.remote)}
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        title={busy === "fetch" ? "Fetching…" : "Fetch: see what the remote has"}
        disabled={working}
        onClick={onFetch}
      >
        <RefreshCcw className={busy === "fetch" ? "animate-spin" : undefined} />
      </Button>
      <Button
        variant="outline"
        size="xs"
        title={busy === "pull" ? "Pulling…" : "Pull the remote's commits"}
        disabled={working || status.merging}
        onClick={onPull}
      >
        <ArrowDown />
        {status.behind > 0 ? `Pull ${status.behind}` : "Pull"}
      </Button>
      <Button
        variant="outline"
        size="xs"
        title={busy === "push" ? "Pushing…" : "Push your commits"}
        disabled={working || status.merging}
        onClick={onPush}
      >
        <ArrowUp />
        {status.ahead > 0 ? `Push ${status.ahead}` : "Push"}
      </Button>
    </div>
  );
}

function ConflictRow({
  path,
  onOpen,
  onKeep,
  onResolved,
}: {
  path: string;
  onOpen: () => void;
  onKeep: (side: "ours" | "theirs") => void;
  onResolved: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-1 rounded px-2 py-0.5 hover:bg-accent"
      title={`conflict: ${path}`}
    >
      <span className="w-3 shrink-0 text-center font-mono text-2xs text-warning">
        U
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-xs hover:underline"
        title="Open the file and pick per conflict"
        onClick={onOpen}
      >
        {path}
      </button>
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        <Button
          variant="ghost"
          size="xs"
          className="h-5 px-1.5 text-2xs"
          title="Keep mine: the whole file as I had it"
          onClick={() => onKeep("ours")}
        >
          Mine
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="h-5 px-1.5 text-2xs"
          title="Keep theirs: the whole file as the remote has it"
          onClick={() => onKeep("theirs")}
        >
          Theirs
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-5"
          title="Mark resolved"
          onClick={onResolved}
        >
          <Check className="size-3" />
        </Button>
      </span>
    </div>
  );
}

function GitRow({
  entry,
  action,
  onAction,
  onDiff,
}: {
  entry: GitEntry;
  action: "stage" | "unstage";
  onAction: () => void;
  onDiff: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-1 rounded px-2 py-0.5 hover:bg-accent"
      title={`${statusWord(entry)}: ${entry.path}`}
    >
      <span
        className={`w-3 shrink-0 text-center font-mono text-2xs ${entryColor(entry)}`}
      >
        {action === "unstage" ? codeLabel(entry.x) : codeLabel(entry.y)}
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-xs hover:underline"
        onClick={onDiff}
      >
        {entry.path}
      </button>
      <span className="hidden shrink-0 items-center group-hover:flex">
        <Button
          variant="ghost"
          size="icon"
          className="size-5"
          title="Show changes"
          onClick={onDiff}
        >
          <FileDiff className="size-3" />
        </Button>
        {action === "unstage" ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            title="Unstage"
            onClick={onAction}
          >
            <Minus className="size-3" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            title="Stage"
            onClick={onAction}
          >
            <Plus className="size-3" />
          </Button>
        )}
      </span>
    </div>
  );
}
