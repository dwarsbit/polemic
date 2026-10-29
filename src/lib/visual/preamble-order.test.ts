import { describe, expect, it } from "vitest";
import type { PreambleAttrs } from "./doc-types";
import { parseTex } from "./parse";
import { preambleText, serializeTex } from "./serialize";

function roundTrip(tex: string): { once: string; twice: string } {
  const once = serializeTex(parseTex(tex));
  return { once, twice: serializeTex(parseTex(once)) };
}

function wrap(preamble: string): string {
  return `${preamble}\n\n\\begin{document}\n\nBody.\n\n\\end{document}\n`;
}

function preambleOf(tex: string): PreambleAttrs {
  const pre = parseTex(tex).content[0];
  if (pre?.type !== "preamble") throw new Error("no preamble");
  return pre.attrs;
}

describe("preamble order", () => {
  const cases: [string, string][] = [
    [
      "\\PassOptionsToPackage before its package",
      "\\documentclass{article}\n\\PassOptionsToPackage{hyphens}{url}\n\\usepackage{hyperref}",
    ],
    [
      "a driver \\def before its package",
      "\\documentclass{article}\n\\def\\pgfsysdriver{pgfsys-dvipdfmx.def}\n\\usepackage{tikz}",
    ],
    [
      "a package inside \\makeatletter … \\makeatother",
      "\\documentclass{article}\n\\usepackage{amsmath}\n\\makeatletter\n\\def\\@x{1}\n\\usepackage{etoolbox}\n\\makeatother\n\\usepackage{graphicx}",
    ],
    [
      "packages inside \\if … \\fi",
      "\\documentclass{article}\n\\ifdefined\\HCode\n\\usepackage{a}\n\\else\n\\usepackage{b}\n\\fi",
    ],
    [
      "title metadata before the packages",
      "\\documentclass{article}\n\\title{T}\n\\author{A}\n\\usepackage{amsmath}\n% tail comment\n\\date{D}",
    ],
  ];

  for (const [name, preamble] of cases) {
    it(`keeps ${name} in place`, () => {
      const tex = wrap(preamble);
      const { once, twice } = roundTrip(tex);
      expect(once).toBe(tex);
      expect(twice).toBe(once);
    });
  }

  it("appends a new package after the last \\usepackage", () => {
    const attrs = preambleOf(
      wrap(
        "\\documentclass{article}\n\\usepackage{amsmath}\n\\newcommand{\\R}{\\mathbb{R}}",
      ),
    );
    const next = {
      ...attrs,
      packagesSrc: `${attrs.packagesSrc}\n\\usepackage{amsthm}`,
    };
    expect(preambleText(next)).toBe(
      "\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{amsthm}\n\\newcommand{\\R}{\\mathbb{R}}\n\n",
    );
  });

  it("puts the first package after the document class", () => {
    const attrs = preambleOf(wrap("\\documentclass{article}\n\\newcommand{\\R}{x}"));
    const next = { ...attrs, packagesSrc: "\\usepackage{amsthm}" };
    expect(preambleText(next)).toBe(
      "\\documentclass{article}\n\\usepackage{amsthm}\n\\newcommand{\\R}{x}\n\n",
    );
  });

  it("keeps the order when the raw rest grows", () => {
    const attrs = preambleOf(
      wrap(
        "\\documentclass{article}\n\\title{T}\n\\usepackage{amsmath}\n\\newcommand{\\R}{x}",
      ),
    );
    // As addNewtheorem appends it.
    const next = {
      ...attrs,
      src: `${attrs.src.replace(/\s+$/, "")}\n\\newtheorem{lemma}{Lemma}`,
    };
    expect(preambleText(next)).toBe(
      "\\documentclass{article}\n\\title{T}\n\\usepackage{amsmath}\n\\newcommand{\\R}{x}\n\\newtheorem{lemma}{Lemma}\n\n",
    );
  });

  it("drops a removed command with its line, and adds a new one", () => {
    const attrs = preambleOf(
      wrap("\\documentclass{article}\n\\title{T}\n\\usepackage{amsmath}\n\\author{A}"),
    );
    const next = { ...attrs, titleSrc: null, dateSrc: "\\date{D}" };
    expect(preambleText(next)).toBe(
      "\\documentclass{article}\n\\usepackage{amsmath}\n\\author{A}\n\\date{D}\n\n",
    );
  });
});

describe("fragment files", () => {
  const fragments: [string, string][] = [
    ["a group spanning lines", "\\emph{a\nb} tail\n"],
    ["display math", "\\[\nx\n\\]\nText\n"],
    ["a comment inside a group", "\\textbf{bold % c\n rest}\n"],
    ["leading preamble-like commands", "\\newcommand{\\x}{1}\n\\emph{a\nb} tail\n"],
  ];
  for (const [name, tex] of fragments) {
    it(`does not split ${name}`, () => {
      const once = serializeTex(parseTex(tex));
      expect(parseTex(tex).content.some((b) => b.type === "preamble")).toBe(false);
      expect(once).not.toContain("\\}");
      // No paragraph break inside a group or display math.
      expect(once).not.toMatch(/\{[^}]*\n\s*\n[^{]*\}/);
      expect(once).not.toMatch(/\\\[[^]*?\n\s*\n[^]*?\\\]/);
      expect(serializeTex(parseTex(once))).toBe(once);
    });
  }

  it("still splits a recovered preamble from a multi-line body construct", () => {
    const tex = "\\documentclass{article}\n\\usepackage{amsmath}\n\n\\[\nx\n\\]\n";
    const doc = parseTex(tex);
    expect(doc.content[0]?.type).toBe("preamble");
    const { once } = roundTrip(tex);
    expect(once).not.toMatch(/\\\[\s*\n\s*\n/);
  });
});
