/**
 * Finding `\begin{document}` and `\end{document}` the way LaTeX does:
 * a marker inside a `%` comment, a `\verb` or a verbatim environment
 * is text, not the marker. A plain `indexOf` takes the first mention,
 * so a commented-out `\begin{document}` above the real one would cut
 * the preamble short.
 */

export const BEGIN_DOCUMENT = "\\begin{document}";
export const END_DOCUMENT = "\\end{document}";

const VERBATIM_ENVS = new Set([
  "verbatim",
  "verbatim*",
  "Verbatim",
  "lstlisting",
  "minted",
  "comment",
]);

/** End (exclusive) of a `\verb<d>...<d>` or `\verb*<d>...<d>` at `i`,
 *  or -1 when it does not close on its line before `limit`. */
export function verbEnd(src: string, i: number, limit = src.length): number {
  const m = /^\\verb\*?([^a-zA-Z*\s])/.exec(src.slice(i, i + 7));
  if (m === null) return -1;
  const bodyStart = i + m[0].length;
  const close = src.indexOf(m[1], bodyStart);
  const nl = src.indexOf("\n", bodyStart);
  const end = Math.min(nl === -1 ? src.length : nl, limit);
  if (close === -1 || close >= end) return -1;
  return close + 1;
}

/** The `marker` from `from`, outside comments, `\verb` and verbatim
 *  environments, or -1. */
function findMarker(src: string, marker: string, from: number): number {
  let i = from;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "%") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl + 1;
      continue;
    }
    if (ch !== "\\") {
      i++;
      continue;
    }
    if (src.startsWith(marker, i)) return i;
    const verb = verbEnd(src, i);
    if (verb !== -1) {
      i = verb;
      continue;
    }
    const env = /^\\begin\{([^}]*)\}/.exec(src.slice(i, i + 40))?.[1];
    if (env !== undefined && VERBATIM_ENVS.has(env)) {
      const close = src.indexOf(`\\end{${env}}`, i);
      if (close === -1) return -1;
      i = close + `\\end{${env}}`.length;
      continue;
    }
    i += 2;
  }
  return -1;
}

/** The offset of the real `\begin{document}`, or -1. */
export function findDocumentBegin(src: string): number {
  return findMarker(src, BEGIN_DOCUMENT, 0);
}

/** The offset of the real `\end{document}` at or after `from`, or -1. */
export function findDocumentEnd(src: string, from = 0): number {
  return findMarker(src, END_DOCUMENT, from);
}

/** The body range: inside `\begin{document}`…`\end{document}`, each
 *  side falling back to the start or end of the file when absent. */
export function documentBodyRange(src: string): [number, number] {
  const begin = findDocumentBegin(src);
  const start = begin === -1 ? 0 : begin + BEGIN_DOCUMENT.length;
  const end = findDocumentEnd(src, start);
  return [start, end === -1 ? src.length : end];
}
