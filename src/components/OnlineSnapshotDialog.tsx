import { errorText } from "@/lib/error-text";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { DiffRows } from "@/components/DiffRows";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { collapseContext, lineDiff } from "@/lib/diff";
import { onlineChanges, type OnlineChange } from "@/lib/online-snapshots";
import type { FolderEntry } from "@/lib/project-doc";
import {
  shareFolder,
  shareHistoryFiles,
  shareRestore,
  type HistorySnapshot,
} from "@/lib/tauri";
import { useLinkStore } from "@/store/link";
import { useProjectStore } from "@/store/project";
import { cn } from "cn";

function statusLabel(status: OnlineChange["status"]): string {
  switch (status) {
    case "added":
      return "new";
    case "removed":
      return "deleted";
    default:
      return "changed";
  }
}

/** The project as it is now: the folder (or the browser's copy) with unsaved edits. */
async function currentFiles(dir: string): Promise<FolderEntry[]> {
  const entries = await shareFolder(dir);
  const { buffers } = useProjectStore.getState();
  return entries.map((entry) =>
    entry.kind === "text" && buffers[entry.path] !== undefined
      ? { ...entry, text: buffers[entry.path] }
      : entry,
  );
}

/**
 * Restores the server's copy from an online snapshot, the whole project
 * or `paths`. On the desktop, this folder's saved changes go up first,
 * so the snapshot kept before the restore has them, and the restore
 * comes down right after; in the browser it arrives live.
 */
export async function restoreOnline(
  dir: string,
  snapshotId: string,
  paths?: string[],
): Promise<void> {
  const link = useLinkStore.getState();
  if (link.dir === dir) await link.syncNow();
  await shareRestore(dir, snapshotId, paths);
  if (useLinkStore.getState().dir === dir) await useLinkStore.getState().syncNow();
}

export function OnlineSnapshotDialog({
  dir,
  snapshot,
  writable,
  onClose,
}: {
  dir: string;
  snapshot: HistorySnapshot;
  writable: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const files = useQuery({
    queryKey: ["online-snapshot-files", dir, snapshot.id],
    queryFn: () => shareHistoryFiles(dir, snapshot.id),
  });
  const changes = useQuery({
    queryKey: ["online-snapshot-changes", dir, snapshot.id],
    queryFn: async () => onlineChanges(files.data!, await currentFiles(dir)),
    enabled: files.data !== undefined,
  });

  const list = changes.data ?? [];
  const active = list.find((c) => c.path === selectedPath) ?? list[0];

  const rows = useMemo(() => {
    if (!active || (active.before === null && active.after === null)) return [];
    return collapseContext(lineDiff(active.before ?? "", active.after ?? ""));
  }, [active]);

  async function restoreActiveFile() {
    if (!active) return;
    setError(null);
    setRestoring(true);
    try {
      await restoreOnline(dir, snapshot.id, [active.path]);
      await queryClient.invalidateQueries({ queryKey: ["online-snapshots", dir] });
      await queryClient.invalidateQueries({
        queryKey: ["online-snapshot-changes", dir, snapshot.id],
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRestoring(false);
    }
  }

  const loadError = files.error ?? changes.error;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[70vh] max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>Snapshot changes</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {new Date(snapshot.createdAt).toLocaleString()} compared with the current
            project (unsaved edits included).
          </p>
        </DialogHeader>
        <div className="grid flex-1 min-h-0 grid-cols-[220px_1fr] px-6 pb-6">
          <ScrollArea className="min-h-0 border-r pr-2">
            {list.length === 0 && (
              <p className="py-2 text-xs text-muted-foreground">
                {loadError
                  ? errorText(loadError)
                  : changes.data === undefined
                    ? "Loading…"
                    : "No differences."}
              </p>
            )}
            <ul>
              {list.map((change) => (
                <li key={change.path}>
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded px-2 py-1.5 text-left",
                      change.path === active?.path ? "bg-primary/10" : "hover:bg-muted",
                    )}
                    onClick={() => setSelectedPath(change.path)}
                  >
                    <span className="block truncate text-xs font-medium">
                      {change.path}
                    </span>
                    <span className="text-2xs text-muted-foreground">
                      {statusLabel(change.status)}{" "}
                      {(change.before !== null || change.after !== null) && (
                        <>
                          <span className="text-success">+{change.addedLines}</span>{" "}
                          <span className="text-destructive">
                            −{change.removedLines}
                          </span>
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
          <div className="flex min-h-0 flex-col pl-4">
            {active && (
              <SectionHeader
                label={active.path}
                actions={
                  writable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      title="Restore this file from the snapshot"
                      disabled={restoring}
                      onClick={() => void restoreActiveFile()}
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                  )
                }
              />
            )}
            <ScrollArea className="min-h-0 flex-1">
              {active && active.before === null && active.after === null && (
                <p className="py-2 text-xs text-muted-foreground">
                  This file isn't text, so there is no line-by-line view.
                </p>
              )}
              <DiffRows rows={rows} />
            </ScrollArea>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
