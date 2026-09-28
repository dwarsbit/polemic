import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DiffRows } from "@/components/DiffRows";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { collapseContext, lineDiff } from "@/lib/diff";
import { gitShowHead, readProjectFile } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

/**
 * Diff of one file between HEAD and the working tree (unsaved edits
 * included), used from the git panel.
 */
export function GitDiffDialog({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  const project = useProjectStore((s) => s.project);

  const { data, error } = useQuery({
    queryKey: ["git-diff", project?.path, path],
    queryFn: async () => {
      const oldText = (await gitShowHead(project!.path, path)) ?? "";
      const buffer = useProjectStore.getState().buffers[path];
      const newText =
        buffer !== undefined ? buffer : await readProjectFile(project!.path, path);
      return { oldText, newText };
    },
    enabled: project !== null,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    return collapseContext(lineDiff(data.oldText, data.newText));
  }, [data]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[70vh] max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>Changes in {path}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            HEAD compared with the current file (unsaved edits included).
          </p>
        </DialogHeader>
        <div className="flex-1 min-h-0 px-6 pb-6">
          <ScrollArea className="h-full rounded border p-2">
            {error && <p className="p-2 text-xs text-destructive">{String(error)}</p>}
            {!error && data && data.oldText === "" && data.newText === "" && (
              <p className="p-2 text-xs text-muted-foreground">
                File is empty on both sides.
              </p>
            )}
            {!error && !data && (
              <p className="p-2 text-xs text-muted-foreground">Loading…</p>
            )}
            <DiffRows rows={rows} />
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
