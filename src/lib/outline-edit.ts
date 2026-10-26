import type { SourceEdit } from "@/lib/label-index";
import {
  commandForLevel,
  MAX_LEVEL,
  parseOutline,
  type OutlineEntry,
} from "@/lib/outline";

/**
 * Structure edits for the outline: move a section (with everything
 * under it) up, down, or before/after another section in the same
 * file, and promote or demote it with its subsections. Each plans a
 * minimal set of edits for one undo step.
 */

/** Lines that end the last section's block: the document tail stays put. */
const TAIL_RE =
  /^\s*\\(?:end\{document\}|appendix\b|bibliography\{|printbibliography\b|begin\{thebibliography\})/;

const INCLUDE_LINE_RE = /^\s*\\(?:input|include|subfile)\s*\{([^}]*)\}/;

export interface StructureOptions {
  /** Whether an \input/\include spec brings in sections of its own:
   *  such a line ends the block before it instead of moving with it. */
  isStructuralInclude?: (spec: string) => boolean;
}

/** A section block: the heading line through its last content line,
 *  as 0-based line indices [start, end). */
export interface Block {
  start: number;
  end: number;
}

function lineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

/** The block of entry `index`: up to the next heading at the same or a
 *  higher level, or the document tail, or the end of the file. */
export function blockOf(
  source: string,
  entries: OutlineEntry[],
  index: number,
  options: StructureOptions = {},
): Block {
  const lines = source.split("\n");
  const entry = entries[index];
  let end = lines.length;
  for (const next of entries.slice(index + 1)) {
    if (next.level <= entry.level) {
      end = next.line - 1;
      break;
    }
  }
  for (let i = entry.line; i < end; i++) {
    const include = INCLUDE_LINE_RE.exec(lines[i]);
    if (
      TAIL_RE.test(lines[i]) ||
      (include !== null && options.isStructuralInclude?.(include[1].trim()) === true)
    ) {
      end = i;
      break;
    }
  }
  return { start: entry.line - 1, end };
}

/** Move lines [block.start, block.end) to before line `to`. */
function moveLines(source: string, block: Block, to: number): SourceEdit[] {
  if (to >= block.start && to <= block.end) return [];
  const offsets = lineOffsets(source);
  const at = (line: number) => (line < offsets.length ? offsets[line] : source.length);
  const from = Math.min(block.start, to);
  const until = Math.max(block.end, to);
  let moved = source.slice(at(block.start), at(block.end));
  let rest =
    to < block.start
      ? source.slice(at(to), at(block.start))
      : source.slice(at(block.end), at(to));
  // A segment taken from the end of the file has no trailing newline.
  if (!moved.endsWith("\n") && rest.endsWith("\n")) {
    moved += "\n";
    rest = rest.slice(0, -1);
  } else if (!rest.endsWith("\n") && moved.endsWith("\n") && until >= offsets.length) {
    rest += "\n";
    moved = moved.slice(0, -1);
  }
  const insert = to < block.start ? moved + rest : rest + moved;
  return [{ from: at(from), to: at(until), insert }];
}

/** The nearest sibling (same level, same parent) before or after. */
function siblingIndex(
  entries: OutlineEntry[],
  index: number,
  dir: -1 | 1,
): number | null {
  const level = entries[index].level;
  for (let i = index + dir; i >= 0 && i < entries.length; i += dir) {
    if (entries[i].level < level) return null;
    if (entries[i].level === level) return i;
  }
  return null;
}

/** Swap the section with its previous (-1) or next (+1) sibling. */
export function planMove(
  source: string,
  index: number,
  dir: -1 | 1,
  options: StructureOptions = {},
): SourceEdit[] {
  const entries = parseOutline(source);
  const sibling = siblingIndex(entries, index, dir);
  if (sibling === null) return [];
  const block = blockOf(source, entries, index, options);
  const other = blockOf(source, entries, sibling, options);
  // Something between the two blocks (e.g. an \appendix): don't jump it.
  if (dir === -1 ? other.end !== block.start : block.end !== other.start) return [];
  return moveLines(source, block, dir === -1 ? other.start : other.end);
}

