import { IMAGE_EXTENSIONS } from "@/lib/completion";

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
