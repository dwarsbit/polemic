/**
 * Issues from a LaTeX log, for compiles that don't run in the desktop
 * app (the browser build). A port of src-tauri/src/logparse.rs: keep
 * the two in step, and the tests in logparse.test.ts mirror the Rust
 * ones.
 */

import type { CompileIssue } from "@/lib/tauri";

/** The place of an error that -file-line-error prints: a file of the
 *  project, or one outside it (the TeX distribution, a parent folder). */
type ErrorPlace = { file: string; line: number } | "outside";

const FILE_LINE = /^(.+?):(\d+): (.*)$/;

/**
 * An error line as -file-line-error prints it:
 * `./chapters/intro.tex:12: Undefined control sequence.` A file TeX found
 * through the main file's folder has no `./` (`demo/frames.tex:45: …`).
 * TeX's closing `==> Fatal error occurred` says nothing and is left out.
 */
function parseErrorLine(line: string): [ErrorPlace, string] | null {
  const match = FILE_LINE.exec(line);
  if (!match) return null;
  const [, path, num, rest] = match;
  const message = rest.trim();
  if (message === "" || message.startsWith("==>")) return null;
  const absolute = path.startsWith("/") || /^[A-Za-z]:[/\\]/.test(path);
  if (absolute || path.startsWith("../")) return ["outside", message];
  if (path.startsWith("./")) {
    return [{ file: path.slice(2), line: Number(num) }, message];
  }
  // Without `./`, only what reads as a file name: no log prose.
  if (
    /^l\.\d/.test(path) ||
    !/^[^\s!(<*\\][^()<>\\"`']*\.[A-Za-z0-9_-]{1,10}$/.test(path)
  )
    return null;
  return [{ file: path, line: Number(num) }, message];
}

const CONTEXT_LINE = /^l\.(\d+)/;

/** The `l.12 …` line TeX prints after an error. */
function contextLineNo(line: string): number | null {
  const match = CONTEXT_LINE.exec(line);
  return match ? Number(match[1]) : null;
}

const isWarningLine = (line: string) =>
  (line.startsWith("LaTeX") && line.includes("Warning:")) ||
  ((line.startsWith("Package ") || line.startsWith("Class ")) &&
    line.includes(" Warning:"));

/** Where the next message starts: TeX's context for an error ends there. */
const startsMessage = (line: string) =>
  line.startsWith("!") || FILE_LINE.test(line) || isWarningLine(line);

/** How far below an error its `l.N` line is looked for: past TeX's
 *  help text and the macros it was expanding. */
const CONTEXT_REACH = 40;

/** The error's context block: the `l.N` line that follows it, before
 *  the next message, plus up to three indented continuations. */
function detailFrom(lines: string[], start: number): [string[], number] {
  let at: number | null = null;
  const end = Math.min(lines.length, start + CONTEXT_REACH);
  for (let i = start; i < end; i++) {
    if (CONTEXT_LINE.test(lines[i])) {
      at = i;
      break;
    }
    if (startsMessage(lines[i])) break;
  }
  if (at === null) return [[], start];
  const detail = [lines[at]];
  let i = at + 1;
  while (i < lines.length && lines[i].startsWith(" ") && detail.length < 4) {
    detail.push(lines[i]);
    i++;
  }
  return [detail, i];
}

/** `... on input line 4.`, the location at the end of LaTeX warnings. */
function warningLine(message: string): number | null {
  const marker = "on input line ";
  const idx = message.lastIndexOf(marker);
  if (idx < 0) return null;
  const rest = message.slice(idx + marker.length);
  const digits = /^\d+/.exec(rest)?.[0];
  if (!digits) return null;
  const after = rest.slice(digits.length);
  return after === "" || after.startsWith(".") ? Number(digits) : null;
}

function errorHint(message: string): string | null {
  if (message.includes("-shell-escape")) {
    return "Polemic compiles without shell escape, so packages that run other programs (minted, the TikZ externalization library) don't work. The listings package highlights code without it.";
  }
  return null;
}

/** A file name as TeX prints it when it opens the file. */
function looksLikePath(token: string): boolean {
  if (token === "") return false;
  const drive = /^[A-Za-z]:[/\\]/.test(token);
  if (
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.startsWith("/") ||
    drive
  ) {
    return true;
  }
  const name = token.split("/").pop() ?? "";
  return token.includes("/") && name.includes(".");
}

/** A file of the project, as TeX names it: `./intro.tex`, or without
 *  `./` when TeX found it through the main file's folder. Files of the
 *  TeX distribution have absolute paths; build/ holds TeX's own output. */
function isProjectFile(token: string): boolean {
  const drive = /^[A-Za-z]:[/\\]/.test(token);
  if (token.startsWith("/") || drive || token.startsWith("../")) return false;
  const file = token.startsWith("./") ? token.slice(2) : token;
  return !file.startsWith("build/") && !file.includes("://");
}

/** The files TeX has open, from the `(./intro.tex` and `)` it prints. */
class FileStack {
  /** Each open file, and whether it is a project file. */
  private open: [string, boolean][] = [];
  private otherParens = 0;

  currentProjectFile(): string | null {
    const last = this.open[this.open.length - 1];
    return last?.[1] ? last[0] : null;
  }

  innermostProjectFile(): string | null {
    for (let i = this.open.length - 1; i >= 0; i--) {
      if (this.open[i][1]) return this.open[i][0];
    }
    return null;
  }

  inPackageFile(): boolean {
    const last = this.open[this.open.length - 1];
    return last !== undefined && !last[1];
  }

  read(line: string): void {
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (c === "(") {
        const token = line.slice(i + 1).split(/[\s()]/)[0] ?? "";
        if (looksLikePath(token)) {
          const file = token.startsWith("./") ? token.slice(2) : token;
          this.open.push([file, isProjectFile(token)]);
          i += 1 + token.length;
          continue;
        }
        this.otherParens++;
      } else if (c === ")") {
        if (this.otherParens > 0) this.otherParens--;
        else this.open.pop();
      }
      i++;
    }
  }
}

const PACKAGE_PREFIX = /^\(([\p{L}\p{N}\-_.]+)\)( .*)$/u;

/** The lines a message continues on: `(pkg)   …`, and for warnings
 *  any indented line. */
function continuation(
  lines: string[],
  start: number,
  indentedToo: boolean,
): [string, number] {
  let text = "";
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const paren = PACKAGE_PREFIX.exec(line);
    let part: string;
    if (paren) part = paren[2].trim();
    else if (indentedToo && line.startsWith(" ") && line.trim() !== "")
      part = line.trim();
    else break;
    text += " " + part;
    i++;
  }
  return [text, i];
}

