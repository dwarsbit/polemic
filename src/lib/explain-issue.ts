/**
 * Compile issues in plain words. TeX's messages are terse and written
 * for someone at a terminal ("Undefined control sequence."); this
 * catalog gives the common ones a title with the specifics ("Unknown
 * command \frrac") and a line on what to do. Issues outside the catalog
 * keep TeX's message. It runs on issues from either log reader (the
 * desktop app's and the browser's), so the wording lives in one place.
 */

import type { CompileIssue } from "@/lib/tauri";

export interface Explanation {
  /** The issue in plain words, with its specifics. A label: no full stop. */
  title: string;
  /** What it means and what to do about it. */
  help: string;
  /**
   * What several issues of this kind are called after their number:
   * "citations without a bibliography entry". Issues that share it
   * can be listed as one.
   */
  many?: string;
}

export interface ExplainContext {
  /** The compile ran on Polemic's server, not on this computer. */
  cloud: boolean;
}

type Rule = (
  message: string,
  issue: CompileIssue,
  ctx: ExplainContext,
) => Explanation | null;

/** A rule for messages that match `pattern`. */
function on(
  pattern: RegExp,
  explain: (
    match: RegExpExecArray,
    issue: CompileIssue,
    ctx: ExplainContext,
  ) => Explanation | null,
): Rule {
  return (message, issue, ctx) => {
    const match = pattern.exec(message);
    return match ? explain(match, issue, ctx) : null;
  };
}

/**
 * The command TeX stopped at: the last token of what it was reading
 * (`<argument> \foo`, `\mycmd ->\frrac`) or, at the top level, of the
 * source line up to the error (`l.12 \frrac`).
 */
function stoppedAtCommand(issue: CompileIssue): string | null {
  const source = issue.reading ?? issue.detail[0]?.replace(/^l\.\d+ ?/, "") ?? "";
  const match = /\\([A-Za-z@_:]+|[^A-Za-z\s])\s*$/.exec(source);
  return match ? `\\${match[1]}` : null;
}

/** A command of a class's or package's own, which the reader never typed. */
const isInternal = (command: string) => /[@_:]/.test(command);

const ENGINE_HELP =
  "A package or class it loads doesn't work with the current TeX engine. Choose another one under TeX engine in Document settings.";

/** The engine a message asks for, as it reads in a title. */
function engineAskedFor(message: string): string | null {
  const xe = /Xe(La)?TeX/i.test(message);
  const lua = /Lua(\(HB\)|HB)?(\(La\)|La)?TeX/i.test(message);
  if (!xe && !lua) return null;
  // A message that also names pdfTeX may be about what works there.
  if (/pdf(La)?TeX/i.test(message) && !/cannot be run with pdftex/i.test(message)) {
    return null;
  }
  const asks =
    /\brequires?\b|\bis required\b|\bneeds?\b|\bmust\b|\bonly\b|\bplease use\b|\bprecisa\b|cannot be run with pdftex/i.test(
      message,
    );
  if (!asks) return null;
  if (xe && lua) return "XeLaTeX or LuaLaTeX";
  return xe ? "XeLaTeX" : "LuaLaTeX";
}

const BOOKMARK_HELP =
  "Math or a command in a heading is left out of the bookmark. Give a plain version with \\texorpdfstring{…}{plain text}.";
const BOOKMARK_MANY = "parts of headings that PDF bookmarks can't show";

/** Characters that show as nothing, and what to do about each. */
const INVISIBLE: Record<string, [string, string]> = {
  "00A0": [
    "a non-breaking space",
    "Replace it with ~ or a normal space. It often comes along when you paste text.",
  ],
  "200B": [
    "a zero-width space",
    "Delete it. It is invisible and often comes along when you paste text.",
  ],
  "202F": [
    "a narrow non-breaking space",
    "Replace it with \\, or a normal space. It often comes along when you paste text.",
  ],
  "2009": [
    "a thin space",
    "Replace it with \\, or a normal space. It often comes along when you paste text.",
  ],
};

