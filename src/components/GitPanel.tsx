import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileDiff, GitBranch, Minus, Plus, RefreshCcw } from "lucide-react";
import { GitDiffDialog } from "@/components/GitDiffDialog";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  gitCommit,
  gitInit,
  gitLog,
  gitStage,
  gitStatus,
  gitUnstage,
  type GitEntry,
} from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

const LOG_LIMIT = 20;

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
  if (entry.x !== " ") return "text-emerald-600 dark:text-emerald-400";
  return "text-amber-600 dark:text-amber-400";
}

export function GitPanel() {
  const project = useProjectStore((s) => s.project);
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ["git-status", project?.path],
    queryFn: () => gitStatus(project!.path),
    enabled: project !== null,
    refetchOnWindowFocus: true,
  });

  const { data: log } = useQuery({
    queryKey: ["git-log", project?.path],
    queryFn: () => gitLog(project!.path, LOG_LIMIT),
    enabled: project !== null && (status?.isRepo ?? false),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["git-status"] });
    await queryClient.invalidateQueries({ queryKey: ["git-log"] });
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(String(e));
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
  const hasStaged = staged.length > 0;

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        label="GIT"
        collapsed={false}
        actions={
          <div className="flex items-center gap-0.5">
            {status?.branch && (
              <span className="mr-1 flex items-center gap-1 text-[11px] text-muted-foreground">
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
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {status === undefined && (
          <p className="px-2 text-xs text-muted-foreground">Loading…</p>
        )}
        {status !== undefined && !status.available && (
          <p className="px-2 text-xs text-muted-foreground">
            git was not found on your PATH.
          </p>
        )}
        {status !== undefined && status.available && !status.isRepo && (
          <div className="space-y-1.5 px-2 text-xs text-muted-foreground">
            <p>This project is not a git repository yet.</p>
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
            {status.entries.length === 0 && (
              <p className="px-2 text-xs text-muted-foreground">Working tree clean.</p>
            )}

            {staged.length > 0 && (
              <>
                <p className="mt-2 px-2 text-[11px] font-medium text-muted-foreground">
                  STAGED
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
                <p className="mt-2 px-2 text-[11px] font-medium text-muted-foreground">
                  CHANGES
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

            <div className="mt-3 flex gap-1.5 px-2">
              <Input
                className="h-7 rounded-3xl text-xs"
                placeholder="Commit message…"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && message.trim() && hasStaged) {
                    const msg = message;
                    setMessage("");
                    void run(async () => {
                      await gitCommit(project!.path, msg);
                    });
                  }
                }}
              />
              <Button
                size="sm"
                className="h-7 px-2"
                disabled={!message.trim() || !hasStaged}
                title={hasStaged ? "Commit staged changes" : "Nothing staged"}
                onClick={() => {
                  const msg = message;
                  setMessage("");
                  void run(async () => {
                    await gitCommit(project!.path, msg);
                  });
                }}
              >
                <Check className="size-3.5" />
                Commit
              </Button>
            </div>
            {error && <p className="mt-1 px-2 text-xs text-destructive">{error}</p>}

            {(log ?? []).length > 0 && (
              <>
                <p className="mt-3 px-2 text-[11px] font-medium text-muted-foreground">
                  HISTORY
                </p>
                <ul className="px-2">
                  {(log ?? []).map((commit) => (
                    <li
                      key={commit.hash}
                      className="truncate py-0.5 text-xs"
                      title={`${commit.author} — ${commit.hash}`}
                    >
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {commit.hash.slice(0, 7)}
                      </span>{" "}
                      {commit.message}
                    </li>
                  ))}
                </ul>
              </>
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
        className={`w-3 shrink-0 text-center font-mono text-[11px] ${entryColor(entry)}`}
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
          title="Show changes vs HEAD"
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
