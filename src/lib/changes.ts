/**
 * Track changes: suggestions stored in the .tex as `changes`-package
 * markup, `\added[id=LG]{new}`, `\deleted[id=LG]{old}` and
 * `\replaced[id=LG]{new}{old}` (options in any order, an optional
 * `comment={…}` note), authors declared in the preamble with
 * `\definechangesauthor[name={…}, color=…]{LG}`. `\highlight{…}` is
 * read too and counts as plain text. One model for both views: parse
 * suggestions with source ranges, accept or reject them as text edits
 * (one undo step), and the final text with a map back to the source.
 *
 * Braces are matched past escapes (`\{`, `\}`, `\%`) and `%` comments;
 * `%` comments, `\verb` and verbatim environments are never read for
 * markup. A command that does not parse (unclosed group, missing
 * argument, a group running across a blank line) is plain text.
 */

import {
  parseUsepackage,
  planUsepackageRemoval,
  type SourceEdit,
} from "@/lib/packages";

export type { SourceEdit };

export type ChangeKind = "added" | "deleted" | "replaced" | "highlight";

/** A source range, [from, to). */
export interface SourceRange {
  from: number;
  to: number;
}

export interface Change {
  kind: ChangeKind;
  /** The author id (`id=`), null when the option is missing. */
  author: string | null;
  /** The suggestion note (`comment=`) as plain text, null when absent. */
  note: string | null;
  /** The whole command, from the backslash to the last closing brace. */
  range: SourceRange;
  /** The `[…]` options, brackets included; null when absent. */
  options: SourceRange | null;
  /** The new text, inside its braces: `\added`, the first argument of
   *  `\replaced`, and the text of `\highlight`. */
  added: SourceRange | null;
  /** The old text, inside its braces: `\deleted` and the second
   *  argument of `\replaced`. */
  deleted: SourceRange | null;
  /** Suggestions nested in this one's arguments. */
  children: Change[];
}

export interface ChangeAuthor {
  id: string;
  name: string | null;
  color: string | null;
  /** The whole `\definechangesauthor` command. */
  range: SourceRange;
}

/** A suggestion: the parsed change itself, its range, or an offset inside it. */
export type ChangeRef = Change | SourceRange | number;

const ARITY: Record<ChangeKind, number> = {
  added: 1,
  deleted: 1,
  replaced: 2,
  highlight: 1,
};

const MARKUP_RE = /\\(?:added|deleted|replaced|highlight)(?![a-zA-Z])/;

const VERBATIM_ENVS = new Set([
  "verbatim",
  "verbatim*",
  "Verbatim",
  "lstlisting",
  "minted",
  "comment",
]);

const isLetter = (ch: string | undefined) =>
  ch !== undefined && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z"));

/** The end of the line at `i` (the `\n` itself), or `limit`. */
function lineEnd(src: string, i: number, limit: number): number {
  const nl = src.indexOf("\n", i);
  return nl === -1 || nl > limit ? limit : nl;
}

/** Is there a blank line starting at the `\n` at `i`? */
function blankLineAt(src: string, i: number, limit: number): boolean {
  let j = i + 1;
  while (j < limit && (src[j] === " " || src[j] === "\t" || src[j] === "\r")) j++;
  return src[j] === "\n";
}

/**
 * The end (after the closing delimiter) of the group opening at `open`
 * with `{` or `[`, or -1 when it is not closed before `limit` or a
 * blank line. Brackets close only outside braces.
 */
function groupEnd(src: string, open: number, limit: number): number {
  const bracket = src[open] === "[";
  let depth = 0;
  let i = bracket ? open + 1 : open;
  while (i < limit) {
    const ch = src[i];
    if (ch === "\\") i += 2;
    else if (ch === "%") i = lineEnd(src, i, limit);
    else if (ch === "\n") {
      if (blankLineAt(src, i, limit)) return -1;
      i++;
    } else if (ch === "{") {
      depth++;
      i++;
    } else if (ch === "}") {
      depth--;
      i++;
      if (depth < 0) return -1;
      if (depth === 0 && !bracket) return i;
    } else if (ch === "]" && bracket && depth === 0) return i + 1;
    else i++;
  }
  return -1;
}

