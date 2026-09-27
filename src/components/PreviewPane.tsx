import { useEffect, useRef } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";
import { synctexBackward } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const RENDER_SCALE = 1.2;

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
      usePreviewStore.setState({ status: "error", error: String(e) });
    }
  })();
}

export function PreviewPane() {
  const status = usePreviewStore((s) => s.status);
  const pdfBytes = usePreviewStore((s) => s.pdfBytes);
  const error = usePreviewStore((s) => s.error);
  const scrollTarget = usePreviewStore((s) => s.scrollTarget);
  const scrollVersion = usePreviewStore((s) => s.scrollVersion);
  const containerRef = useRef<HTMLDivElement>(null);

  // Render the PDF document.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfBytes) return;
    let cancelled = false;

    (async () => {
      // pdf.js transfers ownership of the buffer to the worker, so pass a copy.
      const doc = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise;
      if (cancelled) return;
      container.replaceChildren();
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        if (cancelled) return;
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = "block w-full border-b bg-white shadow-sm";
        canvas.dataset.page = String(pageNumber);
        canvas.dataset.pdfWidth = String(viewport.width / RENDER_SCALE);
        canvas.dataset.pdfHeight = String(viewport.height / RENDER_SCALE);
        canvas.addEventListener("click", onCanvasClick);
        container.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
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
  }, [pdfBytes]);

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

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        PREVIEW
        <span className="text-[10px]">Cmd+click: jump to source</span>
        {status === "compiling" && <Loader2 className="size-3.5 animate-spin" />}
      </div>
      <div className="relative flex-1 overflow-y-auto bg-muted/40">
        {status === "error" && error ? (
          <div className="flex h-full flex-col items-center gap-2 p-6">
            <AlertTriangle className="size-8 text-destructive" />
            <p className="text-sm font-medium">Compilation problem</p>
            <pre className="max-h-full w-full overflow-auto rounded bg-card p-3 font-mono text-xs whitespace-pre-wrap">
              {error}
            </pre>
          </div>
        ) : status === "error" ? (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-64 text-center text-sm text-muted-foreground">
              Compilation failed. See the issues panel below the editor.
            </p>
          </div>
        ) : pdfBytes ? (
          <div ref={containerRef} className="mx-auto w-full max-w-[2000px]" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="flex max-w-64 flex-col items-center gap-2 text-muted-foreground">
              <FileText className="size-8" />
              <p className="text-center text-sm">
                Press Compile (or Ctrl+S) to build and preview the PDF.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
