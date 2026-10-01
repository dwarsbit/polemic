/**
 * Structured handling of `\includegraphics` options: find the command
 * around a cursor position, parse its `[key=value,…]` block into
 * entries, and serialize back. Pure functions; the editor applies them
 * to the live document for the options assistant card.
 */

export interface GraphicsSpan {
  /** Range of the whole command, [from, to). */
  from: number;
  to: number;
  /** Offset right after the command name — where an options block goes. */
  optionsAt: number;
  /** Range of the options block's inner text (between the brackets). */
  options: { from: number; to: number } | null;
  /** Range of the path argument's inner text (between the braces). */
  pathRange: { from: number; to: number };
  /** The path argument. */
  path: string;
}

const COMMAND_RE = /\\includegraphics(\[[^\]]*\])?\{([^}]*)\}/g;

/** The \includegraphics command containing `pos`, or null. */
export function findGraphicsSpanAt(
  doc: string,
  pos: number,
): GraphicsSpan | null {
  COMMAND_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMMAND_RE.exec(doc)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (pos < from || pos > to) continue;
    const nameEnd = from + "\\includegraphics".length;
    const options =
      match[1] === undefined
        ? null
        : { from: nameEnd + 1, to: nameEnd + 1 + match[1].length - 2 };
    const afterOptions =
      match[1] === undefined ? nameEnd : nameEnd + match[1].length;
    return {
      from,
      to,
      optionsAt: nameEnd,
      options,
      pathRange: {
        from: afterOptions + 1,
        to: afterOptions + 1 + match[2].length,
      },
      path: match[2],
    };
  }
  return null;
}

export interface OptionEntry {
  key: string;
  /** null for bare flags (clip, draft). */
  value: string | null;
}

/** Split the options text on commas, brace-aware. */
export function parseOptionEntries(inner: string): OptionEntry[] {
  const entries: OptionEntry[] = [];
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i <= inner.length; i++) {
    const ch = inner[i] ?? ",";
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      entries.push({ key: trimmed, value: null });
    } else {
      entries.push({
        key: trimmed.slice(0, eq).trim(),
        value: trimmed.slice(eq + 1).trim(),
      });
    }
  }
  return entries;
}

/** "width=0.8\\textwidth, clip" style text; empty when no options. */
export function serializeOptionEntries(entries: OptionEntry[]): string {
  return entries
    .map((entry) => (entry.value === null ? entry.key : `${entry.key}=${entry.value}`))
    .join(", ");
}

/** The value of a keyed option, or null (missing or a bare flag). */
export function getOptionValue(
  entries: OptionEntry[],
  key: string,
): string | null {
  const entry = entries.find((e) => e.key === key);
  return entry === undefined ? null : entry.value;
}

/** Whether a flag option is present (bare, or =true). */
export function getOptionFlag(entries: OptionEntry[], key: string): boolean {
  const entry = entries.find((e) => e.key === key);
  return entry !== undefined && (entry.value === null || entry.value === "true");
}

/** Set a keyed option; an empty value removes it. */
export function setOptionValue(
  entries: OptionEntry[],
  key: string,
  value: string,
): OptionEntry[] {
  return upsert(entries, key, value.trim().length === 0 ? null : value.trim());
}

/** Set a bare flag on or off. */
export function setOptionFlag(
  entries: OptionEntry[],
  key: string,
  on: boolean,
): OptionEntry[] {
  return upsert(entries, key, on ? null : undefined);
}

function upsert(
  entries: OptionEntry[],
  key: string,
  value: string | null | undefined,
): OptionEntry[] {
  const out = entries.filter((e) => e.key !== key);
  if (value === undefined) return out;
  return [...out, { key, value }];
}
