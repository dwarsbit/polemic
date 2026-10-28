/**
 * Suggest mode: an edit becomes `changes` markup instead of changing
 * the text. Typing wraps the new text in `\added` (extending an
 * adjacent `\added` of the same author), deleting wraps the old text in
 * `\deleted` (merging with an adjacent one of the same author), typing
 * over a selection makes one `\replaced`, and edits inside your own
 * `\added` change it directly. Paragraph breaks, `\begin`/`\end` and
 * `\item` split a suggestion; an edit inside math, a command name or an
 * environment name is refused with a short message.
 *
 * Pure: the editor feeds it the source and the edit, and applies the
 * resulting text and caret. The model is lib/changes.ts.
 */

import { parseChanges, type Change, type SourceRange } from "@/lib/changes";
import { findMathRegion } from "@/lib/math-region";

export interface SuggestOk {
  ok: true;
  /** The whole new source. */
  source: string;
  /** Where the caret goes. */
  cursor: number;
  /** Where the typed text starts in the new source, when it stayed in
   *  one piece (for a caret placed inside it, like auto-closed braces). */
  textStart: number | null;
  /** Own suggested text still being typed (an open brace, a trailing
   *  backslash): the parser can't read it yet, so it stays editable. */
  pending: SourceRange | null;
  /** True when new markup was written (the preamble may need setup). */
  marked: boolean;
}

export interface SuggestRefused {
  ok: false;
  message: string;
}

export type SuggestResult = SuggestOk | SuggestRefused;

const refuse = (message: string): SuggestRefused => ({ ok: false, message });

/** A paragraph break, an environment boundary or an item: suggestions
 *  stop at these and go on after them. */
const SEPARATOR =
  /(\n[ \t]*\n\s*|\\(?:begin|end)\s*\{[^{}]*\}|\\item(?![A-Za-z])|\\par(?![A-Za-z]))/;

type Syntax = "ok" | "open" | "comment" | "brace";

/** Whether `text` can sit inside a group: balanced braces, no comment. */
function syntaxOf(text: string): Syntax {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      if (i === text.length - 1) return "open";
      i++;
    } else if (ch === "%") return "comment";
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) return "brace";
  }
  return depth > 0 ? "open" : "ok";
}

const SYNTAX_MESSAGE: Record<"comment" | "brace", string> = {
  comment: "Comments can't be suggested. Type \\% for a percent sign.",
  brace: "That would unbalance the braces of a suggestion.",
};

const opts = (author: string) => `[id=${author}]`;

/** The `[…]` options of a change as written, or the author's. */
const optionsOf = (source: string, change: Change, author: string) =>
  change.options ? source.slice(change.options.from, change.options.to) : opts(author);

/** The text pieces between the separators (separators at odd indices). */
const piecesOf = (text: string) =>
  text.split(SEPARATOR).filter((part, i) => i % 2 === 0 && part !== "");

/** Wraps `text` as `\cmd[options]{…}` pieces around the separators;
 *  `lastEnd` is the offset just inside the last piece's closing brace. */
function wrap(
  text: string,
  command: "added" | "deleted",
  options: string,
): { text: string; pieces: number; lastEnd: number | null } {
  let out = "";
  let pieces = 0;
  let lastEnd: number | null = null;
  text.split(SEPARATOR).forEach((part, i) => {
    if (part === "") return;
    // Separators, and line breaks on their own, stay plain.
    if (
      i % 2 === 1 ||
      (command === "added" && part.trim() === "" && part.includes("\n"))
    ) {
      out += part;
      lastEnd = null;
      return;
    }
    out += `\\${command}${options}{${part}`;
    lastEnd = out.length;
    out += "}";
    pieces++;
  });
  return { text: out, pieces, lastEnd };
}

/** A caret marker that never occurs in LaTeX source. */
const CARET = "\u0000";

/** Whether `pos` sits inside math (not at its edges). */
function insideMath(source: string, pos: number): boolean {
  const region = findMathRegion(source, pos);
  return region !== null && region.from < pos && pos < region.to;
}

/** Whether `pos` sits inside or right after a control word, or inside
 *  the braces of `\begin`/`\end`. */
