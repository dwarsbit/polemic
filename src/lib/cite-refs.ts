/**
 * Citation commands: extraction of the \\cite-family with positions
 * (for hygiene, lint, and key rename refactoring), and detection of
 * the citation packages a project loads (for package-aware insert).
 * Pure: text in, data out.
 */

import type { ScannedFile, SourceEdit } from "./label-index";

export interface CitePos {
  key: string;
  /** Range of the key itself (no braces), for renames and hints. */
  from: number;
  to: number;
}

/**
 * All cite occurrences, in document order. Comment-aware (a % hides
 * the rest of the line) and escape-aware (\\\\ is not a command).
 * Recognizes any command name containing "cite" (case-insensitive)
 * with an optional star and up to two optional arguments — so
 * natbib's \\citep, biblatex's \\textcite, etc. all work.
 */
export function extractCitePositions(source: string): CitePos[] {
  const found: CitePos[] = [];
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
    const nameMatch = /^[A-Za-z]+/.exec(source.slice(i + 1));
    if (nameMatch === null || !nameMatch[0].toLowerCase().includes("cite")) {
      continue;
    }
    let at = i + 1 + nameMatch[0].length;
    if (source[at] === "*") at++;
    // Up to two optional arguments.
    for (let n = 0; n < 2 && source[at] === "["; n++) {
      const close = source.indexOf("]", at);
      if (close === -1) break;
      at = close + 1;
    }
    if (source[at] !== "{") continue;
    const close = source.indexOf("}", at);
    if (close === -1) break; // still being typed
    const keys = source.slice(at + 1, close);
    let keyAt = 0;
    for (const key of keys.split(",")) {
      const start = keyAt;
      keyAt += key.length + 1;
      const trimmed = key.trim();
      if (trimmed.length === 0) continue;
      const from = at + 1 + start + (key.length - key.trimStart().length);
      found.push({ key: trimmed, from, to: from + trimmed.length });
    }
    i = close;
  }
  return found;
}

/**
 * The citation commands offered for inserting, based on the packages
 * the project loads. \\cite always comes first; natbib and biblatex
 * add their common commands.
 */
export function detectCiteCommands(texTexts: string[]): string[] {
  const packages = new Set<string>();
  const re = /\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/g;
  for (const text of texTexts) {
    let match = re.exec(text);
    while (match !== null) {
      for (const name of match[1].split(",")) {
        packages.add(name.trim().toLowerCase());
      }
      match = re.exec(text);
    }
  }
  const commands = ["cite"];
  if (packages.has("natbib")) commands.push("citep", "citet");
  if (packages.has("biblatex")) commands.push("parencite", "textcite", "autocite");
  return commands;
}

/** Edits renaming one key's cite occurrences in a single file. */
function planFileRename(content: string, oldKey: string, newKey: string): SourceEdit[] {
  return extractCitePositions(content)
    .filter((pos) => pos.key === oldKey)
    .map((pos) => ({ from: pos.from, to: pos.to, insert: newKey }));
}

/**
 * Plan a project-wide citation key rename. Unmodified files are
 * absent from the map. (The .bib entry's own key is not touched.)
 */
export function planCiteKeyRename(
  files: ScannedFile[],
  oldKey: string,
  newKey: string,
): Map<string, SourceEdit[]> {
  const plan = new Map<string, SourceEdit[]>();
  for (const { file, content } of files) {
    const edits = planFileRename(content, oldKey, newKey);
    if (edits.length > 0) plan.set(file, edits);
  }
  return plan;
}
