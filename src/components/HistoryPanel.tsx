import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { gitLog, type GitCommit } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

const LIMIT = 200;

function timeAgo(millis: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - millis) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(millis).toLocaleDateString();
}

function CommitRow({ commit }: { commit: GitCommit }) {
  return (
    <li
      className="rounded px-2 py-1 hover:bg-accent"
      title={`${new Date(commit.timestampMillis).toLocaleString()} — ${commit.hash}`}
    >
      <p className="flex items-baseline gap-1.5">
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {commit.hash.slice(0, 7)}
        </span>
        <span className="min-w-0 truncate text-xs font-medium">{commit.message}</span>
      </p>
      <p className="text-[11px] text-muted-foreground">
        {commit.author} · {timeAgo(commit.timestampMillis)}
      </p>
    </li>
  );
}

/** Commit history of the current branch. */
export function HistoryPanel() {
  const project = useProjectStore((s) => s.project);
  const queryClient = useQueryClient();

  const { data: log, error } = useQuery({
    queryKey: ["git-log", project?.path],
    queryFn: () => gitLog(project!.path, LIMIT),
    enabled: project !== null,
  });

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        label="HISTORY"
        collapsed={false}
        actions={
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="Refresh history"
            onClick={() =>
              void queryClient.invalidateQueries({ queryKey: ["git-log"] })
            }
          >
            <RefreshCcw className="size-3.5" />
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {error && <p className="px-2 text-xs text-destructive">{String(error)}</p>}
        {!error && (log ?? []).length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">No commits yet.</p>
        )}
        <ul className="space-y-0.5">
          {(log ?? []).map((commit) => (
            <CommitRow key={commit.hash} commit={commit} />
          ))}
        </ul>
      </div>
    </div>
  );
}