function insideCommandName(source: string, pos: number): boolean {
  let i = pos;
  while (i > 0 && /[A-Za-z@*]/.test(source[i - 1])) i--;
  if (i < pos && i > 0 && source[i - 1] === "\\") {
    // Not an escaped backslash ("\\word").
    let slashes = 0;
    for (let j = i - 1; j >= 0 && source[j] === "\\"; j--) slashes++;
    if (slashes % 2 === 1) return true;
  }
  if (source[pos - 1] === "\\") {
    let slashes = 0;
    for (let j = pos - 1; j >= 0 && source[j] === "\\"; j--) slashes++;
    if (slashes % 2 === 1) return true;
  }
  const open = source.lastIndexOf("{", pos - 1);
  if (open !== -1) {
    const close = source.indexOf("}", open);
    if (
      close >= pos &&
      /\\(?:begin|end)\s*$/.test(source.slice(Math.max(0, open - 8), open))
    ) {
      return true;
    }
  }
  return false;
}

function boundaryProblem(source: string, pos: number): string | null {
  if (insideMath(source, pos)) {
    return "Can't suggest inside math. Select the whole formula to replace it.";
  }
  if (insideCommandName(source, pos)) return "Can't suggest inside a command name.";
  return null;
}

/** The new-text range of a change (`\added`, `\replaced`), else null. */
const insertion = (c: Change) =>
  c.kind === "added" || c.kind === "replaced" ? c.added : null;

/** The innermost change whose range contains [from, to). */
function innermost(changes: Change[], from: number, to: number): Change | null {
  let best: Change | null = null;
  for (const c of changes) {
    if (c.range.from <= from && to <= c.range.to) best = c;
  }
  return best;
}

/** The own insertion the caret at `pos` types into: inside its new
 *  text, or right before or after the command. */
function ownInsertionAt(changes: Change[], pos: number, author: string): Change | null {
  let best: Change | null = null;
  for (const c of changes) {
    const body = insertion(c);
    if (body === null || c.author !== author) continue;
    const touches =
      (body.from <= pos && pos <= body.to) ||
      pos === c.range.to ||
      (c.kind === "added" && pos === c.range.from);
    if (touches) best = c;
  }
  return best;
}

/** Applies one edit and returns the new source. */
const splice = (source: string, from: number, to: number, insert: string) =>
  source.slice(0, from) + insert + source.slice(to);

function contentProblem(syntax: Syntax): SuggestRefused | null {
  return syntax === "comment" || syntax === "brace"
    ? refuse(SYNTAX_MESSAGE[syntax])
    : null;
}

