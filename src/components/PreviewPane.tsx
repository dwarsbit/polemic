import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  ZoomIn,
  X,
  ZoomOut,
} from "lucide-react";
import { CompileErrorActions } from "@/components/CompileSettingsSection";
import { openPdf, synctexBackward } from "@/lib/tauri";
import { exportPdfAs } from "@/lib/pdf-export";
import { modKey, formatShortcut } from "@/lib/platform";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Cmd/Ctrl+click in the PDF: jump to the source line (SyncTeX backward).
function onCanvasClick(event: MouseEvent) {
  if (!(event.metaKey || event.ctrlKey)) return;
  const canvas = event.currentTarget as HTMLCanvasElement;
  const page = Number(canvas.dataset.page);
  const pdfWidth = Number(canvas.dataset.pdfWidth);
  const pdfHeight = Number(canvas.dataset.pdfHeight);
  const x = (event.offsetX / canvas.clientWidth) * pdfWidth;
  const y = (event.offsetY / canvas.clientHeight) * pdfHeight;
  void (async () => {
    const { project, mainFile } = useProjectStore.getState();
    if (!project || !mainFile) return;
    try {
      const hit = await synctexBackward(project.path, mainFile, page, x, y);
      await useProjectStore.getState().openFile(hit.file);
      useEditorStore.getState().jumpTo(hit.line);
    } catch (e) {
      usePreviewStore.getState().setNotice(`Could not jump to the source: ${e}`);
    }
  })();
}

