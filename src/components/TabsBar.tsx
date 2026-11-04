import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
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
import { useProjectStore } from "@/store/project";

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

  const pendingDirty = pendingClose !== null && isDirty(pendingClose);

  /** The scrolling strip of tabs, and which of its edges hide more tabs. */
  const viewport = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, []);

  // Re-measure when the strip or its tabs change size.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure, openFiles.length]);

  // A mouse wheel scrolls vertically; turn that into sideways scrolling.
  // Trackpads already scroll sideways and pass through untouched.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    function onWheel(event: WheelEvent) {
      if (!el || event.ctrlKey) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1;
      el.scrollLeft += event.deltaY * unit;
      event.preventDefault();
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the active tab in view, clear of the edge fades.
  useEffect(() => {
    const el = viewport.current;
    if (!el || !activeFile) return;
    const tab = el.querySelector<HTMLElement>(`[data-tab="${CSS.escape(activeFile)}"]`);
    if (!tab) return;
    const margin = FADE;
    const left = tab.offsetLeft - margin;
    const right = tab.offsetLeft + tab.offsetWidth + margin - el.clientWidth;
    let target: number | null = null;
    if (el.scrollLeft > left) target = left;
    else if (el.scrollLeft < right) target = right;
    if (target === null) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: Math.max(0, target), behavior: reduce ? "auto" : "smooth" });
  }, [activeFile, openFiles]);

  return (
    // The bar's bottom line is a pseudo-element so the active tab, drawn
    // above it, can cover it and open into the editor below.
    <div className="relative flex h-9 shrink-0 items-end gap-0.5 bg-muted/40 px-1.5 pt-1 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border">
      {/* Raised above the bar's bottom line so the active tab covers it. */}
      <ScrollAreaPrimitive.Root
        type="hover"
        scrollHideDelay={400}
        className="relative z-10 h-full min-w-0 flex-1"
      >
        <ScrollAreaPrimitive.Viewport
          ref={viewport}
          onScroll={measure}
          className="size-full"
          style={{ maskImage: fadeMask(overflow.start, overflow.end) }}
        >
          <div className="flex h-full items-end gap-0.5">
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
                      document
                        .elementFromPoint(event.clientX, event.clientY)
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
                    "group flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border px-2.5 text-xs",
                    active
                      ? "relative z-10 border-border border-b-transparent bg-card text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-accent/50",
                    dragging === file && "opacity-40",
                  )}
                  onAuxClick={(e) => {
                    if (e.button === 1) requestClose(file);
                  }}
                >
                  <button
                    type="button"
                    className="max-w-40 truncate"
                    title={file}
                    onClick={() => void openFile(file)}
                  >
                    {file.split("/").pop()}
                  </button>
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      isDirty(file) ? "bg-tint" : "bg-transparent",
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
        </ScrollAreaPrimitive.Viewport>
        {/* A thin bar over the bottom of the tabs, shown on hover. */}
        <ScrollAreaPrimitive.Scrollbar
          orientation="horizontal"
          className="z-20 flex h-1 touch-none flex-col px-0.5 pb-px select-none"
        >
          <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-muted-foreground/40 hover:bg-muted-foreground/60" />
        </ScrollAreaPrimitive.Scrollbar>
      </ScrollAreaPrimitive.Root>

      {/* Closing a tab with unsaved changes needs a decision. */}
      <Dialog
        open={pendingClose !== null}
        onOpenChange={(open) => {
          if (!open) setPendingClose(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save changes to {pendingClose?.split("/").pop()}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your changes will be lost if you don't save them.
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
                if (file)
                  void useProjectStore.getState().closeFile(file, { discard: true });
              }}
            >
              Don&apos;t save
            </Button>
            <Button
              disabled={!pendingDirty}
              onClick={() => {
                const file = pendingClose;
                setPendingClose(null);
                if (file) void useProjectStore.getState().closeFile(file);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Width of the fade at an edge that hides more tabs. */
const FADE = 24;

function fadeMask(start: boolean, end: boolean) {
  if (!start && !end) return undefined;
  const from = start ? `transparent, black ${FADE}px` : "black";
  const to = end ? `black calc(100% - ${FADE}px), transparent` : "black";
  return `linear-gradient(to right, ${from}, ${to})`;
}
