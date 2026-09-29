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
import { invalidateGitState } from "@/lib/query-client";
import {
  listSnapshotChanges,
  readProjectFile,
  readSnapshotFile,
  restoreSnapshotFile,
  type FileEntry,
  type SnapshotChange,
  type SnapshotInfo,
} from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { cn } from "cn";

function statusLabel(status: SnapshotChange["status"]): string {
  switch (status) {
    case "added":
      return "new";
    case "removed":
      return "deleted";
    default:
      return "changed";
  }
}

export function SnapshotDiffDialog({
  snapshot,
  onClose,
}: {
  snapshot: SnapshotInfo;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const project = useProjectStore((s) => s.project);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const { data: changes } = useQuery({
    queryKey: ["snapshot-changes", project?.path, snapshot.id],
    queryFn: () => listSnapshotChanges(project!.path, snapshot.id),
    enabled: project !== null,
  });

  const active =
    (changes ?? []).find((change) => change.path === selectedPath) ??
    (changes ?? [])[0];

  const { data: contents } = useQuery({
    queryKey: ["snapshot-diff", project?.path, snapshot.id, active?.path],
    queryFn: async () => {
      const change = active!;
      const readCurrent = async () => {
        const buffer = useProjectStore.getState().buffers[change.path];
        if (buffer !== undefined) return buffer;
        try {
          return await readProjectFile(project!.path, change.path);
        } catch {
          return "";
        }
      };
      if (change.status === "added") {
        return { oldText: "", newText: await readCurrent() };
      }
      if (change.status === "removed") {
        return {
          oldText: await readSnapshotFile(project!.path, snapshot.id, change.path),
          newText: "",
        };
      }
      return {
        oldText: await readSnapshotFile(project!.path, snapshot.id, change.path),
        newText: await readCurrent(),
      };
    },
    enabled: project !== null && active !== undefined,
  });

  const rows = useMemo(() => {
    if (!contents) return [];
    return collapseContext(lineDiff(contents.oldText, contents.newText));
  }, [contents]);

  async function restoreActiveFile() {
    if (!project || !active) return;
    setRestoreError(null);
    try {
      await restoreSnapshotFile(project.path, snapshot.id, active.path);
      // Drop any unsaved buffer so the restored disk content wins.
      useProjectStore.setState((state) => {
        if (!(active.path in state.buffers)) return state;
        const buffers = { ...state.buffers };
        delete buffers[active.path];
        return { buffers };
      });
      const store = useProjectStore.getState();
      await store.refreshFiles();
      if (store.activeFile === active.path) {
        const exists = fileExists(useProjectStore.getState().files, active.path);
        if (exists) {
          await store.openFile(active.path);
        } else {
          useEditorStore.getState().loadContent("");
          useProjectStore.setState((state) => ({
            openFiles: state.openFiles.filter((f) => f !== active.path),
            activeFile: state.activeFile === active.path ? null : state.activeFile,
            lastSavedContent: null,
          }));
        }
      }
      await queryClient.invalidateQueries({
        queryKey: ["snapshot-changes", project.path, snapshot.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["snapshot-diff", project.path, snapshot.id],
      });
      await invalidateGitState();
    } catch (e) {
      setRestoreError(String(e));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[70vh] max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>Snapshot changes</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {new Date(snapshot.createdAtMillis).toLocaleString()} compared with the
            current project (unsaved edits included).
          </p>
        </DialogHeader>
        <div className="grid flex-1 min-h-0 grid-cols-[220px_1fr] px-6 pb-6">
          <ScrollArea className="min-h-0 border-r pr-2">
            {(changes ?? []).length === 0 && (
              <p className="py-2 text-xs text-muted-foreground">
                {changes === undefined ? "Loading…" : "No differences."}
              </p>
            )}
            <ul>
              {(changes ?? []).map((change) => (
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
                    <span className="text-[11px] text-muted-foreground">
                      {statusLabel(change.status)}{" "}
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{change.addedLines}
                      </span>{" "}
                      <span className="text-destructive">−{change.removedLines}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
          <div className="flex min-h-0 flex-col pl-4">
            {active && (
              <SectionHeader
                label={active.path.toUpperCase()}
                collapsed={false}
                actions={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    title="Restore this file from the snapshot"
                    onClick={() => void restoreActiveFile()}
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                }
              />
            )}
            <ScrollArea className="min-h-0 flex-1">
              {!active && (
                <p className="py-2 text-xs text-muted-foreground">
                  Select a file to see its diff.
                </p>
              )}
              <DiffRows rows={rows} />
            </ScrollArea>
            {restoreError && (
              <p className="mt-2 text-xs text-destructive">{restoreError}</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function fileExists(entries: FileEntry[], target: string): boolean {
  for (const entry of entries) {
    if (!entry.isDir && entry.path === target) return true;
    if (entry.isDir && fileExists(entry.children, target)) return true;
  }
  return false;
}
