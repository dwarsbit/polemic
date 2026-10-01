/**
 * Parsing of \usepackage commands: what the package manager lists,
 * and how removing a package edits the source (a command may load
 * several packages, so removal rewrites the name list; a mid-line
 * command keeps its surrounding text).
 */

export interface UsepackageCommand {
  /** The command's range, [from, to). */
  from: number;
  to: number;
  /** The options text between the brackets, null when absent. */
  options: string | null;
  /** The package names between the braces. */
  names: string[];
}

const USEPACKAGE_RE = /\\usepackage(\[[^\]]*\])?\{([^}]*)\}/g;

/** All \usepackage commands in the document, in order. */
export function parseUsepackage(doc: string): UsepackageCommand[] {
  const out: UsepackageCommand[] = [];
  USEPACKAGE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = USEPACKAGE_RE.exec(doc)) !== null) {
    out.push({
      from: match.index,
      to: match.index + match[0].length,
      options: match[1] === undefined ? null : match[1].slice(1, -1),
      names: match[2]
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    });
  }
  return out;
}

/** The names loaded by every \usepackage, deduplicated in order. */
export function loadedPackages(doc: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const command of parseUsepackage(doc)) {
    for (const name of command.names) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

/** One source replacement: replacing [from, to) with `insert`. */
export interface SourceEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * How to remove one package from the document: a command that loads
 * only it is deleted (whole line when nothing else is on it), and a
 * multi-package command is rewritten without it. Null when the
 * document does not load the package.
 */
export function planUsepackageRemoval(
  doc: string,
  name: string,
): SourceEdit | null {
  for (const command of parseUsepackage(doc)) {
    if (!command.names.includes(name)) continue;
    const remaining = command.names.filter((n) => n !== name);
    if (remaining.length === 0) {
      // A line of its own (modulo whitespace) disappears entirely.
      const lineStart = doc.lastIndexOf("\n", command.from) + 1;
      const lineEnd =
        doc.indexOf("\n", command.to) === -1
          ? doc.length
          : doc.indexOf("\n", command.to);
      const line = doc.slice(lineStart, lineEnd);
      const stripped = line.replace(/%[^\n]*$/, "").trim();
      if (stripped === doc.slice(command.from, command.to)) {
        return { from: lineStart, to: Math.min(doc.length, lineEnd + 1), insert: "" };
      }
      return { from: command.from, to: command.to, insert: "" };
    }
    const options = command.options === null ? "" : `[${command.options}]`;
    return {
      from: command.from,
      to: command.to,
      insert: `\\usepackage${options}{${remaining.join(", ")}}`,
    };
  }
  return null;
}
