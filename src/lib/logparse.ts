/**
 * Issues from a LaTeX log, for compiles that don't run in the desktop
 * app (the browser build). A port of src-tauri/src/logparse.rs: keep
 * the two in step, and the tests in logparse.test.ts mirror the Rust
 * ones.
 */

import type { CompileIssue } from "@/lib/tauri";

/** `./chapters/intro.tex:12: Undefined control sequence.` (-file-line-error). */
function parseFileLineError(line: string): [string, number, string] | null {
  if (!line.startsWith("./")) return null;
  const rest = line.slice(2);
  const idx = rest.indexOf(": ");
  if (idx < 0) return null;
  const loc = rest.slice(0, idx);
  const message = rest.slice(idx + 2);
  const colon = loc.lastIndexOf(":");
  if (colon < 0) return null;
  const num = loc.slice(colon + 1);
  if (!/^\d+$/.test(num)) return null;
  return [loc.slice(0, colon), Number(num), message];
}

/**
 * An error raised inside a file of the TeX distribution:
 * `/usr/…/fontspec.sty:100: Fatal Package fontspec Error: …`. The
 * message only; TeX's closing `==> Fatal error occurred` is left out.
 */
function parsePackageFileError(line: string): string | null {
  const drive = line.length > 2 && /^[A-Za-z]:/.test(line);
  if (!line.startsWith("/") && !drive) return null;
  const from = drive ? 2 : 0;
  const found = line.slice(from).indexOf(": ");
  if (found < 0) return null;
  const idx = from + found;
  const head = line.slice(0, idx);
  const colon = head.lastIndexOf(":");
  if (colon < 0 || !/^\d+$/.test(head.slice(colon + 1))) return null;
  const message = line.slice(idx + 2).trim();
  return message !== "" && !message.startsWith("==>") ? message : null;
}

const CONTEXT_LINE = /^l\.(\d+)/;

/** The `l.12 …` line TeX prints after an error. */
function contextLineNo(line: string): number | null {
  const match = CONTEXT_LINE.exec(line);
  return match ? Number(match[1]) : null;
}

/** The error's context block: the `l.N` line, directly or after one
 *  `<inserted text>` line, plus up to three indented continuations. */
function detailFrom(lines: string[], start: number): [string[], number] {
  const isContext = (line: string | undefined) =>
    line !== undefined && CONTEXT_LINE.test(line);
  let at: number | null = null;
  if (isContext(lines[start])) at = start;
  else if (lines[start]?.startsWith("<") && isContext(lines[start + 1])) at = start + 1;
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
          const project = token.startsWith("./") && !token.startsWith("./build/");
          this.open.push([token.startsWith("./") ? token.slice(2) : token, project]);
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

export function parseIssues(log: string): CompileIssue[] {
  const lines = log.split("\n").map((line) => line.trimEnd());
  if (lines[lines.length - 1] === "") lines.pop();
  const issues: CompileIssue[] = [];
  const seen = new Set<string>();
  const files = new FileStack();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === "") {
      i++;
      continue;
    }
    let issue: CompileIssue | null = null;
    let next = i + 1;
    let inPackage = false;
    const fileLine = parseFileLineError(line);
    const packageError = fileLine ? null : parsePackageFileError(line);
    if (fileLine) {
      const [more, consumed] = continuation(lines, next, false);
      next = consumed;
      issue = issueOf("error", fileLine[0], fileLine[1], fileLine[2] + more);
    } else if (packageError !== null) {
      const [more, consumed] = continuation(lines, next, false);
      next = consumed;
      inPackage = true;
      issue = issueOf("error", files.innermostProjectFile(), null, packageError + more);
    } else if (line.startsWith("!")) {
      const [more, consumed] = continuation(lines, next, false);
      next = consumed;
      issue = issueOf("error", null, null, line.slice(1).trim() + more);
    } else {
      const latexWarning = line.startsWith("LaTeX") && line.includes("Warning:");
      const packageWarning =
        (line.startsWith("Package ") || line.startsWith("Class ")) &&
        line.includes(" Warning:");
      if (latexWarning || packageWarning) {
        const [more, consumed] = continuation(lines, next, true);
        next = consumed;
        const message = (line + more).replace(/\.+$/, "");
        const lineNo = files.inPackageFile() ? null : warningLine(message);
        issue = issueOf("warning", files.currentProjectFile(), lineNo, message);
      }
    }
    if (issue) {
      if (issue.severity === "error") {
        const [detail, consumed] = detailFrom(lines, next);
        if (detail.length > 0) {
          if (issue.line === null && !inPackage) issue.line = contextLineNo(detail[0]);
          issue.detail = detail;
        }
        next = Math.max(consumed, next);
        issue.hint = errorHint(issue.message);
      }
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
      }
      for (const read of lines.slice(i, next)) files.read(read);
      i = next;
      continue;
    }
    files.read(line);
    i++;
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
      if (line.startsWith("---line ")) {
        const [num, file] = line.slice("---line ".length).split(" of file ", 2);
        const lineNo = /^\d+$/.test(num?.trim() ?? "") ? Number(num.trim()) : null;
        if (lineNo !== null && file !== undefined && i > 0) {
          const name = file.trim();
          reasons.push([
            lines[i - 1].trim(),
            name.startsWith("/") ? null : [name, lineNo],
          ]);
        }
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
  if (lower.includes("syntax error") || lower.includes("bibtex subsystem")) {
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

/** Whether an issue only repeats a bibliography failure ("Please (re)run Biber"). */
export function isRerunBibToolWarning(issue: CompileIssue): boolean {
  return issue.message.startsWith("Package biblatex Warning: Please (re)run");
}

/** A font fontspec cannot find is usually one on this computer, not on the server. */
export function addFontHints(issues: CompileIssue[]): void {
  for (const issue of issues) {
    if (!issue.hint && issue.message.includes("fontspec Error: The font")) {
      issue.hint =
        "Polemic's server has TeX Live's fonts, not the ones installed on this computer. Put the font file (.otf or .ttf) in the project and load it by file name, e.g. \\setmainfont{MyFont-Regular.otf}.";
    }
  }
}
