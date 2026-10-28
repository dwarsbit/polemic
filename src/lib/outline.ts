import { finalText } from "@/lib/changes";

export interface OutlineEntry {
  /** -2 part, -1 chapter, 0 section, 1 subsection, 2 subsubsection. */
  level: number;
  title: string;
  line: number;
  /** The sectioning command without backslash or star, e.g. "subsection". */
  command: string;
}

/** Sectioning commands by level (index + LEVEL_OFFSET). */
export const SECTION_COMMANDS = [
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
] as const;
const LEVEL_OFFSET = -2;

export const MIN_LEVEL = LEVEL_OFFSET;
export const MAX_LEVEL = SECTION_COMMANDS.length - 1 + LEVEL_OFFSET;

export function commandForLevel(level: number): string {
  return SECTION_COMMANDS[level - LEVEL_OFFSET];
}

const SECTION_RE =
  /^\\(part|chapter|(?:sub){0,2}section)\*?\s*(?:\[[^\]]*\]\s*)?\{(.*)\}/;

export function parseOutline(source: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const lines = source.split("\n");
  lines.forEach((text, index) => {
    const match = SECTION_RE.exec(text.trim());
    if (match) {
      const command = match[1];
      const level = SECTION_COMMANDS.indexOf(command as never) + LEVEL_OFFSET;
      // The title as it reads with every suggestion accepted.
      const title = match[2].includes("\\") ? finalText(match[2]).text : match[2];
      entries.push({ level, title, line: index + 1, command });
    }
  });
  return entries;
}

export function extractLabels(source: string): string[] {
  const labels: string[] = [];
  const re = /\\label\{([^}]+)\}/g;
  let match = re.exec(source);
  while (match !== null) {
    labels.push(match[1]);
    match = re.exec(source);
  }
  return labels;
}