/** Types `text` at `pos`. */
export function suggestInsert(
  source: string,
  pos: number,
  text: string,
  author: string,
  pending: SourceRange | null = null,
): SuggestResult {
  if (text === "") return refuse("Nothing to insert.");
  // Still typing an own suggestion the parser can't read yet.
  if (pending !== null && pending.from <= pos && pos <= pending.to) {
    const next = splice(source, pos, pos, text);
    const content = next.slice(pending.from, pending.to + text.length);
    const syntax = syntaxOf(content);
    const problem = contentProblem(syntax);
    if (problem) return problem;
    return {
      ok: true,
      source: next,
      cursor: pos + text.length,
      textStart: pos,
      pending:
        syntax === "open" ? { from: pending.from, to: pending.to + text.length } : null,
      marked: false,
    };
  }
  const problem = boundaryProblem(source, pos);
  if (problem) return refuse(problem);

  const changes = parseChanges(source);
  // The caret in struck-out text: type after the deletion.
  for (const c of changes) {
    if (c.deleted && c.deleted.from <= pos && pos <= c.deleted.to) {
      pos = c.kind === "deleted" && pos === c.deleted.from ? c.range.from : c.range.to;
    }
  }

  const own = ownInsertionAt(changes, pos, author);
  if (own !== null) {
    const body = insertion(own)!;
    const at = pos < body.from ? body.from : pos > body.to ? body.to : pos;
    const content = source.slice(body.from, at) + text + source.slice(at, body.to);
    if (SEPARATOR.test(content)) {
      if (own.kind !== "added") {
        return refuse("Can't add a paragraph break inside a replacement.");
      }
      // Split the suggestion around the break; the caret marker finds
      // the caret again in the result.
      const options = optionsOf(source, own, author);
      const marked =
        content.slice(0, at - body.from + text.length) +
        CARET +
        content.slice(at - body.from + text.length);
      const wrapped = wrap(marked, "added", options).text.replace(
        `\\added${options}{${CARET}}`,
        CARET,
      );
      const caret = wrapped.indexOf(CARET);
      return {
        ok: true,
        source: splice(
          source,
          own.range.from,
          own.range.to,
          wrapped.replace(CARET, ""),
        ),
        cursor: own.range.from + caret,
        textStart: null,
        pending: null,
        marked: true,
      };
    }
    const syntax = syntaxOf(content);
    const bad = contentProblem(syntax);
    if (bad) return bad;
    const next = splice(source, at, at, text);
    return {
      ok: true,
      source: next,
      cursor: at + text.length,
      textStart: at,
      pending:
        syntax === "open" ? { from: body.from, to: body.to + text.length } : null,
      marked: false,
    };
  }

  const wrapped = wrap(text, "added", opts(author));
  const pieces = piecesOf(text);
  let lastSyntax: Syntax = "ok";
  for (const piece of pieces) {
    lastSyntax = syntaxOf(piece);
    const bad = contentProblem(lastSyntax);
    if (bad) return bad;
  }
  const next = splice(source, pos, pos, wrapped.text);
  const prefix = `\\added${opts(author)}{`.length;
  const cursor =
    wrapped.lastEnd === null ? pos + wrapped.text.length : pos + wrapped.lastEnd;
  return {
    ok: true,
    source: next,
    cursor,
    textStart:
      wrapped.pieces === 1 && wrapped.text.length === text.length + prefix + 1
        ? pos + prefix
        : null,
    pending:
      lastSyntax === "open" && wrapped.lastEnd !== null
        ? {
            from: pos + wrapped.lastEnd - pieces[pieces.length - 1].length,
            to: pos + wrapped.lastEnd,
          }
        : null,
    marked: wrapped.pieces > 0,
  };
}

type Mode = "plain" | "own" | "deleted";

interface Run {
  from: number;
  to: number;
  text: string;
  options: string | null;
}

