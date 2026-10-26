import { IMAGE_EXTENSIONS } from "@/lib/completion";
import type { SourceEdit } from "@/lib/label-index";

/**
 * \includegraphics references and \graphicspath folders in a LaTeX
 * source, and how LaTeX resolves a reference to a project file —
 * for the missing-file lint hint and the asset panel's usage counts.
 * latexmk runs in the project root, so paths resolve from there.
 */

export interface GraphicsRef {
  /** The path argument, trimmed. */
  path: string;
  /** Start of the command (the backslash). */
  from: number;
  /** End of the closing brace (exclusive). */
  to: number;
}

const INCLUDE_RE = /\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g;
const GRAPHICSPATH_RE = /\\graphicspath\s*\{((?:\s*\{[^}]*\})*)\s*\}/g;

/** Blank out % comments (keeping offsets), escape-aware. */
function stripComments(source: string): string {
  return source.replace(
    /(^|[^\\])((?:\\\\)*)%[^\n]*/g,
    (match, pre: string, esc: string) =>
      pre + esc + " ".repeat(match.length - pre.length - esc.length),
  );
}

/** All \includegraphics references, in document order. */
export function extractGraphicsRefs(source: string): GraphicsRef[] {
  const out: GraphicsRef[] = [];
  for (const m of stripComments(source).matchAll(INCLUDE_RE)) {
    const path = m[1].trim();
    if (path.length === 0) continue;
    out.push({ path, from: m.index, to: m.index + m[0].length });
  }
  return out;
}

/** The folders of every \graphicspath{{a/}{b/}} in the source. */
export function extractGraphicsPaths(source: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(source).matchAll(GRAPHICSPATH_RE)) {
    for (const dir of m[1].matchAll(/\{([^}]*)\}/g)) {
      const trimmed = dir[1].trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out;
}

/** Collapse ./ and ../ segments; null when the path leaves the root. */
function normalize(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

/** Whether a reference can be checked: no macros, no absolute path. */
export function isCheckableRef(ref: string): boolean {
  return !/[\\#]/.test(ref) && !ref.startsWith("/") && !/^[A-Za-z]:/.test(ref);
}

/**
 * The project file a reference resolves to, trying the project root
 * and each \graphicspath folder, with the exact name first and then
 * the graphics extensions LaTeX appends to an extension-less name.
 * Null when nothing matches (or the reference cannot be checked).
 */
export function resolveGraphicsRef(
  ref: string,
  files: ReadonlySet<string>,
  graphicsPaths: readonly string[] = [],
): string | null {
  if (!isCheckableRef(ref)) return null;
  for (const dir of ["", ...graphicsPaths]) {
    const base = normalize(dir === "" ? ref : `${dir.replace(/\/?$/, "/")}${ref}`);
    if (base === null || base.length === 0) continue;
    if (files.has(base)) return base;
    for (const ext of IMAGE_EXTENSIONS) {
      if (files.has(base + ext)) return base + ext;
    }
  }
  return null;
}

/** A file or folder rename: `from` and everything under it moves to `to`. */
export interface PathRename {
  from: string;
  to: string;
}

/** Where a path ends up after the rename; null when it does not move. */
function renamed(path: string, rename: PathRename): string | null {
  if (path === rename.from) return rename.to;
  if (path.startsWith(`${rename.from}/`))
    return rename.to + path.slice(rename.from.length);
  return null;
}

/** The folder a reference resolved through ("" for the project root),
 *  and whether LaTeX appended the extension. */
function matchOf(
  ref: string,
  resolved: string,
  graphicsPaths: readonly string[],
): { dir: string; implied: boolean } | null {
  for (const dir of ["", ...graphicsPaths]) {
    const base = normalize(dir === "" ? ref : `${dir.replace(/\/?$/, "/")}${ref}`);
    if (base === null) continue;
    if (base === resolved) return { dir, implied: false };
    if (
      resolved.startsWith(base) &&
      IMAGE_EXTENSIONS.includes(resolved.slice(base.length))
    ) {
      return { dir, implied: true };
    }
  }
  return null;
}

/**
 * Edits keeping \includegraphics references (and \graphicspath
 * folders) pointing at their files after a file or folder rename.
 * References resolve against the project before the rename (`files`,
 * `graphicsPaths`); each keeps its style: relative to the same
 * \graphicspath folder when the file is still under it, otherwise from
 * the project root, and extension-less when it was.
 */
export function planGraphicsRename(
  source: string,
  rename: PathRename,
  files: ReadonlySet<string>,
  graphicsPaths: readonly string[],
): SourceEdit[] {
  const edits: SourceEdit[] = [];
  const stripped = stripComments(source);
  for (const m of stripped.matchAll(GRAPHICSPATH_RE)) {
    const listStart = m.index + m[0].indexOf("{") + 1;
    for (const entry of m[1].matchAll(/\{([^}]*)\}/g)) {
      const dir = entry[1].trim();
      const norm = normalize(dir);
      const moved = norm === null || norm === "" ? null : renamed(norm, rename);
      if (moved === null) continue;
      const from = listStart + entry.index + 1;
      edits.push({
        from,
        to: from + entry[1].length,
        insert: dir.endsWith("/") ? `${moved}/` : moved,
      });
    }
  }
  for (const ref of extractGraphicsRefs(source)) {
    const resolved = resolveGraphicsRef(ref.path, files, graphicsPaths);
    if (resolved === null) continue;
    const target = renamed(resolved, rename);
    const match = matchOf(ref.path, resolved, graphicsPaths);
    if (target === null || match === null) continue;
    let spec = target;
    const dir = normalize(match.dir);
    if (dir !== null && dir !== "") {
      const newDir = renamed(dir, rename) ?? dir;
      if (target.startsWith(`${newDir}/`)) spec = target.slice(newDir.length + 1);
    }
    if (match.implied) {
      const ext = IMAGE_EXTENSIONS.find((e) => spec.endsWith(e));
      if (ext !== undefined) spec = spec.slice(0, -ext.length);
    }
    if (spec === ref.path) continue;
    // The path argument is the command's last {...}.
    const open = source.lastIndexOf("{", ref.to - 1);
    edits.push({ from: open + 1, to: ref.to - 1, insert: spec });
  }
  return edits;
}
