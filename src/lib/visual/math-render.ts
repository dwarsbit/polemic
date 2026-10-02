import katex from "katex";
import { stripMathAnnotations } from "@/lib/math-region";

/** How a math node's `src` opens and closes. */
export interface MathSplit {
  body: string;
  env: string | null;
  /** The exact delimiters, so editing keeps the author's style. */
  prefix: string;
  suffix: string;
  display: boolean;
}

/** Split a math node's src into body, environment, and delimiters. */
export function splitMathSrc(src: string): MathSplit {
  if (src.startsWith("$$")) {
    return { body: src.slice(2, -2), env: null, prefix: "$$", suffix: "$$", display: true };
  }
  if (src.startsWith("\\[")) {
    return { body: src.slice(2, -2), env: null, prefix: "\\[", suffix: "\\]", display: true };
  }
  if (src.startsWith("\\(")) {
    return { body: src.slice(2, -2), env: null, prefix: "\\(", suffix: "\\)", display: false };
  }
  if (src.startsWith("$")) {
    return { body: src.slice(1, -1), env: null, prefix: "$", suffix: "$", display: false };
  }
  const m = /^\\begin\{([^}]*)\}([\s\S]*)\\end\{\1\}$/.exec(src);
  if (m !== null) {
    return {
      body: m[2],
      env: m[1],
      prefix: `\\begin{${m[1]}}`,
      suffix: `\\end{${m[1]}}`,
      display: true,
    };
  }
  return { body: src, env: null, prefix: "", suffix: "", display: false };
}

/** Environments KaTeX renders when wrapped back into `\begin{env}` (mirrors math-hover.ts). */
const KATEX_ENVIRONMENTS = new Set([
  "align",
  "align*",
  "alignat",
  "alignat*",
  "aligned",
  "alignedat",
  "cases",
  "dcases",
  "gather",
  "gather*",
  "gathered",
  "split",
  "subarray",
  "array",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
]);

/**
 * KaTeX HTML for a math node's src, or null when it cannot be
 * rendered (mid-typing, unsupported commands).
 */
export function renderMathHtml(src: string, display: boolean): string | null {
  const { body, env } = splitMathSrc(src);
  const stripped = stripMathAnnotations(body);
  const source =
    env !== null && KATEX_ENVIRONMENTS.has(env)
      ? `\\begin{${env}}${stripped}\\end{${env}}`
      : stripped;
  try {
    return katex.renderToString(source, { displayMode: display, throwOnError: true });
  } catch {
    return null;
  }
}