const UNRESOLVED = [
  "LaTeX Warning: Citation ",
  "LaTeX Warning: Reference ",
  "LaTeX Warning: There were undefined references",
  "LaTeX Warning: Label(s) may have changed",
  "LaTeX Warning: Empty bibliography",
  "Package rerunfilecheck Warning: File ",
  "Package natbib Warning: Citation ",
  "Package natbib Warning: There were undefined citations",
  "Package biblatex Warning: Please (re)run",
  "Package biblatex Warning: Please rerun LaTeX",
];

/** Missing only because the run stopped before the extra passes. */
function isUnresolvedReferenceWarning(issue: CompileIssue): boolean {
  return UNRESOLVED.some((prefix) => issue.message.startsWith(prefix));
}

function issueOf(
  severity: CompileIssue["severity"],
  file: string | null,
  line: number | null,
  message: string,
): CompileIssue {
  return { severity, file, line, message, detail: [], hint: null };
}

const isEmergencyStop = (issue: CompileIssue) =>
  issue.message.startsWith("Emergency stop");

/**
 * Why TeX stopped, for an "Emergency stop" that no error explains: the
 * notice an engine test prints just before it (`* XeTeX is required to
 * compile this document.`), or TeX's own `*** (job aborted, …)` after it.
 */
function stopReason(lines: string[], at: number): string | null {
  for (let i = at - 1; i >= Math.max(0, at - 8); i--) {
    const notice = /^\s*\* (.+ is required to compile this document\.)$/.exec(lines[i]);
    if (notice) return notice[1];
  }
  for (let i = at + 1; i < Math.min(lines.length, at + 8); i++) {
    const aborted = /^\*\*\* \((job aborted, .+)\)$/.exec(lines[i]);
    if (aborted) return `Emergency stop (${aborted[1]}).`;
  }
  return null;
}