export function PreviewPane() {
  const status = usePreviewStore((s) => s.status);
  const pdfBytes = usePreviewStore((s) => s.pdfBytes);
  const error = usePreviewStore((s) => s.error);
  const errorKind = usePreviewStore((s) => s.errorKind);
  const notice = usePreviewStore((s) => s.notice);
  const scrollTarget = usePreviewStore((s) => s.scrollTarget);
  const scrollVersion = usePreviewStore((s) => s.scrollVersion);
  const zoom = usePreviewStore((s) => s.zoom);
  const zoomIn = usePreviewStore((s) => s.zoomIn);
  const zoomOut = usePreviewStore((s) => s.zoomOut);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // Refit the pages when the preview pane is resized.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.round(entry.contentRect.width));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Render the PDF document. Zoom 1 = fit pane width.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfBytes || containerWidth === 0) return;
    let cancelled = false;

    (async () => {
      // pdf.js transfers ownership of the buffer to the worker, so pass a copy.
      const doc = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise;
      if (cancelled) return;
      container.replaceChildren();
      setPageCount(doc.numPages);
      setCurrentPage(1);
      const fitWidth = containerWidth;
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        if (cancelled) return;
        const page = await doc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const fitScale = Math.max(0.1, fitWidth / base.width);
        const viewport = page.getViewport({ scale: fitScale * zoom });
        // Back the canvas at device resolution so text stays sharp on
        // HiDPI screens; its CSS size stays the fitted viewport.
        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.className = "block border-b bg-white shadow-sm";
        canvas.dataset.page = String(pageNumber);
        canvas.dataset.pdfWidth = String(base.width);
        canvas.dataset.pdfHeight = String(base.height);
        canvas.addEventListener("click", onCanvasClick);
        container.appendChild(canvas);
        await page.render({
          canvas,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        }).promise;
      }
    })().catch((e) => {
      if (!cancelled) {
        usePreviewStore.setState({
          status: "error",
          error: `failed to render PDF: ${e}`,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pdfBytes, zoom, containerWidth]);

  // Forward search: scroll to (and briefly highlight) the requested spot.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !scrollTarget) return;
    const canvas = container.querySelector<HTMLCanvasElement>(
      `canvas[data-page="${scrollTarget.page}"]`,
    );
    if (!canvas) return;
    const scaleX = canvas.clientWidth / Number(canvas.dataset.pdfWidth);
    const scaleY = canvas.clientHeight / Number(canvas.dataset.pdfHeight);
    const left = canvas.offsetLeft + scrollTarget.x * scaleX;
    const top = canvas.offsetTop + scrollTarget.y * scaleY;

    const highlight = document.createElement("div");
    highlight.className =
      "pointer-events-none absolute rounded border-2 border-primary bg-primary/10";
    highlight.style.left = `${left}px`;
    highlight.style.top = `${top}px`;
    highlight.style.width = "160px";
    highlight.style.height = "14px";
    container.appendChild(highlight);
    container.scrollTo({ top: Math.max(0, top - 80), behavior: "smooth" });
    const timer = setTimeout(() => highlight.remove(), 1600);
    return () => clearTimeout(timer);
  }, [scrollVersion, scrollTarget]);

  // Track which page is at the top of the viewport.
  function updateCurrentPage() {
    const container = scrollRef.current;
    if (!container) return;
    const canvases = container.querySelectorAll<HTMLCanvasElement>("canvas[data-page]");
    const top = container.scrollTop + 20;
    for (const canvas of canvases) {
      if (canvas.offsetTop + canvas.offsetHeight >= top) {
        setCurrentPage(Number(canvas.dataset.page));
        return;
      }
    }
  }

  // Copy the built PDF to a location chosen by the user.
  async function handleExport() {
    await exportPdfAs();
  }

  async function handleOpenPdf() {
    const { project, mainFile } = useProjectStore.getState();
    if (!project || !mainFile) return;
    try {
      await openPdf(project.path, mainFile);
    } catch (e) {
      usePreviewStore.getState().setNotice(String(e));
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="@container flex h-9 shrink-0 items-center gap-2 border-b px-3 text-muted-foreground">
        <span className="text-xs font-medium text-foreground">Preview</span>
        {pageCount > 0 && (
          <span className="text-2xs whitespace-nowrap tabular-nums">
            {currentPage} / {pageCount}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <span className="mr-1 hidden text-2xs whitespace-nowrap @sm:inline">
            {modKey}click: source
          </span>
          <button
            type="button"
            className="rounded-md p-1 hover:bg-accent hover:text-foreground"
            title={`Export PDF… (${formatShortcut("Mod+E")})`}
            onClick={() => void handleExport()}
          >
            <Download className="size-3.5" />
          </button>
          <button
            type="button"
            className="rounded-md p-1 hover:bg-accent hover:text-foreground"
            title="Open in default viewer"
            onClick={() => void handleOpenPdf()}
          >
            <ExternalLink className="size-3.5" />
          </button>
          <button
            type="button"
            className="rounded-md p-1 hover:bg-accent hover:text-foreground"
            title="Zoom out"
            onClick={zoomOut}
          >
            <ZoomOut className="size-3.5" />
          </button>
          <span className="w-9 text-center text-2xs tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="rounded-md p-1 hover:bg-accent hover:text-foreground"
            title="Zoom in"
            onClick={zoomIn}
          >
            <ZoomIn className="size-3.5" />
          </button>
          {status === "compiling" && <Loader2 className="ml-1 size-3.5 animate-spin" />}
        </div>
      </div>
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-auto bg-muted/40"
        onScroll={updateCurrentPage}
      >
        {notice !== null && (
          <div className="sticky top-0 z-10 flex items-start gap-2 border-b bg-card px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span className="flex-1 whitespace-pre-wrap">{notice}</span>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-accent"
              title="Dismiss"
              onClick={() => usePreviewStore.getState().setNotice(null)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {pdfBytes && status === "error" && (
          // The last good PDF stays visible; say that it is out of date.
          <div className="sticky top-0 z-10 flex items-start gap-2 border-b bg-card px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <div className="flex-1 space-y-2">
              <p className="max-h-24 overflow-auto whitespace-pre-wrap">
                {error ??
                  "The last compile failed. This is the previous PDF; the errors are in Issues."}
              </p>
              <CompileErrorActions kind={error ? errorKind : null} />
            </div>
          </div>
        )}
        {pdfBytes ? (
          <div ref={containerRef} className="mx-auto w-full" />
        ) : status === "error" && error ? (
          <div className="flex h-full flex-col items-center gap-2 p-6">
            <AlertTriangle className="size-8 text-destructive" />
            <p className="text-sm font-medium">The compile failed</p>
            <pre className="max-h-full w-full overflow-auto rounded bg-card p-3 font-mono text-xs whitespace-pre-wrap">
              {error}
            </pre>
            <CompileErrorActions kind={errorKind} />
          </div>
        ) : status === "error" ? (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-64 text-center text-sm text-muted-foreground">
              The errors are listed in Issues, below the editor.
            </p>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="flex max-w-64 flex-col items-center gap-2 text-muted-foreground">
              <FileText className="size-8" />
              <p className="text-center text-sm">
                Compile to see the PDF here. {formatShortcut("Mod+S")} saves and
                compiles.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