/** Deletes [from, to): see the module comment. */
export function suggestDelete(
  source: string,
  from: number,
  to: number,
  author: string,
  pending: SourceRange | null = null,
  caret: "start" | "end" = "start",
): SuggestResult {
  if (from >= to) return refuse("Nothing to delete.");
  if (pending !== null && pending.from <= from && to <= pending.to) {
    const nextTo = pending.to - (to - from);
    const content = source.slice(pending.from, from) + source.slice(to, pending.to);
    const syntax = syntaxOf(content);
    return {
      ok: true,
      source: splice(source, from, to, ""),
      cursor: from,
      textStart: null,
      pending: syntax === "ok" ? null : { from: pending.from, to: nextTo },
      marked: false,
    };
  }
  for (const pos of [from, to]) {
    if (insideMath(source, pos)) {
      return refuse(
        "Can't suggest inside math. Select the whole formula to delete it.",
      );
    }
  }
  if (insideCommandName(source, from) || insideCommandName(source, to)) {
    return refuse("Select whole commands to suggest deleting them.");
  }

  const changes = parseChanges(source);
  const roots = changes.filter(
    (c) =>
      !changes.some(
        (p) => p !== c && p.range.from <= c.range.from && c.range.to <= p.range.to,
      ),
  );
  const edits: { from: number; to: number; insert: string }[] = [];
  let problem = null as SuggestRefused | null;
  let marked = false;
  // Own text left with an open brace: still being edited.
  let pendingBody = null as SourceRange | null;

  const flush = (run: Run | null, nodes: Change[]) => {
    if (run === null) return;
    // Merge with an adjacent own deletion in the same container.
    for (const n of nodes) {
      if (n.kind !== "deleted" || n.author !== author || n.deleted === null) continue;
      if (n.range.to === run.from) {
        run.text = source.slice(n.deleted.from, n.deleted.to) + run.text;
        run.from = n.range.from;
        run.options ??= optionsOf(source, n, author);
      } else if (n.range.from === run.to) {
        run.text += source.slice(n.deleted.from, n.deleted.to);
        run.to = n.range.to;
        run.options ??= optionsOf(source, n, author);
      }
    }
    if (run.text === "") {
      edits.push({ from: run.from, to: run.to, insert: "" });
      return;
    }
    for (const piece of piecesOf(run.text)) {
      const syntax = syntaxOf(piece);
      if (syntax !== "ok") {
        problem ??= refuse(
          syntax === "comment"
            ? "Comments can't be suggested for deletion."
            : "Select whole commands to suggest deleting them.",
        );
        return;
      }
    }
    edits.push({
      from: run.from,
      to: run.to,
      insert: wrap(run.text, "deleted", run.options ?? opts(author)).text,
    });
    marked = true;
  };

  /** Walks [lo, hi) of a container whose text is `mode`. */
  const walk = (nodes: Change[], lo: number, hi: number, mode: Mode) => {
    if (mode === "deleted") return;
    const a = Math.max(lo, from);
    const b = Math.min(hi, to);
    if (a >= b) return;
    let run: Run | null = null;
    let cursor = a;
    const gap = (g1: number, g2: number) => {
      if (g1 >= g2) return;
      if (mode === "own") {
        edits.push({ from: g1, to: g2, insert: "" });
        return;
      }
      if (run && run.to === g1) {
        run.text += source.slice(g1, g2);
        run.to = g2;
      } else {
        flush(run, nodes);
        run = { from: g1, to: g2, text: source.slice(g1, g2), options: null };
      }
    };
    for (const node of nodes) {
      const { range } = node;
      if (range.to <= a || range.from >= b) continue;
      gap(cursor, Math.max(cursor, range.from));
      const covered = range.from >= from && range.to <= to;
      const mine = node.author === author;
      if (covered && mode === "plain") {
        // A whole suggestion inside the deletion.
        const absorb = (text: string, options: string | null = null) => {
          if (run && run.to === range.from) {
            run.text += text;
            run.to = range.to;
            run.options ??= options;
          } else {
            flush(run, nodes);
            run = { from: range.from, to: range.to, text, options };
          }
        };
        if (node.kind === "added" && mine) absorb("");
        else if (node.kind === "deleted" && mine) {
          absorb(
            source.slice(node.deleted!.from, node.deleted!.to),
            optionsOf(source, node, author),
          );
        } else if (node.kind === "replaced" && mine) {
          absorb(
            source.slice(node.deleted!.from, node.deleted!.to),
            optionsOf(source, node, author),
          );
        } else if (node.kind === "deleted") {
          flush(run, nodes);
          run = null;
        } else absorb(source.slice(range.from, range.to));
      } else if (covered && mode === "own") {
        // Inside own text: own suggestions go, others' stay deleted.
        if (mine && node.kind === "added")
          edits.push({ from: range.from, to: range.to, insert: "" });
        else
          walk(
            node.children,
            node.added?.from ?? range.from,
            node.added?.to ?? range.from,
            "own",
          );
      } else {
        flush(run, nodes);
        run = null;
        partial(node, mode);
      }
      cursor = Math.max(cursor, range.to);
    }
    gap(cursor, b);
    flush(run, nodes);
  };

  /** A suggestion the deletion only partly covers: into its text. */
  const partial = (node: Change, parent: Mode) => {
    const inner = (arg: SourceRange | null, mode: Mode) => {
      if (arg === null) return;
      const kids = node.children.filter(
        (c) => c.range.from >= arg.from && c.range.to <= arg.to,
      );
      walk(kids, arg.from, arg.to, mode);
    };
    if (node.kind === "highlight") return inner(node.added, parent);
    const insMode: Mode =
      node.author === author ? "own" : parent === "own" ? "own" : "plain";
    const before = edits.length;
    inner(node.added, node.kind === "deleted" ? "deleted" : insMode);
    inner(node.deleted, "deleted");
    // Own text deleted to nothing: the suggestion goes, a replacement
    // becomes a deletion of the old text.
    if (
      insMode === "own" &&
      node.author === author &&
      node.added &&
      edits.length > before
    ) {
      const removed = edits
        .slice(before)
        .filter((e) => e.from >= node.added!.from && e.to <= node.added!.to)
        .reduce((n, e) => n + (e.to - e.from) - e.insert.length, 0);
      if (removed === node.added.to - node.added.from) {
        edits.splice(before);
        edits.push({
          from: node.range.from,
          to: node.range.to,
          insert:
            node.kind === "replaced"
              ? `\\deleted${optionsOf(source, node, author)}{${source.slice(node.deleted!.from, node.deleted!.to)}}`
              : "",
        });
      } else {
        const remaining = applyAll(
          source.slice(node.added.from, node.added.to),
          edits.slice(before).map((e) => ({
            ...e,
            from: e.from - node.added!.from,
            to: e.to - node.added!.from,
          })),
        );
        const syntax = syntaxOf(remaining);
        if (syntax === "open") pendingBody = node.added;
        else if (syntax !== "ok") problem ??= refuse(SYNTAX_MESSAGE[syntax]);
      }
    }
  };

  walk(roots, 0, source.length, "plain");
  if (problem) return problem;
  if (edits.length === 0) {
    return {
      ok: true,
      source,
      cursor: from,
      textStart: null,
      pending: null,
      marked: false,
    };
  }
  edits.sort((x, y) => x.from - y.from);
  const next = applyAll(source, edits);
  return {
    ok: true,
    source: next,
    cursor: caret === "start" ? mapPos(edits, from, -1) : mapPos(edits, to, 1),
    textStart: null,
    pending:
      pendingBody === null
        ? null
        : {
            from: mapPos(edits, pendingBody.from, -1),
            to: mapPos(edits, pendingBody.to, 1),
          },
    marked,
  };
}

