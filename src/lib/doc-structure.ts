/**
 * Whole-document structure: the ordered walk of files that make up a
 * LaTeX document, derived from \input{...} and \include{...} directives
 * in the main file (recursively, in source order).
 */

/** Strip comments (unescaped %) from a line of LaTeX source. */
function stripComment(line: string): string {
  let result = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "%" && (i === 0 || line[i - 1] !== "\\")) break;
    result += line[i];
  }
  return result;
}

/** All \input{...} and \include{...} targets in a file, in order. */
export function extractIncludes(text: string): string[] {
  const specs: string[] = [];
  for (const line of text.split("\n")) {
    const source = stripComment(line);
    for (const match of source.matchAll(/\\(?:input|include)\s*\{([^}]*)\}/g)) {
      const spec = match[1].trim();
      if (spec) specs.push(spec);
    }
  }
  return specs;
}

/**
 * Resolve an include spec to a project-relative path from the set of
 * known files. `\input{chapters/intro}` refers to chapters/intro.tex;
 * an explicit extension is kept as-is.
 */
export function resolveIncludePath(spec: string, files: string[]): string | null {
  const candidates = spec.endsWith(".tex") ? [spec] : [`${spec}.tex`, spec];
  for (const candidate of candidates) {
    if (files.includes(candidate)) return candidate;
  }
  return null;
}

/**
 * Walk the document starting at the main file, following includes in
 * source order (depth-first). Returns the ordered file paths; the main
 * file comes first, each included file at its position in the walk.
 * Cycles and unresolvable includes are skipped.
 */
export async function buildDocumentOrder(
  mainFile: string,
  readText: (path: string) => Promise<string | null>,
  files: string[],
): Promise<string[]> {
  const order: string[] = [];
  const visited = new Set<string>();

  async function visit(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    order.push(path);
    const text = await readText(path);
    if (text === null) return;
    for (const spec of extractIncludes(text)) {
      const resolved = resolveIncludePath(spec, files);
      if (resolved) await visit(resolved);
    }
  }

  await visit(mainFile);
  return order;
}
