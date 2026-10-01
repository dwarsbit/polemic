import { IMAGE_EXTENSIONS, pathCompletionLabels } from "@/lib/completion";
import { wrapIncludeFigure } from "@/lib/editor-figure";
import type { FileEntry } from "@/lib/tauri";

/** How an asset is previewed. */
export type AssetKind = "raster" | "pdf" | "file";

/** \includegraphics-able image or PDF. */
export function isInsertableGraphics(path: string): boolean {
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function assetKind(path: string): AssetKind {
  const lower = path.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(lower)) return "raster";
  if (lower.endsWith(".pdf")) return "pdf";
  return "file";
}

/**
 * What clicking an asset inserts: `\includegraphics` (extension-less
 * when the stem is unambiguous among the sibling assets), a
 * `\bibliography` for .bib files (extension stripped, matching the
 * path completion), or the plain path for anything else.
 */
export function assetInsert(
  path: string,
  siblings: string[],
): { text: string; packages: string[] } {
  const lower = path.toLowerCase();
  if (isInsertableGraphics(path)) {
    const labels = pathCompletionLabels(siblings);
    const label =
      [...labels.entries()].find(([, p]) => p === path)?.[0] ?? path;
    return { text: `\\includegraphics{${label}}`, packages: ["graphicx"] };
  }
  if (lower.endsWith(".bib")) {
    return {
      text: `\\bibliography{${path.replace(/\.bib$/, "")}}`,
      packages: [],
    };
  }
  return { text: path, packages: [] };
}

/**
 * What dropping a file into the editor inserts: a full figure
 * environment for images/PDFs, `\input` for .tex files, and the
 * click-insert semantics for everything else.
 */
export function assetDropText(
  path: string,
  siblings: string[],
): { text: string; packages: string[] } {
  const lower = path.toLowerCase();
  if (isInsertableGraphics(path)) {
    const { text: include } = assetInsert(path, siblings);
    return { text: wrapIncludeFigure(include, path), packages: ["graphicx"] };
  }
  if (lower.endsWith(".tex")) {
    return { text: `\\input{${path.replace(/\.tex$/, "")}}`, packages: [] };
  }
  return assetInsert(path, siblings);
}

/** All non-.tex files in the tree, depth first. */
export function collectAssetPaths(entries: FileEntry[]): string[] {
  const out: string[] = [];
  const walk = (list: FileEntry[]) => {
    for (const entry of list) {
      if (entry.isDir) {
        walk(entry.children);
      } else if (!entry.path.toLowerCase().endsWith(".tex")) {
        out.push(entry.path);
      }
    }
  };
  walk(entries);
  return out;
}

/** The file-type filter categories of the asset panel. */
export type AssetFilter = "all" | "image" | "pdf" | "data" | "other";

const DATA_EXTENSIONS = [".csv", ".tsv", ".dat", ".txt", ".json", ".xml"];

export function assetFilterOf(path: string): Exclude<AssetFilter, "all"> {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|webp|bmp|eps)$/.test(lower)) return "image";
  if (DATA_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "data";
  return "other";
}

/**
 * Whether a `\includegraphics{ref}` argument refers to the asset:
 * either the exact path or the extension-less stem (LaTeX resolves
 * the extension itself).
 */
export function refMatchesAsset(ref: string, assetPath: string): boolean {
  const trimmed = ref.trim();
  if (trimmed === assetPath) return true;
  return assetPath.replace(/\.[^./]+$/, "") === trimmed;
}

/**
 * The concrete asset path a `\includegraphics` reference points at:
 * the exact path, or the extension-less stem match (LaTeX resolves
 * the extension itself). Null when no candidate matches.
 */
export function resolveAssetRef(
  ref: string,
  candidates: string[],
): string | null {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return null;
  if (candidates.includes(trimmed)) return trimmed;
  const stem = trimmed.replace(/\.[^./]+$/, "");
  return candidates.find((p) => p.replace(/\.[^./]+$/, "") === stem) ?? null;
}

/** "1.2 MB" style formatting. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
