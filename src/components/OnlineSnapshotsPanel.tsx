import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDiff, RefreshCw, RotateCcw } from "lucide-react";
import { OnlineSnapshotDialog, restoreOnline } from "@/components/OnlineSnapshotDialog";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { kindLabel, snapshotTime } from "@/lib/online-snapshots";
import { shareHistory, shareInfo, type HistorySnapshot } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

const errorText = (e: unknown) =>
  typeof e === "object" && e !== null && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);

/**
 * The shared project's snapshots on the server: one an hour while
 * anyone works on it, the published ones, and the project as it was
 * before each restore. Everyone in the project sees them; the owner
 * and editors restore the project or single files for everyone.
 */
export function OnlineSnapshotsPanel({ label }: { label: string }) {
  const dir = useProjectStore((s) => s.project?.path ?? null);
  const queryClient = useQueryClient();
  const [restoreTarget, setRestoreTarget] = useState<HistorySnapshot | null>(null);
  const [diffTarget, setDiffTarget] = useState<HistorySnapshot | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const history = useQuery({
    queryKey: ["online-snapshots", dir],
    queryFn: () => shareHistory(dir!),
    enabled: dir !== null,
    refetchOnWindowFocus: true,
  });
  const info = useQuery({
    queryKey: ["online-snapshots-info", dir],
    queryFn: () => shareInfo(dir!),
    enabled: dir !== null,
  });
  const writable = info.data?.writable ?? false;

  async function confirmRestore() {
    if (!dir || !restoreTarget) return;
    setDialogError(null);
    setRestoring(true);
    try {
      await restoreOnline(dir, restoreTarget.id);
      setRestoreTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["online-snapshots", dir] });
    } catch (e) {
      setDialogError(errorText(e));
    } finally {
      setRestoring(false);
    }
  }

  const snapshots = history.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        label={label}
        actions={
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="Refresh"
            onClick={() => void history.refetch()}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-1.5">
        {history.isError ? (
          <p className="px-2 text-xs text-destructive">{errorText(history.error)}</p>
        ) : history.isPending ? (
          <p className="px-2 text-xs text-muted-foreground">Loading…</p>
        ) : snapshots.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No snapshots yet.</p>
        ) : (
          <ul>
            {snapshots.map((snap) => {
              const kind = kindLabel(snap.kind);
              return (
                <li
                  key={snap.id}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs">
                      {snapshotTime(snap.createdAt)}
                    </span>
                    {kind && (
                      <span className="block truncate text-2xs text-muted-foreground">
                        {kind}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5"
                      title="View changes against the current project"
                      onClick={() => setDiffTarget(snap)}
                    >
                      <FileDiff className="size-3" />
                    </Button>
                    {writable && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5"
                        title="Restore this snapshot"
                        onClick={() => {
                          setDialogError(null);
                          setRestoreTarget(snap);
                        }}
                      >
                        <RotateCcw className="size-3" />
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 px-2 text-2xs text-muted-foreground">
          Kept once an hour while the project changes: all of the last two days, then
          one a day for 30 days. They don't count toward your storage.
        </p>
      </div>

      <Dialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore snapshot</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Restore the project to the snapshot from{" "}
            {restoreTarget ? new Date(restoreTarget.createdAt).toLocaleString() : ""}?
            Everyone working on it gets the change, and comments stay as they are. The
            project as it is now is kept as a snapshot first, so you can undo this.
          </p>
          {dialogError && <p className="text-xs text-destructive">{dialogError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={restoring}
              onClick={() => void confirmRestore()}
            >
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {diffTarget && dir && (
        <OnlineSnapshotDialog
          dir={dir}
          snapshot={diffTarget}
          writable={writable}
          onClose={() => setDiffTarget(null)}
        />
      )}
    </div>
  );
}
