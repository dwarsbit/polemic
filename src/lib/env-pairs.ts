/**
 * Environment pair parsing: \begin{name} … \end{name} ranges, used by
 * the pairing extension (rename sync and auto-close). Nesting-correct:
 * with same-name nesting, an \end closes the innermost open \begin of
 * that name.
 */

export interface EnvNameRange {
  from: number;
  to: number;
}

export interface EnvPair {
  name: string;
  /** The name range inside \begin{...}. */
  beginName: EnvNameRange;
  /** The name range inside the matching \end{...}, null while unclosed. */
  endName: EnvNameRange | null;
  /** The whole \begin{...} command, [beginFrom, beginTo). */
  beginFrom: number;
  beginTo: number;
}

const ENV_RE = /\\(begin|end)\{([^}]*)\}/g;

export function parseEnvPairs(doc: string): EnvPair[] {
  const open: EnvPair[] = [];
  const closed: EnvPair[] = [];
  ENV_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENV_RE.exec(doc)) !== null) {
    const nameFrom = match.index + match[0].lastIndexOf("{") + 1;
    const nameTo = nameFrom + match[2].length;
    if (match[1] === "begin") {
      open.push({
        name: match[2],
        beginName: { from: nameFrom, to: nameTo },
        endName: null,
        beginFrom: match.index,
        beginTo: match.index + match[0].length,
      });
    } else {
      for (let i = open.length - 1; i >= 0; i--) {
        if (open[i].name === match[2]) {
          const pair = open.splice(i, 1)[0];
          pair.endName = { from: nameFrom, to: nameTo };
          closed.push(pair);
          break;
        }
      }
    }
  }
  return [...closed, ...open].sort((a, b) => a.beginFrom - b.beginFrom);
}

/** Which environment name (and its partner) a position is in. */
export interface EnvNameLocation {
  /** The name range containing the position. */
  range: EnvNameRange;
  /** The partner name range, null when the pair is unclosed. */
  partner: EnvNameRange | null;
}

export function envNameAt(doc: string, pos: number): EnvNameLocation | null {
  for (const pair of parseEnvPairs(doc)) {
    if (pos >= pair.beginName.from && pos <= pair.beginName.to) {
      return { range: pair.beginName, partner: pair.endName };
    }
    if (
      pair.endName !== null &&
      pos >= pair.endName.from &&
      pos <= pair.endName.to
    ) {
      return { range: pair.endName, partner: pair.beginName };
    }
  }
  return null;
}