export function parseIssues(log: string): CompileIssue[] {
  const lines = log.split("\n").map((line) => line.trimEnd());
  if (lines[lines.length - 1] === "") lines.pop();
  const issues: CompileIssue[] = [];
  const seen = new Set<string>();
  const files = new FileStack();
  // The last error, if it has no place yet.
  let unplaced: CompileIssue | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === "") {
      i++;
      continue;
    }
    let issue: CompileIssue | null = null;
    let next = i + 1;
    // The l.N line after an error in a package counts that package's lines.
    let inPackage = false;
    // A `!` line: an error that names no place of its own.
    const bare = line.startsWith("!") && !line.slice(1).trim().startsWith("==>");
    const placed = parseErrorLine(line);
    if (placed) {
      const [place, message] = placed;
      const [more, consumed] = continuation(lines, next, false);
      next = consumed;
      inPackage = place === "outside";
      issue =
        place === "outside"
          ? issueOf("error", files.innermostProjectFile(), null, message + more)
          : issueOf("error", place.file, place.line, message + more);
    } else if (bare) {
      const [more, consumed] = continuation(lines, next, false);
      next = consumed;
      // No place of its own: it is in the file TeX is reading.
      inPackage = files.inPackageFile();
      issue = issueOf(
        "error",
        files.innermostProjectFile(),
        null,
        line.slice(1).trim() + more,
      );
    } else if (isWarningLine(line)) {
      const [more, consumed] = continuation(lines, next, true);
      next = consumed;
      const message = (line + more).replace(/\.+$/, "");
      const lineNo = files.inPackageFile() ? null : warningLine(message);
      issue = issueOf("warning", files.currentProjectFile(), lineNo, message);
    }
    if (issue?.severity === "error") {
      const [detail, consumed] = detailFrom(lines, next);
      if (detail.length > 0 && !inPackage) {
        issue.line ??= contextLineNo(detail[0]);
        issue.detail = detail;
      }
      next = Math.max(consumed, next);
      issue.hint = errorHint(issue.message);
      if (isEmergencyStop(issue)) {
        if (issues.some((earlier) => earlier.severity === "error")) {
          // TeX gave up: the errors before it say why. One without a
          // place (a file LaTeX could not find) is where TeX stopped.
          if (unplaced !== null && issue.line !== null) {
            unplaced.file = issue.file;
            unplaced.line = issue.line;
            unplaced.detail = issue.detail;
          }
          issue = null;
        } else {
          issue.message = stopReason(lines, i) ?? issue.message;
        }
      }
      unplaced = null;
    }
    if (issue) {
      // The same message at the same place again says nothing new; one
      // without a line has no place, so its file does not count.
      const key = JSON.stringify([
        issue.severity,
        issue.line === null ? null : issue.file,
        issue.line,
        issue.message,
      ]);
      if (!seen.has(key)) {
        seen.add(key);
        issues.push(issue);
        if (bare && issue.line === null) unplaced = issue;
      }
    }
    for (const read of lines.slice(i, next)) files.read(read);
    i = next;
  }
  const kept = issues.some((issue) => issue.severity === "error")
    ? issues.filter((issue) => !isUnresolvedReferenceWarning(issue))
    : issues;
  // Errors first: they stop the compile, and warnings often follow from them.
  return [...kept].sort(
    (a, b) => Number(a.severity !== "error") - Number(b.severity !== "error"),
  );
}

// --- bibliography tools --------------------------------------------------

type BibTool = "biber" | "bibtex";

const toolName = (tool: BibTool) => (tool === "biber" ? "biber" : "BibTeX");

/**
 * The rules latexmk lists under "Collected error summary" when it gives
 * up, as [rule, what it says]: `bibtex build/main: Bibtex errors: See
 * file 'build/main.blg'`, `cusdep glo gls build/main: Command for … gave
 * return code 512`.
 */
function failedRules(latexmkOutput: string): [string, string][] {
  const rules: [string, string][] = [];
  let inSummary = false;
  for (const line of latexmkOutput.split("\n")) {
    if (line.startsWith("Collected error summary")) {
      inSummary = true;
    } else if (inSummary && line.startsWith("  ")) {
      const at = line.indexOf(": ");
      if (at > 0)
        rules.push([line.slice(0, at).trim().toLowerCase(), line.slice(at + 2)]);
    } else if (line.trim() !== "") {
      inSummary = false;
    }
  }
  return rules;
}