/** Applies sorted, non-overlapping edits. */
function applyAll(
  source: string,
  edits: { from: number; to: number; insert: string }[],
): string {
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    out += source.slice(cursor, e.from) + e.insert;
    cursor = e.to;
  }
  return out + source.slice(cursor);
}

/** Maps a position through sorted edits; `assoc` < 0 keeps it before
 *  an edit's new text, > 0 puts it after. */
function mapPos(
  edits: { from: number; to: number; insert: string }[],
  pos: number,
  assoc: number,
): number {
  let shift = 0;
  for (const e of edits) {
    if (pos < e.from || (pos === e.from && assoc < 0)) break;
    if (pos <= e.to) {
      return e.from + shift + (assoc < 0 && pos < e.to ? 0 : e.insert.length);
    }
    shift += e.insert.length - (e.to - e.from);
  }
  return pos + shift;
}

/** Where a caret at `pos` really is when moving back over hidden
 *  markup and struck-out text. */
function skipBackward(changes: Change[], pos: number): number {
  for (let guard = 0; guard < 64; guard++) {
    const c =
      changes.find((x) => x.range.to === pos) ??
      changes.find((x) => (x.added ?? x.deleted)?.from === pos);
    if (!c) return pos;
    if (c.range.to === pos) {
      if (c.kind === "deleted") pos = c.range.from;
      else if (c.added) pos = c.added.to;
      else return pos;
    } else if (c.kind === "replaced" || pos === (c.added ?? c.deleted)!.from) {
      pos = c.range.from;
    }
  }
  return pos;
}

/** The same, moving forward. */
function skipForward(changes: Change[], pos: number): number {
  for (let guard = 0; guard < 64; guard++) {
    const c =
      changes.find((x) => x.range.from === pos) ??
      changes.find(
        (x) => (x.kind === "replaced" ? x.added : (x.added ?? x.deleted))?.to === pos,
      );
    if (!c) return pos;
    if (c.range.from === pos) {
      if (c.kind === "deleted") pos = c.range.to;
      else if (c.added) pos = c.added.from;
      else return pos;
    } else {
      pos = c.range.to;
    }
  }
  return pos;
}

/** Backspace or Delete at a caret: one visible character, skipping
 *  hidden markup and text that is already struck out. */
