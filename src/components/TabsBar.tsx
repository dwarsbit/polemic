import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/store/editor";
import {
  useProjectStore,
} from "@/store/project";

export function TabsBar() {
  const openFiles = useProjectStore((s) => s.openFiles);
  const activeFile = useProjectStore((s) => s.activeFile);
  const lastSavedContent = useProjectStore((s) => s.lastSavedContent);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);
  const openFile = useProjectStore((s) => s.openFile);

  /** Pointer-drag state for reordering; html5 drag does not work in the webview. */
  const drag = useRef<{ file: string; startX: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  /** Dirty tab awaiting the close-confirmation dialog. */
  const [pendingClose, setPendingClose] = useState<string | null>(null);

  function isDirty(file: string) {
    return (
      buffers[file] !== undefined ||
      (file === activeFile && content !== lastSavedContent)
    );
  }

  function requestClose(file: string) {
    if (isDirty(file)) {
      setPendingClose(file);
    } else {
      void useProjectStore.getState().closeFile(file);
    }
  }

  const pendingDirty =
    pendingClose !== null && isDirty(pendingClose);

  return (
    <div className="flex h-9 shrink-0 items-end gap-0.5 border-b bg-muted/40 px-1 pt-1">
      <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
        {openFiles.map((file) => {
          const active = file === activeFile;
          return (
            <div
              key={file}
              data-tab={file}
              onPointerDown={(event) => {
                // Left press only; remember where a drag would start.
                if (event.button !== 0) return;
                drag.current = { file, startX: event.clientX, moved: false };
              }}
              onPointerMove={(event) => {
                const state = drag.current;
                if (!state || state.file !== file) return;
                // The release can be missed entirely (e.g. outside the
                // window): recover as soon as the mouse moves unpressed.
                if (state.moved && event.buttons === 0) {
                  drag.current = null;
                  setDragging(null);
                  return;
                }
                if (!state.moved) {
                  if (Math.abs(event.clientX - state.startX) < 5) return;
                  state.moved = true;
                  setDragging(file);
                  // Keep receiving moves outside this tab while dragging.
                  (event.currentTarget as HTMLElement).setPointerCapture(
                    event.pointerId,
                  );
                }
                // Reorder when the pointer is over another tab.
                const target = (
                  document.elementFromPoint(event.clientX, event.clientY)
                    ?.closest("[data-tab]") as HTMLElement | null
                )?.dataset.tab;
                if (target === undefined || target === file) return;
                const { openFiles: files, reorderOpenFiles: move } =
                  useProjectStore.getState();
                const from = files.indexOf(state.file);
                const to = files.indexOf(target);
                if (from !== -1 && to !== -1) move(from, to);
              }}
              onPointerUp={() => {
                drag.current = null;
                setDragging(null);
              }}
              onPointerCancel={() => {
                drag.current = null;
                setDragging(null);
              }}
              onLostPointerCapture={() => {
                drag.current = null;
                setDragging(null);
              }}
              className={cn(
                "group flex shrink-0 items-center gap-1.5 rounded-t-md border px-2.5 text-xs",
                active
                  ? "border-border border-b-transparent bg-card text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/50",
                dragging === file && "opacity-40",
              )}
              onAuxClick={(e) => {
                if (e.button === 1) requestClose(file);
              }}
            >
              <button
                type="button"
                className="max-w-40 truncate py-1.5"
                title={file}
                onClick={() => void openFile(file)}
              >
                {file.split("/").pop()}
              </button>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isDirty(file) ? "bg-primary" : "bg-transparent",
                )}
              />
              <button
                type="button"
                className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
                title="Close tab"
                onClick={() => requestClose(file)}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Closing a tab with unsaved changes needs a decision. */}
      <Dialog
        open={pendingClose !== null}
        onOpenChange={(open) => {
          if (!open) setPendingClose(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Close {pendingClose?.split("/").pop()}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This file has unsaved changes.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingClose(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const file = pendingClose;
                setPendingClose(null);
                if (file) void useProjectStore.getState().closeFile(file, { discard: true });
              }}
            >
              Discard
            </Button>
            <Button
              disabled={!pendingDirty}
              onClick={() => {
                const file = pendingClose;
                setPendingClose(null);
                if (file) void useProjectStore.getState().closeFile(file);
              }}
            >
              Save &amp; Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
