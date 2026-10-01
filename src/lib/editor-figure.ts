/**
 * Figure wrapping and preamble package management, both served by the
 * mounted editor (the same handler pattern as editor-format). The pure
 * helpers are unit-tested; the handlers apply them to the live view.
 */

const INCLUDE_RE = /\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}/g;

/** The \includegraphics command containing `pos`, or on its line. */
export function findIncludeGraphics(
  doc: string,
  pos: number,
): { from: number; to: number; path: string } | null {
  let match: RegExpExecArray | null;
  INCLUDE_RE.lastIndex = 0;
  while ((match = INCLUDE_RE.exec(doc)) !== null) {
    if (match.index <= pos && pos <= match.index + match[0].length) {
      return { from: match.index, to: match.index + match[0].length, path: match[1] };
    }
  }
  // Not on the command: accept one on the same line as the cursor.
  INCLUDE_RE.lastIndex = 0;
  while ((match = INCLUDE_RE.exec(doc)) !== null) {
    const before = doc.lastIndexOf("\n", match.index);
    const after = doc.indexOf("\n", match.index);
    if (pos > before && (after === -1 || pos < after)) {
      return { from: match.index, to: match.index + match[0].length, path: match[1] };
    }
  }
  return null;
}

/** "figures/my-plot_v2.pdf" -> "fig:my-plot-v2". */
export function figureLabel(path: string): string {
  const stem = (path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `fig:${slug || "figure"}`;
}

/** Wrap the include command in a figure environment. */
export function wrapIncludeFigure(include: string, path: string): string {
  return [
    "\\begin{figure}[htbp]",
    "  \\centering",
    `  ${include}`,
    "  \\caption{Caption}",
    `  \\label{${figureLabel(path)}}`,
    "\\end{figure}",
  ].join("\n");
}

/** A figure scaffold with a placeholder include, when nothing is found. */
export function figureScaffold(): string {
  return wrapIncludeFigure("\\includegraphics[width=\\textwidth]{file}", "file");
}

const USEPACKAGE_RE = /\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/g;

/** Packages that are not \usepackage'd anywhere in the document. */
export function missingPackages(doc: string, packages: string[]): string[] {
  const loaded = new Set<string>();
  let match: RegExpExecArray | null;
  USEPACKAGE_RE.lastIndex = 0;
  while ((match = USEPACKAGE_RE.exec(doc)) !== null) {
    for (const name of match[1].split(",")) {
      loaded.add(name.trim());
    }
  }
  return packages.filter((name) => !loaded.has(name));
}

/**
 * Insert missing `\usepackage{...}` lines after the `\documentclass`
 * line. Returns the new document (the input when nothing is missing).
 */
export function insertPackages(
  doc: string,
  packages: string[],
): string {
  const missing = missingPackages(doc, packages);
  if (missing.length === 0) return doc;
  const classMatch = /\\documentclass[^\n]*\n/.exec(doc);
  const insert = missing.map((name) => `\\usepackage{${name}}\n`).join("");
  if (classMatch === null) {
    return doc + "\n" + insert.trimEnd();
  }
  const at = classMatch.index + classMatch[0].length;
  return doc.slice(0, at) + insert + doc.slice(at);
}

// --- Editor-served handlers -----------------------------------------------

type WrapFigureHandler = () => boolean;
type EnsurePackagesHandler = (packages: string[]) => void;

let wrapHandler: WrapFigureHandler | null = null;
let ensureHandler: EnsurePackagesHandler | null = null;

/** Called by the editor component to serve wrap requests. */
export function setWrapFigureHandler(h: WrapFigureHandler | null) {
  wrapHandler = h;
}

/** Called by the editor component to serve package requests. */
export function setEnsurePackagesHandler(h: EnsurePackagesHandler | null) {
  ensureHandler = h;
}

/**
 * Wrap the \includegraphics at the cursor in a figure environment
 * (a scaffold is inserted when none is found), ensuring graphicx is
 * loaded. Returns true when the document changed. No-op when the
 * editor is not mounted.
 */
export function wrapFigure(): boolean {
  const changed = wrapHandler?.() ?? false;
  if (changed) {
    ensureHandler?.(["graphicx"]);
  }
  return changed;
}

/** Add missing \usepackage lines to the open document. */
export function ensurePackages(packages: string[]): void {
  ensureHandler?.(packages);
}