/** Move the section to just before (or after the block of) `target`. */
export function planMoveTo(
  source: string,
  index: number,
  target: number,
  position: "before" | "after",
  options: StructureOptions = {},
): SourceEdit[] {
  const entries = parseOutline(source);
  if (index === target) return [];
  const block = blockOf(source, entries, index, options);
  const targetBlock = blockOf(source, entries, target, options);
  // Dropping into its own subtree is meaningless.
  if (targetBlock.start >= block.start && targetBlock.start < block.end) return [];
  return moveLines(
    source,
    block,
    position === "before" ? targetBlock.start : targetBlock.end,
  );
}

/** Whether moving up/down is possible. */
export function canMove(source: string, index: number, dir: -1 | 1): boolean {
  return planMove(source, index, dir).length > 0;
}

/**
 * Promote (-1) or demote (+1) the section and its subsections. Never
 * above `minLevel` (the shallowest level the document already uses,
 * so an article does not grow a \chapter) nor below \subsubsection.
 */
export function planLevelChange(
  source: string,
  index: number,
  delta: -1 | 1,
  minLevel: number,
): SourceEdit[] {
  const entries = parseOutline(source);
  const entry = entries[index];
  const block = blockOf(source, entries, index);
  const subtree = entries.filter(
    (e, i) =>
      i === index ||
      (e.line - 1 > block.start && e.line - 1 < block.end && e.level > entry.level),
  );
  if (subtree.some((e) => e.level + delta < minLevel || e.level + delta > MAX_LEVEL)) {
    return [];
  }
  const offsets = lineOffsets(source);
  return subtree.map((e) => {
    const lineStart = offsets[e.line - 1];
    const col = source.indexOf(`\\${e.command}`, lineStart) + 1;
    return {
      from: col,
      to: col + e.command.length,
      insert: commandForLevel(e.level + delta),
    };
  });
}

/** A section moved into another file: edits for both files. */
export interface CrossFileMove {
  /** Edits removing the section (with its subsections) from its file. */
  sourceEdits: SourceEdit[];
  /** Edits inserting it into the target file. */
  targetEdits: SourceEdit[];
  /** The moved text, heading through the end of its block. */
  text: string;
}

/** Where a section lands in another file: before or after a target
 *  section's block, or at the end (before the document tail). */
export type CrossFilePlace =
  { index: number; position: "before" | "after" } | { position: "end" };

/**
 * Move the section at `index` of `source` into `target`. The section
 * keeps its level; promote or demote it afterwards to fit.
 */
export function planMoveToFile(
  source: string,
  index: number,
  target: string,
  place: CrossFilePlace,
  options: StructureOptions = {},
): CrossFileMove | null {
  const entries = parseOutline(source);
  if (entries[index] === undefined) return null;
  const block = blockOf(source, entries, index, options);
  const offsets = lineOffsets(source);
  const at = (line: number) => (line < offsets.length ? offsets[line] : source.length);
  let from = at(block.start);
  const to = at(block.end);
  let text = source.slice(from, to);
  if (!text.endsWith("\n")) {
    // The file's last line: take the newline before it instead.
    text += "\n";
    if (from > 0) from--;
  }

  let line: number;
  if (place.position === "end") {
    const lines = target.split("\n");
    const tail = lines.findIndex((l) => TAIL_RE.test(l));
    line = tail === -1 ? lines.length : tail;
  } else {
    const targetEntries = parseOutline(target);
    if (targetEntries[place.index] === undefined) return null;
    const targetBlock = blockOf(target, targetEntries, place.index, options);
    line = place.position === "before" ? targetBlock.start : targetBlock.end;
  }
  const targetOffsets = lineOffsets(target);
  let insert = text;
  let insertAt = target.length;
  if (line < targetOffsets.length) {
    insertAt = targetOffsets[line];
  } else if (target.length > 0 && !target.endsWith("\n")) {
    // Past a last line without a newline: start a line of its own.
    insert = "\n" + insert;
  }
  return {
    sourceEdits: [{ from, to, insert: "" }],
    targetEdits: [{ from: insertAt, to: insertAt, insert }],
    text,
  };
}