/** Which bibliography tool failed, judging by latexmk's own report. */
function failedBibTool(latexmkOutput: string): BibTool | null {
  for (const raw of latexmkOutput.split("\n")) {
    const line = raw.trim();
    const prefix = "Latexmk: Error return from '";
    const rule = line.startsWith(prefix)
      ? line.slice(prefix.length).toLowerCase()
      : null;
    const lower = line.toLowerCase();
    const says = (tool: string) =>
      (rule?.startsWith(tool) ?? false) ||
      lower.startsWith(`${tool} errors: see file`) ||
      lower.startsWith(`could not open ${tool} log file`) ||
      lower.startsWith(`could not find all ${tool} source files`);
    if (says("biber")) return "biber";
    if (says("bibtex") || (rule?.includes("bibtex") ?? false)) return "bibtex";
  }
  for (const [rule] of failedRules(latexmkOutput)) {
    if (rule.startsWith("biber")) return "biber";
    if (rule.startsWith("bibtex")) return "bibtex";
  }
  return null;
}

type Reason = [string, [string, number] | null];

/** The tool's own complaint, from its .blg or from what it printed. */
function bibToolReasons(
  tool: BibTool,
  latexmkOutput: string,
  blg: string | null,
): Reason[] {
  const reasons: Reason[] = [];
  if (blg !== null) {
    const lines = blg.split("\n").map((line) => line.trimEnd());
    lines.forEach((line, i) => {
      if (tool === "biber") {
        const idx = line.indexOf("ERROR - ");
        if (idx >= 0) reasons.push([line.slice(idx + "ERROR - ".length), null]);
        return;
      }
      // `I couldn't open database file refs.bib` and friends, or a
      // message with `---line 5 of file refs.bib` after it, on the same
      // line or the next.
      const at = line.indexOf("---line ");
      if (
        at >= 0 &&
        !line.startsWith("Warning--") &&
        !line.startsWith("while executing")
      ) {
        const [num, file] = line.slice(at + "---line ".length).split(" of file ", 2);
        const lineNo = /^\d+$/.test(num?.trim() ?? "") ? Number(num.trim()) : null;
        const message = at > 0 ? line.slice(0, at) : (lines[i - 1] ?? "");
        if (lineNo !== null && file !== undefined && message.trim() !== "") {
          const name = file.trim();
          // A place in the .aux file is TeX's own output, not the project's.
          const outside = name.startsWith("/") || name.endsWith(".aux");
          reasons.push([message.trim(), outside ? null : [name, lineNo]]);
        }
      } else if (line.startsWith("A bad cross reference---")) {
        const rest = `${line.slice("A bad cross reference---".length)} ${lines[i + 1] ?? ""}`;
        reasons.push([`A bad cross reference: ${rest.trim()}`, null]);
      } else if (line.startsWith("I couldn't open") || line.startsWith("I found no")) {
        reasons.push([line.split("---")[0].trim(), null]);
      }
    });
  }
  if (reasons.length === 0) {
    const program = tool;
    for (const raw of latexmkOutput.split("\n")) {
      const line = raw.trim();
      const lower = line.toLowerCase();
      if (
        lower.startsWith(`${program}:`) ||
        lower.startsWith(`${program}8:`) ||
        lower.includes(`${program}: command not found`) ||
        lower.includes(`'${program}' is not recognized`)
      ) {
        reasons.push([line, null]);
      }
    }
  }
  return reasons.filter((reason, i) => i === 0 || reasons[i - 1][0] !== reason[0]);
}