const IMAGE = /\.(png|jpe?g|pdf|eps|svg|gif|bmp|tiff?)$/i;

function missingFile(file: string, image: boolean, ctx: ExplainContext): Explanation {
  const kind = /\.sty$/i.test(file) ? "Package" : /\.cls$/i.test(file) ? "Class" : null;
  if (kind) {
    const name = file.replace(/\.(sty|cls)$/i, "");
    return {
      title: `${kind} ${name} not found`,
      help: ctx.cloud
        ? "It isn't in the project or in TeX Live. Check the name, or add its files to the project."
        : "It isn't in the project or in your TeX distribution. Check the name, or install it with your TeX distribution.",
    };
  }
  if (image || IMAGE.test(file)) {
    return {
      title: `Image ${file} not found`,
      help: "Check the path and the file name, including capitals.",
    };
  }
  return {
    title: `File ${file} not found`,
    help: "Check the path and the file name, including capitals.",
  };
}

const RULES: Rule[] = [
  // --- Commands and environments -----------------------------------------
  on(/^Undefined control sequence\.$/, (_, issue) => {
    const command = stoppedAtCommand(issue);
    return {
      title: command ? `Unknown command ${command}` : "Unknown command",
      help: command?.includes("@")
        ? "It is an internal command of a class or package. Check that the package it belongs to is loaded."
        : "Check the spelling. If a package defines it, load that package in the preamble.",
    };
  }),
  on(/^LaTeX Error: Environment (\S+) undefined\./, (m) => ({
    title: `Unknown environment ${m[1]}`,
    help: "Check the spelling. If a package defines it, load that package in the preamble.",
  })),
  on(
    /^LaTeX Error: \\begin\{(\S+?)\} on input line (\d+) ended by \\end\{(\S+?)\}/,
    (m) => ({
      title: `\\begin{${m[1]}} is closed by \\end{${m[3]}}`,
      help: `The environment opened on line ${m[2]} is closed by the wrong \\end, or an environment inside it is still open.`,
    }),
  ),
  on(/^LaTeX Error: Command (\\\S+) already defined\./, (m) => {
    const counter = /^\\c@(.+)$/.exec(m[1]);
    if (counter) {
      return {
        title: `The counter ${counter[1]} is defined twice`,
        help: "Two \\newtheorem or \\newcounter lines use this name, or a package already defines it. Remove one, or pick another name.",
      };
    }
    return {
      title: `${m[1]} is already defined`,
      help: isInternal(m[1])
        ? "It is an internal command of a class or package, so two packages probably clash. Check the packages loaded around this line."
        : "A package or an earlier \\newcommand defines it. Use \\renewcommand to replace it, or pick another name.",
    };
  }),
  on(/^LaTeX Error: Command (\\\S+) undefined\./, (m) => ({
    title: `${m[1]} isn't defined yet`,
    help: "\\renewcommand changes a command that exists. Use \\newcommand to define a new one.",
  })),
  on(/^LaTeX Error: Can be used only in preamble\./, () => ({
    title: "This command belongs in the preamble",
    help: "Move it before \\begin{document}. \\usepackage and similar setup commands go there.",
  })),
  on(/^LaTeX Error: Missing \\begin\{document\}\./, () => ({
    title: "Text before \\begin{document}",
    help: "Something in the preamble prints text, often a stray character or a misspelled command. If this file is only a part of the document, set the right file as main file.",
  })),
  on(/^LaTeX Error: Two \\documentclass or \\documentstyle commands\./, () => ({
    title: "\\documentclass appears twice",
    help: "A file you \\input or \\include has its own \\documentclass. Remove it there, or load that file with the subfiles package.",
  })),
  on(/^LaTeX Error: Loading a class or package in a group\./, () => ({
    title: "A package is loaded inside a group",
    help: "\\usepackage and \\documentclass can't sit inside braces or an environment. Move them to the top level of the preamble.",
  })),
  on(/^LaTeX Error: No counter '([^']+)' defined\./, (m) => ({
    title: `No counter ${m[1]}`,
    help: "Check the name, or define the counter with \\newcounter.",
  })),
  on(/^LaTeX Error: Counter too large\./, () => ({
    title: "A counter is too large to print",
    help: "Letters stop at 26 and footnote symbols at 9. Number this counter with \\arabic instead, or reset it sooner.",
  })),
  on(/^Emergency stop \(job aborted, no legal \\end found\)/, () => ({
    title: "The document has no \\end{document}",
    help: "TeX reached the end of the main file without it. Add it, or set the right file as main file if this one is only a part of the document.",
  })),

  // --- Files ---------------------------------------------------------------
  on(
    /^Package (?:pdftex|luatex|xetex|dvipdfmx)\.def Error: File [`']([^`']+)' not found/,
    (m, _, ctx) => missingFile(m[1], true, ctx),
  ),
  on(/^Unable to load picture or PDF file [`']([^`']+)'\./, (m, _, ctx) =>
    missingFile(m[1], true, ctx),
  ),
  on(/^Package svg Error: File [`']([^`']+)' is missing\./, (m, _, ctx) =>
    missingFile(m[1], true, ctx),
  ),
  on(/^LaTeX Error: File [`']([^`']+)' not found\./, (m, _, ctx) =>
    missingFile(m[1], false, ctx),
  ),
  on(/^I can't find file [`']([^`']+)'\./, (m, _, ctx) =>
    missingFile(m[1], false, ctx),
  ),
  on(/^LaTeX Error: Unknown graphics extension: (\.\S+?)\.$/, (m) => ({
    title: `Images of type ${m[1]} aren't supported`,
    help: "Use a PDF, PNG or JPG file instead.",
  })),
  on(/^I can't write on file [`']([^`']+)'\./, (m) => ({
    title: `TeX can't write the file ${m[1]}`,
    help: "A compile only writes inside the project's build folder. A package that writes somewhere else, or to a folder that doesn't exist, stops here.",
  })),

  // --- Engine and fonts ----------------------------------------------------
  on(/fontspec Error: The font "([^"]+)" cannot be found/, (m, _, ctx) => ({
    title: `The font ${m[1]} can't be found`,
    help: ctx.cloud
      ? "Polemic's server has TeX Live's fonts, not the ones installed on this computer. Put the font file in the project and load it by file name."
      : "It isn't installed on this computer. Check the name, or put the font file in the project and load it by file name.",
  })),
  on(/CTeX fontset [`'][^`']+' is unavailable in current mode/, () => ({
    title: "This document needs XeLaTeX or LuaLaTeX",
    help: ENGINE_HELP,
  })),
  on(/^LaTeX Error: Unicode character (.+?) \(U\+([0-9A-F]+)\)/, (m) => {
    const invisible = INVISIBLE[m[2]];
    if (invisible) {
      return {
        title: `pdfLaTeX can't print ${invisible[0]} (U+${m[2]})`,
        help: invisible[1],
      };
    }
    return {
      title: `pdfLaTeX can't print ${m[1]} (U+${m[2]})`,
      help: "Compile with XeLaTeX or LuaLaTeX (TeX engine in Document settings), or replace the character with a LaTeX command.",
    };
  }),
  on(/Invalid UTF-8 byte/, () => ({
    title: "The file isn't saved as UTF-8",
    help: "It has characters in another encoding, such as Latin-1. Save the file as UTF-8.",
  })),
  on(/^LaTeX Error: Command (\\\S+) unavailable in encoding (\S+?)\./, (m) => ({
    title: `${m[1]} isn't available in the font encoding ${m[2]}`,
    help: "The font encoding in use has no such character. For text in another script, load its font encoding, or compile with XeLaTeX or LuaLaTeX.",
  })),
  on(
    /^Font \S+?="([^":]+)[^"]*" at [\d.]+pt not loadable: Metric \(TFM\) file or installed font not found/,
    (m, _, ctx) => ({
      title: `The font ${m[1]} can't be found`,
      help: ctx.cloud
        ? "Polemic's server has TeX Live's fonts, not the ones installed on this computer. Put the font file in the project and load it by file name."
        : "It isn't installed on this computer. Check the name, or put the font file in the project and load it by file name.",
    }),
  ),
  on(/^LaTeX Error: This file needs format [`'](\S+?)'/, (m) => ({
    title: `This class is written for ${m[1].replace(/2e$/, "")}`,
    help: "Polemic compiles with pdfLaTeX, XeLaTeX or LuaLaTeX. Use a class made for one of them.",
  })),
  // As errors only: a warning that names shell escape or an engine is
  // about one feature that was skipped, and says so itself.
  on(/shell[- ]escape/i, (_, issue) =>
    issue.severity === "error"
      ? {
          title: "This package needs shell escape",
          help: "Polemic compiles without shell escape, so packages that run other programs (minted, the TikZ externalization library) don't work. The listings package highlights code without it.",
        }
      : null,
  ),
  (message, issue) => {
    const engine = issue.severity === "error" ? engineAskedFor(message) : null;
    return engine
      ? { title: `This document needs ${engine}`, help: ENGINE_HELP }
      : null;
  },

  // --- Math ----------------------------------------------------------------
  on(/^Missing \$ inserted\.$/, () => ({
    title: "Math used outside math mode",
    help: "A character such as _ or ^, or a math command, appears in text. Put the math between $…$, or write \\_ for a literal underscore. A blank line inside math also causes this.",
  })),
  on(/^Extra \}, or forgotten \$\.$/, () => ({
    title: "A } too many, or a missing $",
    help: "Check that the braces on this line pair up and that math opened with $ is also closed with $.",
  })),
  on(/^Extra \}, or forgotten \\endgroup\.$/, () => ({
    title: "A } too many, or an environment that isn't closed",
    help: "Check that the braces on this line pair up and that every \\begin before it has its \\end.",
  })),
  on(/^Limit controls must follow a math operator\.$/, () => ({
    title: "\\limits after something that isn't a math operator",
    help: "\\limits and \\nolimits only work right after an operator such as \\sum or \\int. Define your own operator with \\DeclareMathOperator*.",
  })),
  on(/^Display math should end with \$\$\.$/, () => ({
    title: "Display math isn't closed",
    help: "Math opened with $$ or \\[ needs its closing $$ or \\] before the text goes on.",
  })),
  on(/^LaTeX Error: Bad math environment delimiter\./, () => ({
    title: "Math delimiters don't pair up",
    help: "\\[ needs \\], and \\( needs \\). One of them is missing, or sits inside other math.",
  })),
  on(/^Double (superscript|subscript)\.$/, (m) => ({
    title: `Two ${m[1]}s in a row`,
    help:
      m[1] === "superscript"
        ? "Group them with braces: x^{a^b} or {x^a}^b."
        : "Group them with braces: x_{a_b} or {x_a}_b.",
  })),
  on(/^Missing \\right\. inserted\.$/, () => ({
    title: "\\left without a matching \\right",
    help: "Each \\left needs a \\right in the same formula and on the same line of an aligned equation. Use \\right. for an invisible one.",
  })),
  on(/^Extra \\right\.$/, () => ({
    title: "\\right without a matching \\left",
    help: "Each \\right needs a \\left before it in the same formula. Use \\left. for an invisible one.",
  })),
  on(/^LaTeX Error: (\\\S+) allowed only in math mode\./, (m) => ({
    title: `${m[1]} only works in math mode`,
    help: "Put it between $…$ or inside an equation.",
  })),
  on(/^LaTeX Error: Command (\\\S+) invalid in math mode\./, (m) => ({
    title: `${m[1]} doesn't work in math mode`,
    help: "For text inside math, use \\text{…} from amsmath or \\mathrm{…}.",
  })),

  // --- Braces and arguments ------------------------------------------------
  on(/^Too many \}'s\.$/, () => ({
    title: "A } without a matching {",
    help: "Remove the extra }, or add the { it should close.",
  })),
  on(/^Missing ([{}]) inserted\.$/, (m) => ({
    title: `A ${m[1]} is missing`,
    help: "TeX expected it here. Check that the braces before this point pair up.",
  })),
  on(/^Paragraph ended before (\\\S+) was complete\.$/, (m) =>
    isInternal(m[1])
      ? {
          title: "An argument is never closed",
          help: "A { on or before this line has no matching }, or there is a blank line inside an argument.",
        }
      : {
          title: `The argument of ${m[1]} is never closed`,
          help: `A { after ${m[1]} has no matching }, or there is a blank line inside its argument.`,
        },
  ),
  on(/^File ended while scanning (?:use|definition|text) of (\\\S+)\.$/, (m) =>
    isInternal(m[1])
      ? { title: "The file ends inside an argument", help: "A { is never closed." }
      : {
          title: `The file ends inside ${m[1]}`,
          help: `A { after ${m[1]} is never closed.`,
        },
  ),
  on(/^Argument of (\\\S+) has an extra \}\.$/, (m) => ({
    title: isInternal(m[1])
      ? "A } too many in an argument"
      : `A } too many in the argument of ${m[1]}`,
    help: "Check the braces on this line. A command inside a caption or heading can also cause this: put \\protect before it.",
  })),
  on(/^Use of (\\\S+) doesn't match its definition\.$/, (m) => ({
    title: isInternal(m[1])
      ? "A command is used in a way its definition doesn't allow"
      : `${m[1]} is used in a way its definition doesn't allow`,
    help: "Check the arguments on this line. A command inside a caption or heading can also cause this: put \\protect before it.",
  })),
  on(/^Missing \\endcsname inserted\.$/, () => ({
    title: "A command where a name is expected",
    help: "Names of labels, citations, counters and environments can't contain commands. Check the argument on this line.",
  })),
  on(/^Missing number, treated as zero\.$/, () => ({
    title: "A number is missing",
    help: "A command on this line expects a number or a length, as in \\vspace{1cm}. Text in square brackets right after \\\\ is also read as a length.",
  })),
  on(/^Illegal unit of measure \(pt inserted\)\.$/, () => ({
    title: "A length has no unit",
    help: "Lengths need a unit such as pt, cm or em: \\vspace{1cm}, not \\vspace{1}.",
  })),
  on(/^Dimension too large\.$/, () => ({
    title: "A length is too large for TeX",
    help: "TeX can't work with lengths over about 5.7 m. A plot with very large coordinates or an image scaled without limits often causes this.",
  })),
  on(/^TeX capacity exceeded, sorry \[([^\]=]+)/, (m) => ({
    title: "TeX ran out of memory",
    help: `It filled its ${m[1].trim()}. This is usually a command that calls itself without end: check recent \\newcommand definitions.`,
  })),
  on(/^You can't use [`']macro parameter character #' in/, () => ({
    title: "# used in text",
    help: "Write \\# for a literal #.",
  })),

  // --- Tables and lists ----------------------------------------------------
  on(/^Extra alignment tab has been changed to \\cr\.$/, () => ({
    title: "Too many & in a table row",
    help: "This row has more columns than the table declares. Add a column to the column specification, or remove an &.",
  })),
  on(/^Misplaced alignment tab character &\.$/, () => ({
    title: "& used outside a table",
    help: "Write \\& for a literal ampersand. Inside a table or aligned math, check that the environment is open.",
  })),
  on(/^Misplaced \\noalign\.$/, () => ({
    title: "A table rule in the wrong place",
    help: "\\hline, \\toprule and similar rules go at the start of a row, right after \\\\.",
  })),
  on(/^LaTeX Error: (?:Illegal character|Missing p-arg) in array arg\./, () => ({
    title: "The column specification of a table is wrong",
    help: "Check the {…} after \\begin{tabular}: it takes letters such as l, c and r, and p{width}.",
  })),
  on(/^LaTeX Error: There's no line here to end\./, () => ({
    title: "\\\\ with no line to end",
    help: "\\\\ can't start a paragraph or follow a blank line. Remove it, or use \\vspace for extra space.",
  })),
  on(/^LaTeX Error: Something's wrong--perhaps a missing \\item\./, () => ({
    title: "A list without \\item",
    help: "Text in itemize, enumerate or description needs \\item before it. An empty bibliography also causes this.",
  })),
  on(/^LaTeX Error: Lonely \\item--perhaps a missing list environment\./, () => ({
    title: "\\item outside a list",
    help: "Put it inside itemize, enumerate or description.",
  })),
  on(/^LaTeX Error: \\verb ended by end of line\./, () => ({
    title: "\\verb isn't closed on its line",
    help: "\\verb needs the same character at both ends, on one line: \\verb|text|.",
  })),

  // --- Floats --------------------------------------------------------------
  on(/^LaTeX Error: Unknown float option [`']H'\./, () => ({
    title: "The float option H needs the float package",
    help: "Add \\usepackage{float} to the preamble, or use [htbp].",
  })),
  on(/^LaTeX Error: Not in outer par mode\./, () => ({
    title: "A figure or table inside a box",
    help: "figure and table can't go inside a minipage, a \\parbox or another figure or table.",
  })),
  on(/^LaTeX Error: Too many unprocessed floats\./, () => ({
    title: "Too many figures are waiting for a place",
    help: "Add \\clearpage to place the figures and tables so far, or loosen their placement with [htbp].",
  })),

  // --- Package options -----------------------------------------------------
  on(/^LaTeX Error: Option clash for package (\S+?)\./, (m) => ({
    title: `The package ${m[1]} is loaded twice with different options`,
    help: "Give all options the first time it is loaded. If the class loads it, pass them with \\PassOptionsToPackage before \\documentclass.",
  })),
  on(
    /^LaTeX Error: Unknown option [`']([^`']+)' for package [`']?([^`'.\s]+)/,
    (m) => ({
      title: `The package ${m[2]} has no option ${m[1]}`,
      help: "Check the spelling of the option in \\usepackage.",
    }),
  ),
  on(/^Package babel Error: Unknown option [`']([^`']+)'/, (m) => ({
    title: `babel doesn't know the language ${m[1]}`,
    help: "Check the language name in the babel options. Some old names were replaced, such as frenchb by french.",
  })),
  on(/^Package xcolor Error: Undefined color [`']([^`']+)'/, (m) => ({
    title: `Unknown color ${m[1]}`,
    help: "Define it with \\definecolor, or load xcolor with an option that provides it, such as dvipsnames.",
  })),
  on(/^Package pgfkeys Error: I do not know the key '([^']+)'/, (m) => ({
    title: `Unknown option ${m[1].replace(/^\/(tikz|pgf|pgfplots)\//, "")}`,
    help: "Check the spelling. Some TikZ options need a library: load it with \\usetikzlibrary.",
  })),
  on(
    /^Package tikz Error: Giving up on this path\. Did you forget a semicolon\?/,
    () => ({
      title: "A TikZ path isn't finished",
      help: "Each \\draw, \\node and \\path ends with a semicolon. Check the one on this line, and the syntax before it.",
    }),
  ),
  on(/^Package keyval Error: (\S+) undefined\./, (m) => ({
    title: `Unknown option ${m[1]}`,
    help: "The command or package on this line has no option with this name. Check the spelling.",
  })),
  on(
    /^Package natbib Error: Bibliography not compatible with author-year citations\./,
    () => ({
      title: "The bibliography style doesn't support author-year citations",
      help: "Use a style made for natbib, such as plainnat, or load natbib with the numbers option.",
    }),
  ),

  // --- Warnings ------------------------------------------------------------
  on(
    /^LaTeX Warning: (?:Hyper r|R)eference [`']([^`']+)' on page \d+ undefined/,
    (m) => ({
      title: `No label ${m[1]} for this reference`,
      help: "Check the spelling, or add \\label{…} where the reference should point.",
      many: "references without a label",
    }),
  ),
  on(
    /^(?:LaTeX|Package natbib) Warning: Citation [`']([^`']+)' (?:on page \d+ )?undefined/,
    (m) => ({
      title: `No bibliography entry ${m[1]} for this citation`,
      help: "Check the key, or add the entry to your .bib file.",
      many: "citations without a bibliography entry",
    }),
  ),
  on(/^LaTeX Warning: Label [`']([^`']+)' multiply defined/, (m) => ({
    title: `The label ${m[1]} is used more than once`,
    help: "References to it point at one of them only. Give each \\label its own name.",
    many: "labels used more than once",
  })),
  on(/^Package natbib Warning: Citation [`']([^`']+)' multiply defined/, (m) => ({
    title: `The citation key ${m[1]} is defined more than once`,
    help: "Two bibliography entries share this key. Rename one of them.",
    many: "citation keys defined more than once",
  })),
  on(
    /^Package glossaries\S* Warning: Glossary entry [`']([^`']+)' has not been defined/,
    (m) => ({
      title: `No glossary entry ${m[1]}`,
      help: "Check the label, or define the entry.",
      many: "glossary entries that aren't defined",
    }),
  ),
  on(/^LaTeX Warning: File [`']([^`']+)' not found/, (m, _, ctx) => ({
    ...missingFile(m[1], false, ctx),
    many: "files not found",
  })),
  on(/^LaTeX Warning: Float too large for page by ([\d.]+)pt/, (m) => ({
    title: `A figure or table is ${Math.round(Number(m[1]))} pt too tall for the page`,
    help: "Make it smaller, for example with a smaller height for \\includegraphics.",
    many: "figures or tables too tall for the page",
  })),
  on(/^LaTeX Warning: Marginpar on page \d+ moved/, () => ({
    title: "A margin note was moved",
    help: "It would overlap the one before it, so it sits lower than the text it belongs to.",
    many: "margin notes moved",
  })),
  on(/^LaTeX Font Warning: Font shape [`'][^`']+' undefined/, () => ({
    title: "A font variant is replaced by another",
    help: "The font has no such weight or shape, for example bold small caps, so the PDF uses the closest one it has.",
    many: "font variants replaced by another",
  })),
  on(
    /^LaTeX Font Warning: Font shape [`'][^`']+' in size <[\d.]+> not available/,
    () => ({
      title: "A font size is replaced by the closest one",
      help: "The font comes in fixed sizes only. For any size, load a scalable font, for example with \\usepackage{lmodern}.",
      many: "font sizes replaced by the closest one",
    }),
  ),
  on(
    /^Package xeCJK Warning: CJKfamily .* does not contain glyph [`'](.+?)' \((U\+[0-9A-F]+)\)/,
    (m) => ({
      title: `The font has no character ${m[1]} (${m[2]})`,
      help: "It is left out of the PDF. Use a font that has this character.",
      many: "characters missing from the font",
    }),
  ),
  on(/^Package hyperref Warning: Token not allowed in a PDF string/, () => ({
    title: "A heading has something PDF bookmarks can't show",
    help: BOOKMARK_HELP,
    many: BOOKMARK_MANY,
  })),
  on(
    /^Package hyperref Warning: Glyph not defined in PU encoding, removing [`'](.+?)'/,
    (m) => ({
      title: `PDF bookmarks can't show ${m[1]}`,
      help: BOOKMARK_HELP,
      many: BOOKMARK_MANY,
    }),
  ),
];

/** The issue in plain words, or null when TeX's message has to do. */
export function explainIssue(
  issue: CompileIssue,
  ctx: ExplainContext,
): Explanation | null {
  for (const rule of RULES) {
    const explanation = rule(issue.message, issue, ctx);
    if (explanation) return explanation;
  }
  return null;
}
