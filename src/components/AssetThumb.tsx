import { useEffect, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { File as FileIcon, Film, Image as ImageIcon } from "lucide-react";
import type { AssetKind } from "@/lib/assets";
import { readAsset } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const THUMB_WIDTH = 240;

function KindIcon({ kind }: { kind: AssetKind }) {
  if (kind === "raster")
    return <ImageIcon className="size-6 text-muted-foreground" />;
  if (kind === "pdf") return <FileIcon className="size-6 text-muted-foreground" />;
  return <Film className="size-6 text-muted-foreground" />;
}

/**
 * A preview of one asset: raster images directly, PDFs via their
 * first page, other kinds as a type icon. `fill` sizes the preview to
 * its container; `shrink` lets it size to the picture (capped), so a
 * hovercard can wrap the image exactly.
 */
export function AssetThumb({
  path,
  kind,
  fit = "fill",
}: {
  path: string;
  kind: AssetKind;
  fit?: "fill" | "shrink";
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      const { project } = useProjectStore.getState();
      if (!project || kind === "file") return;
      try {
        const bytes = await readAsset(project.path, path);
        if (cancelled) return;
        if (kind === "raster") {
          objectUrl = URL.createObjectURL(
            new Blob([bytes.slice().buffer as ArrayBuffer]),
          );
          setSrc(objectUrl);
        } else {
          const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
          const page = await doc.getPage(1);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: THUMB_WIDTH / base.width,
          });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          doc.cleanup();
          if (!cancelled) setSrc(canvas.toDataURL());
        }
      } catch {
        // Preview failure falls back to the type icon.
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [path, kind]);

  if (src === null) {
    return <KindIcon kind={kind} />;
  }
  const mediaClass =
    fit === "shrink"
      ? "max-h-[200px] max-w-[280px] rounded-lg object-contain"
      : "h-full w-full object-contain";
  return (
    <img src={src} alt="" draggable={false} className={mediaClass} />
  );
}