function bibToolHint(tool: BibTool, reason: string): string {
  const lower = reason.toLowerCase();
  const biberFallback =
    tool === "biber"
      ? " For now, backend=bibtex in the biblatex options avoids biber."
      : "";
  if (lower.includes("command not found") || lower.includes("is not recognized")) {
    return `${toolName(tool)} is not installed or not on the PATH. Install it with your TeX distribution.${biberFallback}`;
  }
  if (lower.includes("control file version") || lower.includes("expected version")) {
    return "biber and biblatex come from different releases. Update your TeX distribution so they match.";
  }
  if (lower.includes("cannot find") || lower.includes("couldn't open database")) {
    return tool === "biber"
      ? "Check the \\addbibresource path: it is relative to the main file and includes the .bib extension."
      : "Check the \\bibliography path: it is relative to the main file and leaves out the .bib extension.";
  }
  if (lower.includes("found no \\citation")) {
    return "BibTeX needs at least one \\cite (or \\nocite{*}) before it builds a bibliography.";
  }
  if (lower.includes("found no \\bibdata")) {
    return "Add \\bibliography{name} (without .bib) where the bibliography should appear.";
  }
  if (lower.includes("found no \\bibstyle")) {
    return "Add a style, e.g. \\bibliographystyle{plain}.";
  }
  if (lower.startsWith("repeated entry")) {
    return "Two entries in the .bib file have the same key. Rename or remove one of them.";
  }
  if (lower.startsWith("a bad cross reference")) {
    return "The crossref field names an entry that is not in the .bib file.";
  }
  if (
    lower.includes("syntax error") ||
    lower.includes("bibtex subsystem") ||
    lower.startsWith("i was expecting")
  ) {
    return "An entry in the .bib file is malformed; the Bibliography panel flags entries it cannot parse.";
  }
  if (
    tool === "biber" &&
    !lower.startsWith("error") &&
    (lower.startsWith("biber:") || lower.includes("lipo") || lower.includes("killed"))
  ) {
    return `biber crashed before reading your files, which points at the biber installation. Update your TeX distribution.${biberFallback}`;
  }
  return `The compile log has ${toolName(tool)}'s full output.`;
}

/** The failure of biber or BibTeX in a latexmk run, as one issue with a hint. */
export function parseBibToolFailure(
  latexmkOutput: string,
  blg: string | null,
): CompileIssue | null {
  const tool = failedBibTool(latexmkOutput);
  if (tool === null) return null;
  const reasons = bibToolReasons(tool, latexmkOutput, blg);
  const first = reasons[0];
  const message = first
    ? `${toolName(tool)} failed: ${first[0]}`
    : `${toolName(tool)} failed, so citations and the bibliography were not built`;
  return {
    severity: "error",
    file: first?.[1]?.[0] ?? null,
    line: first?.[1]?.[1] ?? null,
    message,
    detail: reasons.slice(1, 4).map(([reason]) => reason),
    hint: bibToolHint(tool, first?.[0] ?? ""),
  };
}

/** The tool behind a latexmk rule that is not TeX or the bibliography,
 *  and what it builds: [tool, "the glossary"]. */
function otherTool(rule: string): [string, string] | null {
  const words = rule.split(/\s+/);
  if (words[0] === "cusdep") {
    if (words[1] === "glo" || words[1] === "acn")
      return ["makeglossaries", "the glossary"];
    if (words[1] === "nlo") return ["makeindex", "the nomenclature"];
    return null;
  }
  if (words[0] === "makeindex") return ["makeindex", "the index"];
  return null;
}

/**
 * A latexmk run that failed outside TeX and the bibliography: a
 * glossary or index tool that stopped, or a document that never settles.
 * Like bibliography failures, these never reach the LaTeX .log.
 */
export function parseRunFailure(latexmkOutput: string): CompileIssue | null {
  for (const [rule] of failedRules(latexmkOutput)) {
    const tool = otherTool(rule);
    if (tool === null) continue;
    return {
      severity: "error",
      file: null,
      line: null,
      message: `${tool[0]} failed, so ${tool[1]} was not built`,
      detail: [],
      hint: `The compile log has the full output of ${tool[0]}.`,
    };
  }
  if (/^Latexmk: Maximum runs of \S+ reached/m.test(latexmkOutput)) {
    return {
      severity: "error",
      file: null,
      line: null,
      message: "The document kept changing between runs, so the compile stopped",
      detail: [],
      hint: "Something changes on every run, such as a reference that moves to another page each time. The compile log shows what changed.",
    };
  }
  return null;
}

/** Whether an issue only repeats a bibliography failure ("Please (re)run Biber"). */
export function isRerunBibToolWarning(issue: CompileIssue): boolean {
  return issue.message.startsWith("Package biblatex Warning: Please (re)run");
}

/** A font fontspec cannot find is usually one on this computer, not on the server. */
export function addFontHints(issues: CompileIssue[]): void {
  for (const issue of issues) {
    if (!issue.hint && issue.message.includes('fontspec Error: The font "')) {
      issue.hint =
        "Polemic's server has TeX Live's fonts, not the ones installed on this computer. Put the font file (.otf or .ttf) in the project and load it by file name, e.g. \\setmainfont{MyFont-Regular.otf}.";
    }
  }
}
