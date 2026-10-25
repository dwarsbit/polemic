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
  /** The raw argument between the braces. */
  argFrom: number;
  argTo: number;
}

const INCLUDE_RE = /\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g;
const GRAPHICSPATH_RE = /\\graphicspath\s*\{((?:\s*\{[^}]*\})*)\s*\}/g;

/** Blank out % comments (keeping offsets), escape-aware. */
function stripComments(source: string): string {
  return source.replace(/(^|[^\\])((?:\\\\)*)%[^\n]*/g, (match, pre: string, esc: string) =>
    pre + esc + " ".repeat(match.length - pre.length - esc.length),
  );
}

/** All \includegraphics references, in document order. */
export function extractGraphicsRefs(source: string): GraphicsRef[] {
  const out: GraphicsRef[] = [];
  for (const m of stripComments(source).matchAll(INCLUDE_RE)) {
    const path = m[1].trim();
    if (path.length === 0) continue;
    const to = m.index + m[0].length;
    out.push({ path, from: m.index, to, argFrom: to - 1 - m[1].length, argTo: to - 1 });
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
  return resolveGraphicsRefIn(ref, files, graphicsPaths)?.path ?? null;
}

/** Like resolveGraphicsRef, plus the normalized \graphicspath folder
 *  the match came through ("" for the project root). */
export function resolveGraphicsRefIn(
  ref: string,
  files: ReadonlySet<string>,
  graphicsPaths: readonly string[] = [],
): { path: string; dir: string } | null {
  if (!isCheckableRef(ref)) return null;
  for (const dir of ["", ...graphicsPaths]) {
    const base = normalize(dir === "" ? ref : `${dir.replace(/\/?$/, "/")}${ref}`);
    if (base === null || base.length === 0) continue;
    const normalDir = normalize(dir) ?? "";
    if (files.has(base)) return { path: base, dir: normalDir };
    for (const ext of IMAGE_EXTENSIONS) {
      if (files.has(base + ext)) return { path: base + ext, dir: normalDir };
    }
  }
  return null;
}

const extensionOf = (path: string) => /\.[^./]+$/.exec(path)?.[0] ?? "";

/**
 * Rewrite the \includegraphics references whose file moved: `files`
 * is the project before the move, `remap` gives a file's new path (or
 * null when it did not move). The new reference keeps the old style:
 * relative to the same \graphicspath folder when the file is still
 * inside it, and extension-less when it was and the extension stayed.
 */
export function rewriteGraphicsRefs(
  source: string,
  files: ReadonlySet<string>,
  graphicsPaths: readonly string[],
  remap: (path: string) => string | null,
): string {
  let out = source;
  for (const ref of extractGraphicsRefs(source).reverse()) {
    const hit = resolveGraphicsRefIn(ref.path, files, graphicsPaths);
    if (hit === null) continue;
    const target = remap(hit.path);
    if (target === null || target === hit.path) continue;
    let next =
      hit.dir !== "" && target.startsWith(`${hit.dir}/`) ? target.slice(hit.dir.length + 1) : target;
    const oldExt = extensionOf(hit.path);
    if (!ref.path.endsWith(oldExt) && extensionOf(target) === oldExt) {
      next = next.slice(0, next.length - oldExt.length);
    }
    out = out.slice(0, ref.argFrom) + next + out.slice(ref.argTo);
  }
  return out;
}

/**
 * Rewrite \bibliography{a,b} entries (extension implied) and
 * \addbibresource{x.bib} paths whose .bib file moved.
 */
export function rewriteBibRefs(source: string, remap: (path: string) => string | null): string {
  return source
    .replace(/(\\bibliography\s*\{)([^}]*)\}/g, (match, head: string, list: string) => {
      let changed = false;
      const specs = list.split(",").map((raw) => {
        const spec = raw.trim();
        const file = spec.endsWith(".bib") ? spec : `${spec}.bib`;
        const target = isCheckableRef(spec) ? remap(normalize(file) ?? file) : null;
        if (target === null || !target.endsWith(".bib")) return raw;
        changed = true;
        return spec.endsWith(".bib") ? target : target.slice(0, -4);
      });
      return changed ? `${head}${specs.join(",")}}` : match;
    })
    .replace(/(\\addbibresource\s*(?:\[[^\]]*\]\s*)?\{)([^}]*)\}/g, (match, head: string, raw: string) => {
      const spec = raw.trim();
      const target = isCheckableRef(spec) ? remap(normalize(spec) ?? spec) : null;
      return target === null ? match : `${head}${target}}`;
    });
}
