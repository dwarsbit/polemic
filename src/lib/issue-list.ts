/**
 * The issues of a compile in the order to read them. TeX keeps going
 * after an error, so one mistake is often followed by many errors that
 * disappear with it: the first error stands on top and the ones after
 * it fold into one row. Repeats count as one row, and warnings of one
 * kind (undefined citations, replaced fonts) list as one.
 */

import {
  explainIssue,
  type ExplainContext,
  type Explanation,
} from "@/lib/explain-issue";
import type { CompileIssue } from "@/lib/tauri";

/** One issue with its plain wording. */
export interface IssueEntry {
  issue: CompileIssue;
  /** The catalog's title, or TeX's message. */
  title: string;
  explanation: Explanation | null;
}

/** One row of the list: an issue, its repeats, or the issues of a kind. */
export interface IssueRow {
  /** Names the row from one compile to the next, so that what the
   *  reader opened stays open. */
  key: string;
  severity: CompileIssue["severity"];
  title: string;
  /** How often it occurs, when the title doesn't say so itself. */
  repeats: number | null;
  /** What to do about it. */
  advice: string | null;
  /** The issues it stands for, in the order of the log. */
  entries: IssueEntry[];
}

export interface IssueList {
  /** The error to fix first, below anything that stopped the whole
   *  compile (a time limit). */
  first: IssueRow[];
  /** TeX's errors after the first one, repeats merged. */
  followOn: IssueRow[];
  /** How many errors `followOn` stands for. */
  followOnCount: number;
  /** Failures outside TeX (the bibliography, a glossary, an index),
   *  which the first error doesn't explain. */
  tools: IssueRow[];
  warnings: IssueRow[];
}

const STOPPED = /^The compile was stopped after /;
const TOOL_FAILED =
  /^(?:biber|BibTeX|makeglossaries|makeindex) failed[:,]|^The document kept changing between runs/;

/** Where an error comes from: TeX's log, a tool that ran beside TeX,
 *  or the limit that ended the compile. */
export function errorSource(issue: CompileIssue): "tex" | "tool" | "stopped" {
  if (STOPPED.test(issue.message)) return "stopped";
  return TOOL_FAILED.test(issue.message) ? "tool" : "tex";
}

/** A message without its specifics, to tell kinds of warnings apart. */
function kindOf(message: string): string {
  return message.replace(/[`'"][^`'"]*['"]/g, "‹›").replace(/\d+(\.\d+)?/g, "0");
}

function row(
  prefix: string,
  entries: IssueEntry[],
  many: string | undefined,
): IssueRow {
  const [head] = entries;
  const counted = entries.length > 1 && many !== undefined;
  return {
    key: `${prefix}:${counted ? many : head.title}`,
    severity: head.issue.severity,
    title: counted ? `${entries.length} ${many}` : head.title,
    repeats: entries.length > 1 && !counted ? entries.length : null,
    advice: head.issue.hint ?? head.explanation?.help ?? null,
    entries,
  };
}

/** Rows for entries that share what `kind` gives, in order of first
 *  appearance. */
function grouped(
  prefix: string,
  entries: IssueEntry[],
  kind: (entry: IssueEntry) => string,
): IssueRow[] {
  const groups = new Map<string, IssueEntry[]>();
  for (const entry of entries) {
    const key = kind(entry);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.values()].map((group) =>
    row(prefix, group, group[0].explanation?.many),
  );
}

export function arrangeIssues(issues: CompileIssue[], ctx: ExplainContext): IssueList {
  const entries = issues.map((issue): IssueEntry => {
    const explanation = explainIssue(issue, ctx);
    return { issue, title: explanation?.title ?? issue.message, explanation };
  });
  const errors = entries.filter((entry) => entry.issue.severity === "error");
  const from = (source: ReturnType<typeof errorSource>) =>
    errors.filter((entry) => errorSource(entry.issue) === source);
  const [cause, ...rest] = from("tex");
  return {
    first: [
      ...from("stopped").map((entry) => row("stopped", [entry], undefined)),
      ...(cause ? [row("error", [cause], undefined)] : []),
    ],
    followOn: grouped("after", rest, (entry) => entry.title),
    followOnCount: rest.length,
    tools: from("tool").map((entry) => row("tool", [entry], undefined)),
    warnings: grouped(
      "warning",
      entries.filter((entry) => entry.issue.severity !== "error"),
      (entry) => entry.explanation?.many ?? kindOf(entry.issue.message),
    ),
  };
}

/** The error to read first, if the compile has one. */
export function firstError(list: IssueList): IssueRow | null {
  return list.first[0] ?? list.tools[0] ?? null;
}

/** The source line of an error, split where TeX stopped reading. */
export interface SourceSpot {
  line: number;
  /** The line up to what TeX stopped at. */
  before: string;
  /** What TeX stopped at: the last command or character it read. */
  at: string;
  /** The rest of the line, which TeX had not read yet. */
  after: string;
}

/** Errors LaTeX or a package raises itself, as opposed to TeX. */
const RAISED_BY_LATEX = /^(?:Critical |Fatal )?(?:LaTeX|Package|Class)\b.*?Error:/;
const NOT_FOUND = /File [`']([^`']+)' not found/;

/**
 * TeX shows the place of an error as the source line broken in two:
 * `l.12 \frrac` and, below it and indented to the same column, the
 * part it had not read (`{a}{b}`). For an error of TeX's own, what it
 * read last is what it stopped at. LaTeX and packages raise theirs
 * after reading a command's arguments, so there the line is all there
 * is to show.
 */
export function sourceSpot(issue: CompileIssue): SourceSpot | null {
  const [head, tail] = issue.detail;
  const match = /^l\.(\d+) ?(.*)$/.exec(head ?? "");
  if (!match) return null;
  const read = match[2];
  const unread =
    tail === undefined
      ? ""
      : tail.startsWith(" ".repeat(head.length))
        ? tail.slice(head.length)
        : tail.trimStart();
  const line = Number(match[1]);
  if (RAISED_BY_LATEX.test(issue.message)) {
    // LaTeX looks ahead for more arguments, so for a package it can't
    // find it may already be on a later line: not the place to show.
    const missing = NOT_FOUND.exec(issue.message)?.[1];
    const name = missing?.replace(/^.*\//, "").replace(/\.[A-Za-z0-9]+$/, "");
    const text = (read + unread).trimEnd();
    if (name !== undefined && !text.includes(name)) return null;
    return { line, before: text, at: "", after: "" };
  }
  const stop = /(\\[A-Za-z@]+|\\.|\S)(\s*)$/.exec(read);
  return {
    line,
    before: stop ? read.slice(0, stop.index) : read,
    at: stop ? stop[1] : "",
    after: ((stop ? stop[2] : "") + unread).trimEnd(),
  };
}
