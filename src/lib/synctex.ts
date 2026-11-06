// SyncTeX in the browser build: a point on a PDF page → the source file and line (backward), and a
// source line → its place in the PDF (forward). The desktop app asks the `synctex` program; the
// browser reads the .synctex file itself. Backward search is the review page's
// (polemic-server apps/web/lib/synctex.ts); keep the two in step.
//
// The file lists inputs (`Input:<tag>:<name>`), then per page (`{<page>` … `}<page>`) nested
// boxes and nodes with `<tag>,<line>:<x>,<y>` and, for boxes, `:<width>,<height>,<depth>`.
// Coordinates are in scaled points (65536 sp = 1 TeX pt) times Unit, from the page's top-left
// corner; 65781.76 sp make one PDF point.

const SP_PER_BP = 65781.76;

interface Node {
  tag: number;
  line: number;
  x: number;
  y: number;
}

interface Box extends Node {
  width: number;
  height: number;
  depth: number;
  /** Nodes directly inside: glyphs, kerns, glue, math, rules. */
  nodes: Node[];
}

export interface SyncTex {
  /** Input tag → file name as TeX saw it. */
  inputs: Map<number, string>;
  /** Page (1-based) → its horizontal boxes, in PDF points. */
  pages: Map<number, Box[]>;
}

export interface SourcePoint {
  file: string;
  line: number;
}

