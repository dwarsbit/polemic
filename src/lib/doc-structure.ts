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

/** The include spec for a project-relative path (idiomatic: no .tex). */
export function includeSpec(path: string): string {
  return path.endsWith(".tex") ? path.slice(0, -4) : path;
}

/** True when the line is an \input/\include referencing the path. */
function isIncludeLine(line: string, path: string): boolean {
  const spec = includeSpec(path);
  return [...stripComment(line).matchAll(/\\(?:input|include)\s*\{([^}]*)\}/g)].some(
    (match) => {
      const target = match[1].trim();
      return target === path || target === spec;
    },
  );
}

/**
 * Insert an include for the spec after the last existing include, or
 * before \end{document} when there are none, or at the end of the file.
 */
export function insertInclude(content: string, spec: string): string {
  const lines = content.split("\n");
  let insertAt = lines.findIndex((line) => line.includes("\\end{document}"));
  if (insertAt === -1) insertAt = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/\\(?:input|include)\s*\{/.test(stripComment(lines[i]))) {
      insertAt = i + 1;
      break;
    }
  }
  const includeLine = `\\input{${spec}}`;
  lines.splice(insertAt, 0, includeLine);
  return lines.join("\n");
}

/**
 * Rewrite include specs that reference oldPath so they point at newPath,
 * preserving each directive's extension style.
 */
export function replaceIncludeSpec(
  content: string,
  oldPath: string,
  newPath: string,
): string {
  const oldSpec = includeSpec(oldPath);
  const newSpec = includeSpec(newPath);
  const pattern = new RegExp(
    `\\\\(input|include)\\s*\\{(${escapeRegExp(oldPath)}|${escapeRegExp(oldSpec)})\\}`,
    "g",
  );
  return content.replace(pattern, (_match, directive, spec) => {
    const withExtension = spec.endsWith(".tex");
    return `\\${directive}{${withExtension ? `${newPath}` : newSpec}}`;
  });
}

/** Remove every include line referencing the path. */
export function removeInclude(content: string, path: string): string {
  return content
    .split("\n")
    .filter((line) => !isIncludeLine(line, path))
    .join("\n");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sort a file tree so entries appear in document order: .tex files by
 * their include position, directories by their earliest included
 * descendant. Entries not in the document keep their relative order
 * after the included ones. Purely a display concern.
 */
export function sortTreeByDocumentOrder<
  T extends { path: string; isDir: boolean; children: T[] },
>(entries: T[], positionOf: Map<string, number>): T[] {
  function keyOf(entry: T): number {
    if (!entry.isDir) {
      return positionOf.get(entry.path) ?? Number.POSITIVE_INFINITY;
    }
    let min = Number.POSITIVE_INFINITY;
    const walk = (list: T[]) => {
      for (const child of list) {
        if (!child.isDir) {
          const position = positionOf.get(child.path);
          if (position !== undefined && position < min) min = position;
        } else {
          walk(child.children);
        }
      }
    };
    walk(entry.children);
    return min;
  }

  return entries
    .map((entry, index) => ({ entry, index, key: keyOf(entry) }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map(({ entry }) =>
      entry.isDir
        ? { ...entry, children: sortTreeByDocumentOrder(entry.children, positionOf) }
        : entry,
    );
}

/** Split a line into [code, comment]; the comment starts at an unescaped %. */
function splitComment(line: string): [string, string] {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "%" && (i === 0 || line[i - 1] !== "\\")) {
      return [line.slice(0, i), line.slice(i)];
    }
  }
  return [line, ""];
}

/**
 * Rewrite include specs under a renamed directory:
 * \input{oldDir/intro} -> \input{newDir/intro}, preserving the
 * extension style of every directive. Commented includes are left alone.
 */
export function replaceIncludeSpecPrefix(
  content: string,
  fromDir: string,
  toDir: string,
): string {
  return content
    .split("\n")
    .map((line) => {
      const [code, comment] = splitComment(line);
      const rewritten = code.replace(
        /\\(input|include)\s*\{([^}]*)\}/g,
        (match, directive: string, rawSpec: string) => {
          const spec = rawSpec.trim();
          if (spec === fromDir || spec.startsWith(`${fromDir}/`)) {
            return `\\${directive}{${toDir}${spec.slice(fromDir.length)}}`;
          }
          return match;
        },
      );
      return rewritten + comment;
    })
    .join("\n");
}
