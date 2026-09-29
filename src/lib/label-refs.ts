/**
 * Positions of \label{...} and \ref-family commands in a LaTeX source,
 * for navigation and lint hints. Comment-aware (a % hides the rest of
 * the line) and escape-aware (\\ is not a command start).
 */

export interface NamePos {
  name: string;
  /** Start of the whole command (the backslash). */
  from: number;
  /** End of the closing brace (exclusive). */
  to: number;
}

/** Commands that reference a label. */
export const REF_COMMANDS = [
  "ref",
  "eqref",
  "pageref",
  "autoref",
  "vref",
  "cref",
  "Cref",
] as const;

function scan(source: string, commands: readonly string[]): NamePos[] {
  const found: NamePos[] = [];
  let inComment = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inComment) {
      if (ch === "\n") inComment = false;
      continue;
    }
    if (ch === "%") {
      inComment = true;
      continue;
    }
    if (ch !== "\\") continue;
    // Escaped backslash: not a command start.
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && source[j] === "\\"; j--) backslashes++;
    if (backslashes % 2 === 1) continue;
    const command = commands.find((name) => source.startsWith(name, i + 1));
    if (command === undefined || source[i + 1 + command.length] !== "{") continue;
    const nameStart = i + 2 + command.length;
    const close = source.indexOf("}", nameStart);
    if (close === -1) break; // still being typed
    found.push({
      name: source.slice(nameStart, close),
      from: i,
      to: close + 1,
    });
    i = close; // continue after the command
  }
  return found;
}

/** All \label{...} occurrences, in document order. */
export function extractLabelPositions(source: string): NamePos[] {
  return scan(source, ["label"]);
}

/** All \ref-family occurrences, in document order. */
export function extractRefPositions(source: string): NamePos[] {
  return scan(source, REF_COMMANDS);
}

/** The ref command whose argument contains pos, if any. */
export function refAt(source: string, pos: number): NamePos | null {
  return extractRefPositions(source).find((ref) => ref.from <= pos && pos <= ref.to) ?? null;
}

/** The label command whose argument contains pos, if any. */
export function labelAt(source: string, pos: number): NamePos | null {
  return (
    extractLabelPositions(source).find((label) => label.from <= pos && pos <= label.to) ?? null
  );
}

/** The 1-based line number of the label, or null when absent. */
export function labelLine(source: string, name: string): number | null {
  const label = extractLabelPositions(source).find((entry) => entry.name === name);
  if (label === undefined) return null;
  return source.slice(0, label.from).split("\n").length;
}
