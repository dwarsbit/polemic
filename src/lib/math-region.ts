/**
 * Detection of math regions in a LaTeX document: inline `$...$`,
 * `\(...\)`, display `$$...$$`, `\[...\]`, and math environments.
 * Comment-aware (`%` kills the rest of the line, also inside math)
 * and escape-aware (`\$`, `\\` are not delimiters).
 */

export interface MathRegion {
  /** Start of the opening delimiter. */
  from: number;
  /** End of the closing delimiter (exclusive). */
  to: number;
  /** The math between the delimiters, environment stripped. */
  source: string;
  /** Display style (`\[`, `$$`, display environments). */
  display: boolean;
  /** Environment name for `\begin{...}` regions, null for delimiters. */
  environment: string | null;
}

/** Environments whose body is a math region on its own. */
const MATH_ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "displaymath",
  "math",
  "cases",
  "aligned",
  "gathered",
  "split",
  "subarray",
]);

/**
 * Position of the closing delimiter at or after `from`, skipping
 * comments and escape sequences; -1 when not found.
 */function findCloser(
  text: string,
  from: number,
  isCloser: (text: string, at: number) => boolean,
): number {
  let i = from;
  let inComment = false;
  while (i < text.length) {
    const ch = text[i];
    if (inComment) {
      if (ch === "\n") inComment = false;
      i++;
      continue;
    }
    if (ch === "%") {
      inComment = true;
      i++;
      continue;
    }
    if (ch === "\\") {
      if (text[i + 1] === "\\") {
        i += 2;
        continue;
      }
      if (isCloser(text, i)) return i;
      i += 2; // escaped character such as \$ or \%
      continue;
    }
    if (isCloser(text, i)) return i;
    i++;
  }
  return -1;
}

/** Does the math region [from, to) contain pos? */
function contains(region: MathRegion, pos: number): boolean {
  return region.from <= pos && pos <= region.to;
}

/**
 * The innermost math region containing `pos`, or null: also null when
 * the region is incomplete (still being typed, no closing delimiter).
 */
export function findMathRegion(text: string, pos: number): MathRegion | null {
  let i = 0;
  let inComment = false;
  while (i < text.length) {
    const open = openRegion(text, i, inComment);
    if (open !== null) {
      if (open.from > pos) return null; // regions are ordered
      if (contains(open, pos)) return open;
      i = open.to; // regions do not overlap
      continue;
    }

    const ch = text[i];
    if (ch === "\\") {
      // Not a math opener (those are handled above): skip the escaped
      // character so \$ or \] is never mistaken for a delimiter.
      i += 2;
      continue;
    }
    if (inComment) {
      if (ch === "\n") inComment = false;
    } else if (ch === "%") {
      inComment = true;
    }
    i++;
  }
  return null;
}

/** The math region opening exactly at `i`, if any (null otherwise). */
function openRegion(text: string, i: number, inComment: boolean): MathRegion | null {
  if (inComment) return null;
  const ch = text[i];

  if (ch === "$") {
    const display = text[i + 1] === "$";
    const closer = display
      ? (t: string, at: number) => t.startsWith("$$", at)
      : (t: string, at: number) => t[at] === "$" && t[at + 1] !== "$";
    const close = findCloser(text, i + (display ? 2 : 1), closer);
    if (close === -1) return null;
    const innerFrom = i + (display ? 2 : 1);
    return {
      from: i,
      to: close + (display ? 2 : 1),
      source: text.slice(innerFrom, close),
      display,
      environment: null,
    };
  }

  if (ch !== "\\") return null;

  // \[ ... \] and \( ... \)
  for (const [open2, close2, display] of [
    ["\\[", "\\]", true],
    ["\\(", "\\)", false],
  ] as const) {
    if (text.startsWith(open2, i)) {
      const close = findCloser(text, i + 2, (t, at) => t.startsWith(close2, at));
      if (close === -1) return null;
      return {
        from: i,
        to: close + 2,
        source: text.slice(i + 2, close),
        display,
        environment: null,
      };
    }
  }

  // \begin{env} ... \end{env} for math environments
  if (text.startsWith("\\begin{", i)) {
    const nameEnd = text.indexOf("}", i + 7);
    if (nameEnd === -1) return null;
    const env = text.slice(i + 7, nameEnd);
    if (!MATH_ENVIRONMENTS.has(env)) return null;
    const endMarker = `\\end{${env}}`;
    const close = findCloser(text, nameEnd + 1, (t, at) => t.startsWith(endMarker, at));
    if (close === -1) return null;
    return {
      from: i,
      to: close + endMarker.length,
      source: text.slice(nameEnd + 1, close),
      display: env !== "math",
      environment: env,
    };
  }

  return null;
}

/**
 * Cross-reference annotations that renderers cannot parse, stripped
 * from a region's source before previewing: \label{...}, \nonumber,
 * \notag.
 */
export function stripMathAnnotations(source: string): string {
  return source.replace(/\\(?:label|nonumber|notag)(?:\{[^{}]*\})?/g, "");
}
