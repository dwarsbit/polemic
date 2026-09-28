import { useState } from "react";
import { Camera, RotateCcw } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SnapshotInfo } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

export function SnapshotsPanel() {
  const snapshots = useProjectStore((s) => s.snapshots);
  const [restoreTarget, setRestoreTarget] = useState<SnapshotInfo | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  async function confirmRestore() {
    if (!restoreTarget) return;
    setDialogError(null);
    try {
      await useProjectStore.getState().restoreSnapshot(restoreTarget.id);
      setRestoreTarget(null);
    } catch (e) {
      setDialogError(String(e));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        label="SNAPSHOTS"
        collapsed={false}
        actions={
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="Take a snapshot of the current project state"
            onClick={() => void useProjectStore.getState().takeSnapshot()}
          >
            <Camera className="size-3.5" />
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {snapshots.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No snapshots yet.</p>
        ) : (
          <ul>
            {snapshots.map((snap) => (
              <li
                key={snap.id}
                className="flex items-center justify-between rounded px-2 py-1"
              >
                <span className="truncate text-xs">
                  {new Date(snap.createdAtMillis).toLocaleString()}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  title="Restore this snapshot"
                  onClick={() => setRestoreTarget(snap)}
                >
                  <RotateCcw className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
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
            {restoreTarget
              ? new Date(restoreTarget.createdAtMillis).toLocaleString()
              : ""}
            ? A safety snapshot of the current state is created first.
          </p>
          {dialogError && <p className="text-xs text-destructive">{dialogError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmRestore()}>
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
