import { describe, expect, it } from "vitest";
import { explainIssue } from "@/lib/explain-issue";
import type { CompileIssue } from "@/lib/tauri";

function issue(message: string, extra: Partial<CompileIssue> = {}): CompileIssue {
  return {
    severity: "error",
    file: "main.tex",
    line: 1,
    message,
    detail: [],
    ...extra,
  };
}

const explain = (message: string, extra: Partial<CompileIssue> = {}, cloud = false) =>
  explainIssue(issue(message, extra), { cloud });

const title = (message: string, extra: Partial<CompileIssue> = {}) =>
  explain(message, extra)?.title ?? null;

describe("explainIssue", () => {
  it("names the unknown command from the source line", () => {
    const explanation = explain("Undefined control sequence.", {
      detail: ["l.12 \\frrac", "     {a}{b}"],
    })!;
    expect(explanation.title).toBe("Unknown command \\frrac");
    expect(explanation.help).toContain("spelling");
  });

  it("names the command TeX was expanding, not the one on the line", () => {
    // \mycmd is defined; the command inside it is not.
    expect(
      title("Undefined control sequence.", {
        detail: ["l.7 \\mycmd"],
        reading: "\\mycmd ->\\undefinedthing",
      }),
    ).toBe("Unknown command \\undefinedthing");
    expect(
      title("Undefined control sequence.", {
        detail: ["l.7 \\section{\\foo bar}"],
        reading: "<argument> \\foo",
      }),
    ).toBe("Unknown command \\foo");
  });

  it("names no command when the context shows none", () => {
    expect(
      title("Undefined control sequence.", {
        detail: ["l.7 x"],
        reading: "<to be read again>",
      }),
    ).toBe("Unknown command");
    expect(title("Undefined control sequence.")).toBe("Unknown command");
  });

  it("tells a missing package, class, image and file apart", () => {
    expect(title("LaTeX Error: File `siunitx.sty' not found.")).toBe(
      "Package siunitx not found",
    );
    expect(title("LaTeX Error: File `thesis.cls' not found.")).toBe(
      "Class thesis not found",
    );
    expect(title("LaTeX Error: File `fig/plot.png' not found.")).toBe(
      "Image fig/plot.png not found",
    );
    expect(
      title(
        "Package pdftex.def Error: File `fig/plot' not found: using draft setting.",
      ),
    ).toBe("Image fig/plot not found");
    expect(title("LaTeX Error: File `chapters/intro.tex' not found.")).toBe(
      "File chapters/intro.tex not found",
    );
  });

  it("fits the advice to where the compile ran", () => {
    const message = "LaTeX Error: File `siunitx.sty' not found.";
    expect(explain(message, {}, false)!.help).toContain("your TeX distribution");
    expect(explain(message, {}, true)!.help).toContain("TeX Live");
  });

  it("recognizes a document that needs another engine", () => {
    const either = "This document needs XeLaTeX or LuaLaTeX";
    expect(
      title(
        "Fatal Package fontspec Error: The fontspec package requires either XeTeX or LuaTeX.",
      ),
    ).toBe(either);
    expect(
      title(
        "Critical Package ctex Error: CTeX fontset `fandol' is unavailable in current mode.",
      ),
    ).toBe(either);
    expect(title("XeTeX is required to compile this document.")).toBe(
      "This document needs XeLaTeX",
    );
    expect(
      title("Package luatexja-core Error: This package requires Lua(HB)(La)TeX."),
    ).toBe("This document needs LuaLaTeX");
    // About a driver option, not about the engine to choose.
    expect(
      title(
        "Package hyperref Error: Wrong driver option `xetex', because XeTeX is not detected.",
      ),
    ).toBeNull();
  });

  it("offers the engines a document asks for", () => {
    const action = (message: string) => explain(message)?.action;
    expect(
      action(
        "Fatal Package fontspec Error: The fontspec package requires either XeTeX or LuaTeX.",
      ),
    ).toEqual({ kind: "engine", engines: ["xelatex", "lualatex"] });
    expect(action("XeTeX is required to compile this document.")).toEqual({
      kind: "engine",
      engines: ["xelatex"],
    });
    expect(
      action("Package luatexja-core Error: This package requires Lua(HB)(La)TeX."),
    ).toEqual({ kind: "engine", engines: ["lualatex"] });
    expect(
      action(
        "LaTeX Error: Unicode character 。 (U+3002) not set up for use with LaTeX.",
      ),
    ).toEqual({ kind: "engine", engines: ["xelatex", "lualatex"] });
    // A space that got pasted in is to be replaced, whatever the engine.
    expect(
      action(
        "LaTeX Error: Unicode character \u00a0 (U+00A0) not set up for use with LaTeX.",
      ),
    ).toBeUndefined();
  });

  it("offers to look up a package or class, not a file of the project", () => {
    expect(explain("LaTeX Error: File `siunitx.sty' not found.")?.action).toEqual({
      kind: "ctan",
      name: "siunitx",
    });
    expect(explain("LaTeX Error: File `thesis.cls' not found.")?.action).toEqual({
      kind: "ctan",
      name: "thesis",
    });
    expect(
      explain("LaTeX Error: File `chapters/intro.tex' not found.")?.action,
    ).toBeUndefined();
  });

  it("names a font that can't be found, not the engine", () => {
    expect(
      title(
        'Package fontspec Error: The font "Comic Neue" cannot be found; this may be but usually is not a fontspec bug. Either there is a typo in the font name/file, the font is not installed (correctly), or there is a bug in the underlying font loading engine (XeTeX/luaotfload).',
      ),
    ).toBe("The font Comic Neue can't be found");
  });

  it("names characters pdfLaTeX can't print", () => {
    expect(
      title(
        "LaTeX Error: Unicode character 。 (U+3002) not set up for use with LaTeX.",
      ),
    ).toBe("pdfLaTeX can't print 。 (U+3002)");
    const space = explain(
      "LaTeX Error: Unicode character   (U+00A0) not set up for use with LaTeX.",
    )!;
    expect(space.title).toBe("pdfLaTeX can't print a non-breaking space (U+00A0)");
    expect(space.help).toContain("~");
  });

  it("leaves internal command names out of titles", () => {
    expect(title("Paragraph ended before \\textbf was complete.")).toBe(
      "The argument of \\textbf is never closed",
    );
    expect(title("Paragraph ended before \\HyPsd@GetTwoBytes was complete.")).toBe(
      "An argument is never closed",
    );
    expect(
      title(
        "LaTeX Error: Command \\c@lemma already defined. Or name \\end... illegal, see p.192 of the manual.",
      ),
    ).toBe("The counter lemma is defined twice");
  });

  it("explains the common errors", () => {
    const cases: [string, string][] = [
      ["Missing $ inserted.", "Math used outside math mode"],
      ["Extra }, or forgotten $.", "A } too many, or a missing $"],
      ["Too many }'s.", "A } without a matching {"],
      ["Missing number, treated as zero.", "A number is missing"],
      ["Illegal unit of measure (pt inserted).", "A length has no unit"],
      ["Extra alignment tab has been changed to \\cr.", "Too many & in a table row"],
      ["Misplaced alignment tab character &.", "& used outside a table"],
      ["LaTeX Error: Missing \\begin{document}.", "Text before \\begin{document}"],
      ["LaTeX Error: Environment algin undefined.", "Unknown environment algin"],
      [
        "LaTeX Error: \\begin{itemize} on input line 3 ended by \\end{enumerate}.",
        "\\begin{itemize} is closed by \\end{enumerate}",
      ],
      ["LaTeX Error: Command \\vec already defined.", "\\vec is already defined"],
      [
        "LaTeX Error: Option clash for package xcolor.",
        "The package xcolor is loaded twice with different options",
      ],
      [
        "LaTeX Error: Unknown option `dvipsnamess' for package `xcolor'.",
        "The package xcolor has no option dvipsnamess",
      ],
      ["LaTeX Error: There's no line here to end.", "\\\\ with no line to end"],
      [
        "LaTeX Error: Something's wrong--perhaps a missing \\item.",
        "A list without \\item",
      ],
      [
        "Package pgfkeys Error: I do not know the key '/tikz/roundd corners' and I am going to ignore it. Perhaps you misspelled it.",
        "Unknown option roundd corners",
      ],
      [
        "Emergency stop (job aborted, no legal \\end found).",
        "The document has no \\end{document}",
      ],
      [
        "Package minted Error: You must invoke LaTeX with the -shell-escape flag.",
        "This package needs shell escape",
      ],
    ];
    for (const [message, expected] of cases) expect(title(message)).toBe(expected);
  });

  it("explains the common warnings", () => {
    expect(
      title("LaTeX Warning: Reference `fig:plot' on page 3 undefined on input line 40"),
    ).toBe("No label fig:plot for this reference");
    expect(
      title("LaTeX Warning: Citation `smith2020' on page 1 undefined on input line 12"),
    ).toBe("No bibliography entry smith2020 for this citation");
    expect(
      title("Package natbib Warning: Citation `smith2020' undefined on input line 12"),
    ).toBe("No bibliography entry smith2020 for this citation");
    expect(
      title(
        "LaTeX Warning: Hyper reference `sec:intro' on page 2 undefined on input line 8",
      ),
    ).toBe("No label sec:intro for this reference");
    expect(
      title("LaTeX Warning: Float too large for page by 12.4pt on input line 9"),
    ).toBe("A figure or table is 12 pt too tall for the page");
  });

  it("leaves a warning about a skipped feature in its own words", () => {
    const warning = { severity: "warning" as const };
    expect(
      title(
        "Package tikz-feynman Warning: The key you tried to use '/graph drawing/node distance' requires LuaTeX. It will be ignored. on input line 12",
        warning,
      ),
    ).toBeNull();
    expect(
      title(
        "Package ifplatform Warning: shell escape is disabled, so I can only detect \\ifwindows",
        warning,
      ),
    ).toBeNull();
  });

  it("says which section of the guide covers an issue", () => {
    const topic = (message: string) => explain(message)?.topic;
    expect(topic("Undefined control sequence.")).toBe("commands");
    expect(topic("LaTeX Error: File `a.sty' not found.")).toBe("files");
    expect(topic("XeTeX is required to compile this document.")).toBe(
      "engine-and-fonts",
    );
    expect(topic("Missing $ inserted.")).toBe("math");
    expect(topic("Too many }'s.")).toBe("braces");
    expect(topic("Misplaced alignment tab character &.")).toBe("tables-and-lists");
    expect(topic("LaTeX Error: Too many unprocessed floats.")).toBe("floats");
    expect(topic("LaTeX Error: Option clash for package xcolor.")).toBe("packages");
    expect(
      explain("LaTeX Warning: Label `a' multiply defined", { severity: "warning" })
        ?.topic,
    ).toBe("warnings");
  });

  it("keeps TeX's message for what the catalog doesn't cover", () => {
    expect(explain("BibTeX failed: Repeated entry")).toBeNull();
    expect(
      explain("Package caption Error: Undefined justification `centre'."),
    ).toBeNull();
  });

  it("writes titles as labels and help as sentences", () => {
    const messages = [
      "Undefined control sequence.",
      "Missing $ inserted.",
      "LaTeX Error: File `a.sty' not found.",
      "LaTeX Error: Missing \\begin{document}.",
      "Dimension too large.",
      "Double superscript.",
    ];
    for (const message of messages) {
      const explanation = explain(message)!;
      expect(explanation.title).not.toMatch(/\.$/);
      expect(explanation.help).toMatch(/\.$/);
    }
  });
});