/** Skips the spaces TeX skips between arguments (no blank line). */
function skipSpace(src: string, i: number, limit: number): number {
  let newline = false;
  while (i < limit) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\r") i++;
    else if (ch === "\n" && !newline) {
      newline = true;
      i++;
    } else break;
  }
  return i;
}

/**
 * Calls `visit` for every command in [from, to) outside comments and
 * verbatim text, with the command's start and the end of its name.
 * `visit` returns where to continue, or undefined to go on after the name.
 */
function forEachCommand(
  src: string,
  from: number,
  to: number,
  visit: (name: string, start: number, nameEnd: number) => number | undefined,
): void {
  let i = from;
  while (i < to) {
    const ch = src[i];
    if (ch === "%") {
      i = lineEnd(src, i, to);
      continue;
    }
    if (ch !== "\\") {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < to && isLetter(src[j])) j++;
    if (j === i + 1) {
      i += 2;
      continue;
    }
    const name = src.slice(i + 1, j);
    if (name === "verb") {
      let d = j;
      if (src[d] === "*") d++;
      const delim = src[d];
      const close = delim === undefined ? -1 : src.indexOf(delim, d + 1);
      i = close === -1 || close >= lineEnd(src, d, to) ? j : close + 1;
      continue;
    }
    if (name === "begin" && src[j] === "{") {
      const close = src.indexOf("}", j);
      const env = close === -1 ? "" : src.slice(j + 1, close);
      if (VERBATIM_ENVS.has(env)) {
        const end = src.indexOf(`\\end{${env}}`, close);
        i = end === -1 || end >= to ? to : end + env.length + 6;
        continue;
      }
    }
    i = visit(name, i, j) ?? j;
  }
}

interface OptionEntry {
  key: string;
  /** The entry, trimmed: `key=value`. */
  range: SourceRange;
  /** The value as written (braces included), trimmed. */
  value: SourceRange | null;
}

/** The `key=value` entries of the options text in [from, to). */
function parseOptions(src: string, from: number, to: number): OptionEntry[] {
  const entries: OptionEntry[] = [];
  const pieces: SourceRange[] = [];
  let start = from;
  let depth = 0;
  for (let i = from; i < to; i++) {
    const ch = src[i];
    if (ch === "\\") i++;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      pieces.push({ from: start, to: i });
      start = i + 1;
    }
  }
  pieces.push({ from: start, to });
  for (const piece of pieces) {
    const range = trim(src, piece);
    if (range.from === range.to) continue;
    let eq = -1;
    depth = 0;
    for (let i = range.from; i < range.to && eq === -1; i++) {
      const ch = src[i];
      if (ch === "\\") i++;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === "=" && depth === 0) eq = i;
    }
    const keyEnd = eq === -1 ? range.to : eq;
    entries.push({
      key: src.slice(range.from, keyEnd).trim(),
      range,
      value: eq === -1 ? null : trim(src, { from: eq + 1, to: range.to }),
    });
  }
  return entries;
}

function trim(src: string, r: SourceRange): SourceRange {
  let { from, to } = r;
  while (from < to && /\s/.test(src[from])) from++;
  while (to > from && /\s/.test(src[to - 1])) to--;
  return { from, to };
}

/** An option value's text: outer braces dropped, escapes undone. */
function optionText(src: string, value: SourceRange): string {
  let text = src.slice(value.from, value.to);
  if (text.startsWith("{") && groupEnd(text, 0, text.length) === text.length) {
    text = text.slice(1, -1);
  }
  return unescapeText(text);
}

