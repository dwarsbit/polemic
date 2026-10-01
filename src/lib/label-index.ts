/**
 * Cross-file index of \label{...} definitions and \ref-family uses,
 * plus the rename planner used by the label manager panel. Pure: all
 * functions take source text in and return data out.
 */

import { extractLabelPositions, extractRefPositions, type NamePos } from "./label-refs";

export interface ScannedFile {
  /** Project-relative path. */
  file: string;
  content: string;
}

export interface LabelEntry {
  name: string;
  file: string;
  /** 1-based line of the \label command. */
  line: number;
}

export interface RefEntry {
  name: string;
  file: string;
  /** 1-based line of the reference command. */
  line: number;
}

export interface LabelIndex {
  labels: LabelEntry[];
  refs: RefEntry[];
}

/** 1-based line containing the given offset. */
function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function toEntries(file: string, content: string, positions: NamePos[]) {
  return positions.map((pos) => ({
    name: pos.name,
    file,
    line: lineOf(content, pos.from),
  }));
}

/** Index every file's labels and references. */
export function buildLabelIndex(files: ScannedFile[]): LabelIndex {
  const labels: LabelEntry[] = [];
  const refs: RefEntry[] = [];
  for (const { file, content } of files) {
    labels.push(...toEntries(file, content, extractLabelPositions(content)));
    refs.push(...toEntries(file, content, extractRefPositions(content)));
  }
  return { labels, refs };
}

/**
 * Grouping key for a label: the part before the first ":" (the
 * conventional prefix, e.g. "fig" in "fig:overview"). Labels without
 * a prefix form their own group keyed by the full name.
 */
export function labelGroup(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(0, colon);
}

/** Loose validity check for a LaTeX key usable as a label name. */
export function isValidLabelName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_:.[\]-]*$/.test(name);
}

export interface SourceEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * The inner range of a label/ref name: inside the braces, excluding
 * the braces themselves.
 */
function innerRange(pos: NamePos): { from: number; to: number } {
  return { from: pos.to - 1 - pos.name.length, to: pos.to - 1 };
}

/**
 * Edits that rename a label and all its references in a single file.
 * Ranges are in the file's *current* text; callers apply them
 * back-to-front (see applyEdits).
 */
function planFileRename(content: string, oldName: string, newName: string): SourceEdit[] {
  const edits: SourceEdit[] = [];
  for (const pos of [...extractLabelPositions(content), ...extractRefPositions(content)]) {
    if (pos.name !== oldName) continue;
    const { from, to } = innerRange(pos);
    edits.push({ from, to, insert: newName });
  }
  return edits;
}

/**
 * Plan a project-wide rename: one entry per affected file.
 * Unmodified files are absent from the map.
 */
export function planLabelRename(
  files: ScannedFile[],
  oldName: string,
  newName: string,
): Map<string, SourceEdit[]> {
  const plan = new Map<string, SourceEdit[]>();
  for (const { file, content } of files) {
    const edits = planFileRename(content, oldName, newName);
    if (edits.length > 0) plan.set(file, edits);
  }
  return plan;
}

/**
 * Apply edits to a text (back-to-front so earlier offsets stay
 * valid). Edits must not overlap. Returns the new text.
 */
export function applyEdits(text: string, edits: SourceEdit[]): string {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }
  return result;
}