export function suggestDeleteChar(
  source: string,
  head: number,
  direction: "backward" | "forward",
  author: string,
  pending: SourceRange | null = null,
): SuggestResult {
  if (
    pending !== null &&
    pending.from < head &&
    head <= pending.to &&
    direction === "backward"
  ) {
    return suggestDelete(source, head - 1, head, author, pending);
  }
  const changes = parseChanges(source);
  if (direction === "backward") {
    const pos = skipBackward(changes, head);
    if (pos === 0)
      return {
        ok: true,
        source,
        cursor: head,
        textStart: null,
        pending: null,
        marked: false,
      };
    const result = suggestDelete(source, pos - 1, pos, author, pending);
    // Syntax only (a brace, a command name): step over it.
    if (!result.ok && /whole commands/.test(result.message)) {
      return {
        ok: true,
        source,
        cursor: pos - 1,
        textStart: null,
        pending: null,
        marked: false,
      };
    }
    return result;
  }
  const pos = skipForward(changes, head);
  if (pos >= source.length) {
    return {
      ok: true,
      source,
      cursor: head,
      textStart: null,
      pending: null,
      marked: false,
    };
  }
  const result = suggestDelete(source, pos, pos + 1, author, pending, "end");
  if (!result.ok && /whole commands/.test(result.message)) {
    return {
      ok: true,
      source,
      cursor: pos + 1,
      textStart: null,
      pending: null,
      marked: false,
    };
  }
  return result;
}

/** Typing over [from, to): one `\replaced`, or a deletion then an
 *  insertion when the selection spans other suggestions. */
export function suggestReplace(
  source: string,
  from: number,
  to: number,
  text: string,
  author: string,
  pending: SourceRange | null = null,
): SuggestResult {
  if (from === to) return suggestInsert(source, from, text, author, pending);
  if (text === "") return suggestDelete(source, from, to, author, pending);
  const changes = parseChanges(source);
  const container = innermost(changes, from, to);
  const touched = changes.some((c) => c.range.to > from && c.range.from < to);
  const old = source.slice(from, to);
  const containerBody = container ? insertion(container) : null;
  // Inside own new text: change it directly.
  if (
    container &&
    container.author === author &&
    containerBody &&
    containerBody.from <= from &&
    to <= containerBody.to &&
    !container.children.some((c) => c.range.to > from && c.range.from < to)
  ) {
    const content =
      source.slice(containerBody.from, from) +
      text +
      source.slice(to, containerBody.to);
    const syntax = syntaxOf(content);
    const bad = contentProblem(syntax);
    if (bad) return bad;
    if (SEPARATOR.test(content))
      return refuse("Can't add a paragraph break inside a suggestion.");
    return {
      ok: true,
      source: splice(source, from, to, text),
      cursor: from + text.length,
      textStart: from,
      pending:
        syntax === "open"
          ? {
              from: containerBody.from,
              to: containerBody.to - old.length + text.length,
            }
          : null,
      marked: false,
    };
  }
  const plainContainer =
    container === null ||
    (containerBody !== null && containerBody.from <= from && to <= containerBody.to);
  if (
    !touched &&
    plainContainer &&
    !SEPARATOR.test(old) &&
    !SEPARATOR.test(text) &&
    syntaxOf(old) === "ok" &&
    !insideMath(source, from) &&
    !insideMath(source, to) &&
    !insideCommandName(source, from) &&
    !insideCommandName(source, to)
  ) {
    const syntax = syntaxOf(text);
    const bad = contentProblem(syntax);
    if (bad) return bad;
    const head = `\\replaced${opts(author)}{`;
    const insert = `${head}${text}}{${old}}`;
    return {
      ok: true,
      source: splice(source, from, to, insert),
      cursor: from + head.length + text.length,
      textStart: from + head.length,
      pending:
        syntax === "open"
          ? { from: from + head.length, to: from + head.length + text.length }
          : null,
      marked: true,
    };
  }
  // The new text goes after the struck-out old text.
  const deleted = suggestDelete(source, from, to, author, pending, "end");
  if (!deleted.ok) return deleted;
  const inserted = suggestInsert(deleted.source, deleted.cursor, text, author, null);
  if (!inserted.ok) return inserted;
  return { ...inserted, marked: inserted.marked || deleted.marked };
}