const ESCAPED_RE = /\\textbackslash\{\}|\\([{}%&#_$])/g;

function unescapeText(text: string): string {
  return text.replace(ESCAPED_RE, (_match, ch: string | undefined) => ch ?? "\\");
}

/** Plain text as LaTeX for an option value: specials escaped, one line. */
function escapeText(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/[\\{}%&#_$]/g, (ch) => (ch === "\\" ? "\\textbackslash{}" : `\\${ch}`));
}

/** The suggestion command starting at `start`, or null when malformed. */
function readChange(
  src: string,
  kind: ChangeKind,
  start: number,
  nameEnd: number,
  limit: number,
): Change | null {
  let i = skipSpace(src, nameEnd, limit);
  let options: SourceRange | null = null;
  if (src[i] === "[") {
    const end = groupEnd(src, i, limit);
    if (end === -1) return null;
    options = { from: i, to: end };
    i = end;
  }
  const args: SourceRange[] = [];
  for (let n = 0; n < ARITY[kind]; n++) {
    i = n === 0 && options === null ? i : skipSpace(src, i, limit);
    if (src[i] !== "{") return null;
    const end = groupEnd(src, i, limit);
    if (end === -1) return null;
    args.push({ from: i + 1, to: end - 1 });
    i = end;
  }
  let author: string | null = null;
  let note: string | null = null;
  if (options !== null) {
    for (const entry of parseOptions(src, options.from + 1, options.to - 1)) {
      if (entry.value === null) continue;
      if (entry.key === "id") author = optionText(src, entry.value).trim() || null;
      else if (entry.key === "comment") note = optionText(src, entry.value);
    }
  }
  const children: Change[] = [];
  for (const arg of args) scan(src, arg.from, arg.to, children);
  return {
    kind,
    author,
    note,
    range: { from: start, to: i },
    options,
    added: kind === "deleted" ? null : args[0],
    deleted: kind === "deleted" ? args[0] : kind === "replaced" ? args[1] : null,
    children,
  };
}

/** The suggestions in [from, to), outermost only, into `out`. */
function scan(src: string, from: number, to: number, out: Change[]): void {
  forEachCommand(src, from, to, (name, start, nameEnd) => {
    if (!(name in ARITY)) return undefined;
    const change = readChange(src, name as ChangeKind, start, nameEnd, to);
    if (change === null) return undefined;
    out.push(change);
    return change.range.to;
  });
}

/** The outermost suggestions; nested ones sit in their `children`. */
function parseTree(source: string): Change[] {
  const roots: Change[] = [];
  if (MARKUP_RE.test(source)) scan(source, 0, source.length, roots);
  return roots;
}

function flatten(nodes: Change[], out: Change[]): Change[] {
  for (const node of nodes) {
    out.push(node);
    flatten(node.children, out);
  }
  return out;
}

/**
 * The suggestion command starting at `pos` (its backslash), read up to
 * `limit`, or null when there is none or it is malformed.
 */
export function readChangeAt(
  source: string,
  pos: number,
  limit = source.length,
): Change | null {
  if (source[pos] !== "\\") return null;
  let end = pos + 1;
  while (end < limit && isLetter(source[end])) end++;
  const name = source.slice(pos + 1, end);
  if (!(name in ARITY)) return null;
  return readChange(source, name as ChangeKind, pos, end, limit);
}

/** The note (`comment=`) in a change's `[…]` options text, or null. */
export function noteOfOptions(options: string | null): string | null {
  if (options === null) return null;
  return readChangeAt(`\\added${options}{}`, 0)?.note ?? null;
}

/** Every suggestion (and highlight) in document order, nested ones included. */
export function parseChanges(source: string): Change[] {
  return flatten(parseTree(source), []);
}

/**
 * The source ranges that are not in the final text: every suggestion's
 * hidden markup (command, options, braces) and, unless
 * `includeDeleted`, its deleted text. Sorted, non-overlapping.
 */
export function suggestionSkipRanges(
  source: string,
  includeDeleted = false,
): SourceRange[] {
  const out: SourceRange[] = [];
  for (const change of parseChanges(source)) {
    const { range, added, deleted } = change;
    const parts = [added, deleted].filter((r): r is SourceRange => r !== null);
    parts.sort((a, b) => a.from - b.from);
    let cursor = range.from;
    for (const part of parts) {
      out.push({ from: cursor, to: part.from });
      if (part === deleted && !includeDeleted) out.push({ ...part });
      cursor = part.to;
    }
    out.push({ from: cursor, to: range.to });
  }
  return out
    .filter((r) => r.from < r.to)
    .sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The `\definechangesauthor` declarations, in order. */
export function parseAuthors(source: string): ChangeAuthor[] {
  const authors: ChangeAuthor[] = [];
  if (!source.includes("\\definechangesauthor")) return authors;
  forEachCommand(source, 0, source.length, (name, start, nameEnd) => {
    if (name !== "definechangesauthor") return undefined;
    let i = skipSpace(source, nameEnd, source.length);
    let entries: OptionEntry[] = [];
    if (source[i] === "[") {
      const end = groupEnd(source, i, source.length);
      if (end === -1) return undefined;
      entries = parseOptions(source, i + 1, end - 1);
      i = skipSpace(source, end, source.length);
    }
    if (source[i] !== "{") return undefined;
    const end = groupEnd(source, i, source.length);
    if (end === -1) return undefined;
    const value = (key: string) => {
      const entry = entries.find((e) => e.key === key && e.value !== null);
      return entry ? optionText(source, entry.value!).trim() || null : null;
    };
    authors.push({
      id: source.slice(i + 1, end - 1).trim(),
      name: value("name"),
      color: value("color"),
      range: { from: start, to: end },
    });
    return end;
  });
  return authors;
}

/**
 * What resolving a suggestion keeps: a source range of its text (null
 * for nothing), or "markup" to leave the command as it is (its nested
 * suggestions are still resolved).
 */
type Decision = SourceRange | null | "markup";
type Decide = (change: Change) => Decision;

/** One resolved suggestion: the source it replaces and the output runs. */
interface Cut {
  from: number;
  to: number;
  runs: SourceRange[];
}

const SPACE = " \t";
const AFTER_SPACE = " \t\r\n.,;:!?)";

/** The resolved suggestions among `nodes`, within [lo, hi). */
function resolve(
  src: string,
  nodes: Change[],
  lo: number,
  hi: number,
  decide: Decide,
): Cut[] {
  const cuts: Cut[] = [];
  let cursor = lo;
  for (const node of nodes) {
    const decision = decide(node);
    if (decision === "markup") {
      for (const arg of [node.added, node.deleted]) {
        if (arg === null) continue;
        const inside = node.children.filter(
          (c) => c.range.from >= arg.from && c.range.to <= arg.to,
        );
        cuts.push(...resolve(src, inside, arg.from, arg.to, decide));
      }
      cursor = node.range.to;
      continue;
    }
    let { from, to } = node.range;
    if (decision === null || decision.from === decision.to) {
      // Removing the whole command leaves no doubled or stray space.
      const before = from > cursor ? src[from - 1] : undefined;
      const after = to < hi ? src[to] : to === src.length ? "" : undefined;
      if (
        before !== undefined &&
        SPACE.includes(before) &&
        after !== undefined &&
        AFTER_SPACE.includes(after)
      ) {
        from--;
      } else if (
        (from === 0 || src[from - 1] === "\n") &&
        from >= cursor &&
        after !== undefined &&
        after !== "" &&
        SPACE.includes(after)
      ) {
        to++;
      }
    }
    const runs =
      decision === null
        ? []
        : render(
            src,
            node.children.filter(
              (c) => c.range.from >= decision.from && c.range.to <= decision.to,
            ),
            decision.from,
            decision.to,
            decide,
          );
    cuts.push({ from, to, runs });
    cursor = to;
  }
  return cuts;
}

/** The output of [lo, hi) as source runs, with `nodes` resolved. */
function render(
  src: string,
  nodes: Change[],
  lo: number,
  hi: number,
  decide: Decide,
): SourceRange[] {
  const runs: SourceRange[] = [];
  const push = (from: number, to: number) => {
    if (from >= to) return;
    const last = runs[runs.length - 1];
    if (last && last.to === from) last.to = to;
    else runs.push({ from, to });
  };
  let cursor = lo;
  for (const cut of resolve(src, nodes, lo, hi, decide)) {
    push(cursor, cut.from);
    for (const run of cut.runs) push(run.from, run.to);
    cursor = cut.to;
  }
  push(cursor, hi);
  return runs;
}

const runsText = (src: string, runs: SourceRange[]) =>
  runs.map((r) => src.slice(r.from, r.to)).join("");

function editsFor(source: string, roots: Change[], decide: Decide): SourceEdit[] {
  return resolve(source, roots, 0, source.length, decide).map((cut) => ({
    from: cut.from,
    to: cut.to,
    insert: runsText(source, cut.runs),
  }));
}

const accepted = (c: Change): Decision => (c.kind === "deleted" ? null : c.added);
const rejected = (c: Change): Decision =>
  c.kind === "highlight" ? c.added : c.kind === "added" ? null : c.deleted;

/** The suggestion `ref` points at: the innermost one containing it. */
function findChange(roots: Change[], ref: ChangeRef): Change | null {
  const target =
    typeof ref === "number" ? { from: ref, to: ref } : "range" in ref ? ref.range : ref;
  let best: Change | null = null;
  const visit = (nodes: Change[]) => {
    for (const node of nodes) {
      const { from, to } = node.range;
      if (from === target.from && to === target.to) {
        best = node;
        return;
      }
      const inside =
        target.from === target.to
          ? from <= target.from && target.from < to
          : from <= target.from && target.to <= to;
      if (inside) {
        best = node;
        visit(node.children);
        return;
      }
    }
  };
  visit(roots);
  return best;
}

function resolveOne(
  source: string,
  ref: ChangeRef,
  keep: (c: Change) => Decision,
): SourceEdit[] {
  const roots = parseTree(source);
  const target = findChange(roots, ref);
  if (target === null) return [];
  return editsFor(source, roots, (c) => (c === target ? keep(c) : "markup"));
}

/** Accepts one suggestion: its new text stays, the markup goes. */
export function acceptChange(source: string, ref: ChangeRef): SourceEdit[] {
  return resolveOne(source, ref, (c) =>
    c.kind === "highlight" ? c.added : accepted(c),
  );
}

/** Rejects one suggestion: its old text stays, the markup goes. */
export function rejectChange(source: string, ref: ChangeRef): SourceEdit[] {
  return resolveOne(source, ref, rejected);
}

export interface ChangeFilter {
  /** Only this author's suggestions; null for those without an id. */
  author?: string | null;
}

function resolveAll(
  source: string,
  filter: ChangeFilter,
  keep: (c: Change) => Decision,
): SourceEdit[] {
  const roots = parseTree(source);
  return editsFor(source, roots, (c) =>
    c.kind === "highlight" ||
    (filter.author !== undefined && c.author !== filter.author)
      ? "markup"
      : keep(c),
  );
}

/** Accepts every suggestion (highlights stay), optionally one author's. */
export function acceptAll(source: string, filter: ChangeFilter = {}): SourceEdit[] {
  return resolveAll(source, filter, accepted);
}

/** Rejects every suggestion (highlights stay), optionally one author's. */
export function rejectAll(source: string, filter: ChangeFilter = {}): SourceEdit[] {
  return resolveAll(source, filter, rejected);
}

/** Applies non-overlapping edits to a string. */
export function applyEdits(source: string, edits: SourceEdit[]): string {
  let out = "";
  let cursor = 0;
  for (const edit of [...edits].sort((a, b) => a.from - b.from)) {
    out += source.slice(cursor, edit.from) + edit.insert;
    cursor = edit.to;
  }
  return out + source.slice(cursor);
}

/** Offsets between a resolved text and its source. */
export interface PositionMap {
  /** The source offset of an offset in the resolved text. */
  toSource(offset: number): number;
  /** The resolved-text offset of a source offset; offsets in removed
   *  text map to where it was cut. */
  toText(sourceOffset: number): number;
}

export interface ResolvedText {
  text: string;
  map: PositionMap;
}

function positionMap(runs: SourceRange[]): PositionMap {
  const starts: number[] = [];
  let length = 0;
  for (const run of runs) {
    starts.push(length);
    length += run.to - run.from;
  }
  // The last index whose key is <= value, or -1.
  const last = (keys: (i: number) => number, value: number) => {
    let lo = 0;
    let hi = runs.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (keys(mid) <= value) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };
  return {
    toSource(offset) {
      const i = last((k) => starts[k], offset);
      if (i === -1) return runs.length ? runs[0].from : 0;
      return Math.min(runs[i].from + (offset - starts[i]), runs[i].to);
    },
    toText(sourceOffset) {
      const i = last((k) => runs[k].from, sourceOffset);
      if (i === -1) return 0;
      return (
        starts[i] + Math.min(sourceOffset - runs[i].from, runs[i].to - runs[i].from)
      );
    },
  };
}

function resolvedText(source: string, decide: Decide): ResolvedText {
  const roots = parseTree(source);
  const runs =
    roots.length === 0
      ? [{ from: 0, to: source.length }]
      : render(source, roots, 0, source.length, decide);
  return {
    text: roots.length === 0 ? source : runsText(source, runs),
    map: positionMap(runs),
  };
}

/** The text with every suggestion accepted (highlights unwrapped). */
export function finalText(source: string): ResolvedText {
  return resolvedText(source, (c) => (c.kind === "highlight" ? c.added : accepted(c)));
}

/** The text with every suggestion rejected (highlights unwrapped). */
export function originalText(source: string): ResolvedText {
  return resolvedText(source, rejected);
}

export interface SuggestionAuthor {
  name: string;
  /** The initials from Settings, the preferred id. */
  initials: string;
  /** An xcolor name; a free one is picked when absent. */
  color?: string;
}

const AUTHOR_COLORS = [
  "orange",
  "blue",
  "red",
  "teal",
  "violet",
  "olive",
  "magenta",
  "cyan",
  "brown",
  "purple",
];

/**
 * The edits that set a document up for suggestions by `author`: adds
 * `\usepackage{changes}` and the author's `\definechangesauthor` when
 * missing. The id is the author's existing one (same name) or their
 * initials, with a digit when another author has them (LG, LG2). No
 * edits when the source has no `\begin{document}` (not a main file).
 */
export function ensurePreamble(
  source: string,
  author: SuggestionAuthor,
): { id: string; edits: SourceEdit[] } {
  let begin = -1;
  forEachCommand(source, 0, source.length, (name, start, nameEnd) => {
    if (begin === -1 && name === "begin" && source.startsWith("{document}", nameEnd))
      begin = start;
    return begin === -1 ? undefined : source.length;
  });
  const preamble = begin === -1 ? source : source.slice(0, begin);
  const authors = parseAuthors(preamble);
  const existing = authors.find((a) => a.name === author.name.trim());
  const base = author.initials.replace(/[^A-Za-z0-9]/g, "") || "A";
  let id = existing?.id ?? base;
  if (!existing) {
    const taken = new Set(authors.map((a) => a.id));
    for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
  }
  if (begin === -1) return { id, edits: [] };

  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const endOfLine = (pos: number) => {
    const nl = source.indexOf("\n", pos);
    return nl === -1 ? source.length : source[nl - 1] === "\r" ? nl - 1 : nl;
  };
  const packages = parseUsepackage(preamble).filter((p) => !inComment(source, p.from));
  const changesPkg = packages.find((p) => p.names.includes("changes"));
  const lines: string[] = [];
  if (!changesPkg) lines.push("\\usepackage{changes}");
  if (!existing) {
    const used = new Set(authors.map((a) => a.color));
    const color =
      author.color ?? AUTHOR_COLORS.find((c) => !used.has(c)) ?? AUTHOR_COLORS[0];
    lines.push(
      `\\definechangesauthor[name={${escapeText(author.name.trim())}}, color=${color}]{${id}}`,
    );
  }
  if (lines.length === 0) return { id, edits: [] };

  // After the last author when the package is loaded, else after the
  // last package (the package must come before any author).
  const anchor = !changesPkg
    ? packages[packages.length - 1]?.to
    : authors.length
      ? authors[authors.length - 1].range.to
      : changesPkg.to;
  if (anchor === undefined) {
    const lineStart = source.lastIndexOf("\n", begin - 1) + 1;
    return {
      id,
      edits: [
        { from: lineStart, to: lineStart, insert: lines.map((l) => l + eol).join("") },
      ],
    };
  }
  const at = endOfLine(anchor);
  return {
    id,
    edits: [{ from: at, to: at, insert: lines.map((l) => eol + l).join("") }],
  };
}

function inComment(src: string, pos: number): boolean {
  const lineStart = src.lastIndexOf("\n", pos - 1) + 1;
  for (let i = lineStart; i < pos; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === "%") return true;
  }
  return false;
}

/**
 * The edits that set a suggestion's note (`comment=` option) to `text`,
 * or remove it for null or blank text. Options are added or dropped as
 * needed; the other options stay as written.
 */
export function setNote(
  source: string,
  ref: ChangeRef,
  text: string | null,
): SourceEdit[] {
  const change = findChange(parseTree(source), ref);
  if (change === null) return [];
  const value =
    text === null || text.trim() === "" ? null : `{${escapeText(text.trim())}}`;
  if (change.options === null) {
    if (value === null) return [];
    const at = change.range.from + 1 + change.kind.length;
    return [{ from: at, to: at, insert: `[comment=${value}]` }];
  }
  const { from, to } = change.options;
  const entries = parseOptions(source, from + 1, to - 1);
  const index = entries.findIndex((e) => e.key === "comment");
  const entry = entries[index];
  if (value !== null) {
    if (entry?.value)
      return [{ from: entry.value.from, to: entry.value.to, insert: value }];
    if (entry)
      return [
        { from: entry.range.from, to: entry.range.to, insert: `comment=${value}` },
      ];
    if (entries.length === 0) return [{ from, to, insert: `[comment=${value}]` }];
    const at = entries[entries.length - 1].range.to;
    return [{ from: at, to: at, insert: `, comment=${value}` }];
  }
  if (!entry) return [];
  if (entries.length === 1) return [{ from, to, insert: "" }];
  return index > 0
    ? [{ from: entries[index - 1].range.to, to: entry.range.to, insert: "" }]
    : [{ from: entry.range.from, to: entries[1].range.from, insert: "" }];
}

/**
 * The edits that remove the track changes setup: `\usepackage{changes}`
 * (or `changes` from a package list) and every `\definechangesauthor`.
 * A line left empty by a removal goes with it.
 */
export function removeSetup(source: string): SourceEdit[] {
  const edits: SourceEdit[] = [];
  const pkg = parseUsepackage(source).find(
    (p) => p.names.includes("changes") && !inComment(source, p.from),
  );
  const ranges: SourceRange[] = parseAuthors(source).map((a) => a.range);
  if (pkg) {
    const plan = planUsepackageRemoval(source, "changes");
    if (plan) {
      if (plan.insert !== "") edits.push(plan);
      else ranges.push({ from: plan.from, to: plan.to });
    }
  }
  for (const range of ranges) {
    let { from, to } = range;
    const lineStart = source.lastIndexOf("\n", from - 1) + 1;
    const nl = source.indexOf("\n", to);
    const lineEnd = nl === -1 ? source.length : nl;
    if (
      source.slice(lineStart, from).trim() === "" &&
      source.slice(to, lineEnd).trim() === ""
    ) {
      from = lineStart;
      to = nl === -1 ? lineEnd : nl + 1;
    }
    edits.push({ from, to, insert: "" });
  }
  edits.sort((a, b) => a.from - b.from);
  // A whole-line package removal may already cover an author line.
  return edits.filter((e, i) => i === 0 || e.from >= edits[i - 1].to);
}

/** The `\usepackage{changes}` command (outside comments), if any. */
function changesPackage(source: string) {
  const begin = source.indexOf("\\begin{document}");
  const preamble = begin === -1 ? source : source.slice(0, begin);
  return (
    parseUsepackage(preamble).find(
      (p) => p.names.includes("changes") && !inComment(source, p.from),
    ) ?? null
  );
}

const optionList = (options: string | null) =>
  (options ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");

/**
 * Whether the PDF shows the suggestions (the package's markup) rather
 * than the final text (`final` option); null when the document does
 * not load `changes`.
 */
export function suggestionsShownInPdf(source: string): boolean | null {
  const pkg = changesPackage(source);
  return pkg === null ? null : !optionList(pkg.options).includes("final");
}

/** The edits that show or hide the suggestions in the PDF by adding or
 *  removing the `final` option of `changes`. */
export function showSuggestionsInPdf(source: string, show: boolean): SourceEdit[] {
  const pkg = changesPackage(source);
  if (pkg === null) return [];
  const options = optionList(pkg.options).filter((o) => o !== "final");
  if (!show) options.push("final");
  const others = pkg.names.filter((n) => n !== "changes");
  const command = (names: string[], opts: string[]) =>
    `\\usepackage${opts.length > 0 ? `[${opts.join(", ")}]` : ""}{${names.join(", ")}}`;
  const insert =
    others.length === 0
      ? command(["changes"], options)
      : // The option must not apply to the other packages: split them off.
        `${command(others, optionList(pkg.options))}\n${command(["changes"], options)}`;
  if (insert === source.slice(pkg.from, pkg.to)) return [];
  return [{ from: pkg.from, to: pkg.to, insert }];
}

/** `[…]` options with the note set to `note` (null or blank removes it):
 *  setNote on the options alone, for views that keep them as a string. */
export function optionsWithNote(
  options: string | null,
  note: string | null,
): string | null {
  const command = `\\added${options ?? ""}{}`;
  const next = applyEdits(command, setNote(command, 0, note));
  const opts = next.slice("\\added".length, next.length - 2);
  return opts === "" ? null : opts;
}