const RECORD = /^([[(hvxkg$])(\d+),(\d+):(-?\d+),(-?\d+)(?::(-?\d+),(-?\d+),(-?\d+))?/;

export function parseSyncTex(text: string): SyncTex {
  const inputs = new Map<number, string>();
  const pages = new Map<number, Box[]>();
  let scale = 1 / SP_PER_BP;
  let xOffset = 0;
  let yOffset = 0;
  let page: Box[] | null = null;
  const open: (Box | null)[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (page === null) {
      const input = /^Input:(\d+):(.*)$/.exec(line);
      if (input) inputs.set(Number(input[1]), input[2]!);
      else if (line.startsWith("Unit:")) scale *= Number(line.slice(5)) || 1;
      else if (line.startsWith("Magnification:"))
        scale *= (Number(line.slice(14)) || 1000) / 1000;
      else if (line.startsWith("X Offset:")) xOffset = Number(line.slice(9)) || 0;
      else if (line.startsWith("Y Offset:")) yOffset = Number(line.slice(9)) || 0;
      const start = /^\{(\d+)$/.exec(line);
      if (start) {
        page = [];
        pages.set(Number(start[1]), page);
        open.length = 0;
      }
      continue;
    }
    if (line.startsWith("}")) {
      page = null;
      continue;
    }
    if (line === ")" || line === "]") {
      open.pop();
      continue;
    }
    const match = RECORD.exec(line);
    if (!match) continue;
    const [, kind, tag, sourceLine, x, y, width, height, depth] = match;
    const node: Node = {
      tag: Number(tag),
      line: Number(sourceLine),
      x: (Number(x) + xOffset) * scale,
      y: (Number(y) + yOffset) * scale,
    };
    if (kind === "(") {
      const box: Box = {
        ...node,
        width: Number(width) * scale,
        height: Number(height) * scale,
        depth: Number(depth) * scale,
        nodes: [],
      };
      page.push(box);
      open.push(box);
    } else if (kind === "[") {
      open.push(null);
    } else if (kind !== "v") {
      // A node belongs to the innermost horizontal box around it.
      for (let i = open.length - 1; i >= 0; i--) {
        const box = open[i];
        if (box) {
          box.nodes.push(node);
          break;
        }
      }
    }
  }
  return { inputs, pages };
}

/** Distance from the point to the box, 0 inside; vertical distance counts double, lines are short. */
function distance(box: Box, x: number, y: number): number {
  const dx = x < box.x ? box.x - x : x > box.x + box.width ? x - box.x - box.width : 0;
  const top = box.y - Math.max(box.height, 1);
  const bottom = box.y + box.depth;
  const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
  return 2 * dy + dx;
}

/**
 * The input tag and line under a point of a page, in PDF points from the top-left; null when the
 * page has no boxes. The closest line box wins (the smallest when several hold the point), then
 * within it the node that ends the word under the point: glyph runs are recorded at their end.
 */
export function backward(
  sync: SyncTex,
  page: number,
  x: number,
  y: number,
): { tag: number; line: number } | null {
  let best: Box | null = null;
  let bestDistance = Infinity;
  for (const box of sync.pages.get(page) ?? []) {
    const d = distance(box, x, y);
    const smaller =
      best &&
      box.width * (box.height + box.depth) < best.width * (best.height + best.depth);
    if (d < bestDistance || (d === bestDistance && smaller)) {
      best = box;
      bestDistance = d;
    }
  }
  if (!best) return null;
  const nodes = best.nodes.filter((node) => node.line > 0).sort((a, b) => a.x - b.x);
  if (nodes.length === 0) return { tag: best.tag, line: best.line };
  let index = nodes.findIndex((node) => node.x >= x);
  if (index === -1) index = nodes.length - 1;
  // pdfTeX gives a paragraph's first word the line the paragraph ends on: trust the next node.
  const next = nodes[index + 1];
  if (next && next.tag === nodes[index]!.tag && next.line < nodes[index]!.line)
    index += 1;
  return { tag: nodes[index]!.tag, line: nodes[index]!.line };
}

/**
 * The project file an input name stands for: TeX records names as it opened them, absolute
 * (`/home/me/thesis/./chapters/intro.tex`) after a local compile and relative after one with
 * Polemic. The longest project path the name ends with wins.
 */
export function projectFileFor(name: string, files: readonly string[]): string | null {
  const normal = name
    .replace(/\\/g, "/")
    .replace(/\/\.\//g, "/")
    .replace(/^\.\//, "");
  let found: string | null = null;
  for (const path of files) {
    if (
      (normal === path || normal.endsWith(`/${path}`)) &&
      (!found || path.length > found.length)
    )
      found = path;
  }
  return found;
}

/** Backward search to a project file and line, or null outside the project's files. */
export function sourceAt(
  sync: SyncTex,
  files: readonly string[],
  page: number,
  x: number,
  y: number,
): SourcePoint | null {
  const hit = backward(sync, page, x, y);
  const name = hit && sync.inputs.get(hit.tag);
  const file = name ? projectFileFor(name, files) : null;
  return file && hit ? { file, line: hit.line } : null;
}

/**
 * Forward search: where a line of a project file is in the PDF, as the `synctex view` program
 * gives it (page, and the line box's left edge and baseline in PDF points from the top-left).
 * Without a record for the line itself, the nearest line after it counts, then the nearest
 * before it.
 */
export function forward(
  sync: SyncTex,
  files: readonly string[],
  file: string,
  line: number,
): { page: number; x: number; y: number } | null {
  const tags = new Set<number>();
  for (const [tag, name] of sync.inputs) {
    if (projectFileFor(name, files) === file) tags.add(tag);
  }
  if (tags.size === 0) return null;
  let best: { page: number; box: Box; line: number } | null = null;
  const rank = (found: number) =>
    found >= line ? found - line : line - found + 1_000_000;
  const pages = [...sync.pages.keys()].sort((a, b) => a - b);
  for (const page of pages) {
    for (const box of sync.pages.get(page)!) {
      for (const node of [box, ...box.nodes]) {
        if (!tags.has(node.tag) || node.line <= 0) continue;
        if (!best || rank(node.line) < rank(best.line))
          best = { page, box, line: node.line };
      }
    }
  }
  return best && { page: best.page, x: best.box.x, y: best.box.y };
}

/** Reads a .synctex.gz in the browser. */
export async function readSyncTexGz(bytes: ArrayBuffer): Promise<SyncTex> {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return parseSyncTex(await new Response(stream).text());
}
