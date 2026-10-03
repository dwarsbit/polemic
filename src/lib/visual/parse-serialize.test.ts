import { describe, expect, it } from "vitest";
import { parseTex } from "./parse";
import { serializeTex } from "./serialize";

/** parse → serialize once and twice; the second pass must be stable. */
function roundTrip(tex: string): { once: string; twice: string; doc: ReturnType<typeof parseTex> } {
  const doc = parseTex(tex);
  const once = serializeTex(doc);
  const twice = serializeTex(parseTex(once));
  return { once, twice, doc };
}

const ARTICLE = `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{graphicx}
% a preamble comment
\\newcommand{\\foo}{bar}

\\begin{document}

\\section{Introduction}

Some \\textbf{bold} and \\emph{italic} and \\texttt{mono} text with a
citation \\cite[p.~3]{knuth1984} and a reference to \\ref{eq:euler},
plus inline math $e^{i\\pi} + 1 = 0$. \\label{para:intro}

\\subsection{Lists}

\\begin{itemize}
  \\item First point
  \\item Second point with math $x_i$
  \\begin{itemize}
    \\item Nested point
  \\end{itemize}
\\end{itemize}

\\begin{enumerate}
  \\item Step one % with a comment
  \\item Step two
\\end{enumerate}

\\section{Equations}

\\begin{equation}
  e^{i\\pi} + 1 = 0 \\label{eq:euler}
\\end{equation}

\\[
  \\int_0^1 x \\, dx = \\frac{1}{2}
\\]

\\section{Figures}

\\begin{figure}[t]
  \\centering
  \\includegraphics[width=0.5\\textwidth]{assets/plot.pdf}
  \\caption{A plot.}
  \\label{fig:plot}
\\end{figure}

\\section{Raw fallbacks}

\\begin{tikzpicture}
  \\draw (0,0) -- (1,1);
\\end{tikzpicture}

\\begin{verbatim}
keep   this   exactly
\\end{verbatim}

\\begin{theorem}[Euler]
Body of a theorem we do not model yet.
\\end{theorem}

A footnote\\footnote{with text} and \\LaTeX{} itself.

% A full-line comment
% spanning two lines

\\section*{Starred heading}

Final paragraph with a trailing comment. % note
\\end{document}
`;

describe("parseTex", () => {
  it("splits preamble, body, and postamble", () => {
    const doc = parseTex(ARTICLE);
    expect(doc.attrs?.wrapped).toBe(true);
    const first = doc.content[0];
    expect(first?.type).toBe("preamble");
    if (first?.type !== "preamble") return;
    expect(first.attrs.documentclassSrc).toBe("\\documentclass{article}");
    expect(first.attrs.packagesSrc).toBe(
      "\\usepackage{amsmath}\n\\usepackage{graphicx}",
    );
    // The remainder keeps comments and custom commands verbatim.
    expect(first.attrs.src).toContain("% a preamble comment");
    expect(first.attrs.src).toContain("\\newcommand{\\foo}{bar}");
    // Body and postamble split correctly.
    expect(doc.content.some((b) => b.type === "heading")).toBe(true);
    expect(doc.attrs?.postamble).toBe("\n");
  });

  it("models headings, marks, math, pills, and lists", () => {
    const doc = parseTex(ARTICLE);
    const types = JSON.stringify(doc);
    expect(doc.content.some((b) => b.type === "heading" && b.attrs.cmd === "section")).toBe(true);
    expect(doc.content.some((b) => b.type === "heading" && b.attrs.cmd === "section*")).toBe(true);
    expect(types).toContain('"mathInline"');
    expect(types).toContain('"mathBlock"');
    expect(types).toContain('"cite"');
    expect(types).toContain('"ref"');
    expect(types).toContain('"label"');
    expect(types).toContain('"bulletList"');
    expect(types).toContain('"orderedList"');
    expect(types).toContain('"figureBlock"');
    expect(types).toContain('"envBlock"');
  });

  it("keeps unmodelled environments as verbatim raw blocks", () => {
    const doc = parseTex(ARTICLE);
    const raw = doc.content.filter((b) => b.type === "rawTexBlock");
    const srcs = raw.map((b) => (b.type === "rawTexBlock" ? b.attrs.src : ""));
    expect(srcs.some((s) => s.startsWith("\\begin{tikzpicture}"))).toBe(true);
    expect(
      srcs.some((s) => s.includes("keep   this   exactly")),
    ).toBe(true);
    // The theorem environment is modeled: its title is `opt`, the body is content.
    const theorem = doc.content.find(
      (b) => b.type === "envBlock" && b.attrs.env === "theorem",
    );
    expect(theorem).toEqual({
      type: "envBlock",
      attrs: { env: "theorem", opt: "Euler" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Body of a theorem we do not model yet." }] },
      ],
    });
  });

  it("parses comments as comment marks", () => {
    const doc = parseTex(ARTICLE);
    const blob = JSON.stringify(doc);
    expect(blob).toContain('"comment"');
    expect(blob).toContain("% A full-line comment");
    expect(blob).toContain("% note");
  });

  it("parses a file without \\begin{document} as a plain body", () => {
    const doc = parseTex("Just a paragraph.\n");
    expect(doc.attrs?.wrapped).toBe(false);
    expect(doc.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Just a paragraph." }] },
    ]);
  });
});

describe("preamble decomposition", () => {
  const PREAMBLED = `\\documentclass[11pt,a4paper]{article}
\\usepackage{amsmath}
% keep this comment
\\geometry{margin=1in}
\\title{A \\emph{Nice} Title}
\\author{J.~Smith \\and Q.~Jones}
\\date{2026-10-02}

\\begin{document}
\\maketitle
Body text.
\\end{document}
`;

  it("extracts the well-known commands and keeps the rest raw", () => {
    const doc = parseTex(PREAMBLED);
    const pre = doc.content[0];
    expect(pre?.type).toBe("preamble");
    if (pre?.type !== "preamble") return;
    expect(pre.attrs.documentclassSrc).toBe("\\documentclass[11pt,a4paper]{article}");
    expect(pre.attrs.packagesSrc).toBe("\\usepackage{amsmath}");
    expect(pre.attrs.titleSrc).toBe("\\title{A \\emph{Nice} Title}");
    expect(pre.attrs.authorSrc).toBe("\\author{J.~Smith \\and Q.~Jones}");
    expect(pre.attrs.dateSrc).toBe("\\date{2026-10-02}");
    expect(pre.attrs.src).toContain("% keep this comment");
    expect(pre.attrs.src).toContain("\\geometry{margin=1in}");
    expect(pre.attrs.src).not.toContain("documentclass");
    // \maketitle becomes a title block in the body.
    const title = doc.content.find((b) => b.type === "titleBlock");
    expect(title).toEqual({ type: "titleBlock", attrs: { src: "\\maketitle" } });
  });

  it("re-serializes stably and idempotently", () => {
    const { once, twice } = roundTrip(PREAMBLED);
    expect(once).toBe(twice);
    expect(once).toContain("\\documentclass[11pt,a4paper]{article}");
    expect(once).toContain("\\usepackage{amsmath}");
    expect(once).toContain("% keep this comment");
    expect(once).toContain("\\geometry{margin=1in}");
    expect(once).toContain("\\title{A \\emph{Nice} Title}");
    expect(once).toContain("\\author{J.~Smith \\and Q.~Jones}");
    expect(once).toContain("\\date{2026-10-02}");
    expect(once).toContain("\\maketitle");
  });

  it("does not extract commented-out commands", () => {
    const doc = parseTex("\\documentclass{article}\n% \\author{Ghost}\n\\begin{document}\nx\n\\end{document}\n");
    const pre = doc.content[0];
    if (pre?.type !== "preamble") throw new Error("no preamble");
    expect(pre.attrs.authorSrc).toBeNull();
    expect(pre.attrs.src).toContain("% \\author{Ghost}");
  });
});

describe("serializeTex", () => {
  it("tolerates editor JSON with missing content arrays", () => {
    // Tiptap's getJSON omits content on empty nodes; nothing may throw.
    const doc = {
      type: "doc",
      attrs: { wrapped: false, postamble: "" },
      content: [
        { type: "paragraph" },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
        },
        { type: "paragraph", content: [] },
      ],
    };
    expect(serializeTex(doc as never)).toBe(
      "\\begin{itemize}\n  \\item\n\\end{itemize}\n",
    );
  });

  it("round-trips the modelled document stably", () => {
    const { once, twice } = roundTrip(ARTICLE);
    expect(once).toBe(twice);
    expect(once).toContain("\\documentclass{article}");
    expect(once).toContain("\\begin{document}");
    expect(once).toContain("\\end{document}");
    expect(once).toContain("\\section{Introduction}");
    expect(once).toContain("\\textbf{bold}");
    expect(once).toContain("$e^{i\\pi} + 1 = 0$");
    expect(once).toContain("\\cite[p.~3]{knuth1984}");
    expect(once).toContain("\\ref{eq:euler}");
    expect(once).toContain("\\begin{itemize}");
    expect(once).toContain("  \\item First point");
    expect(once).toContain("% A full-line comment");
    expect(once).toContain("\\section*{Starred heading}");
  });

  it("preserves raw fallback blocks byte-for-byte", () => {
    const { once } = roundTrip(ARTICLE);
    expect(once).toContain("\\begin{verbatim}\nkeep   this   exactly\n\\end{verbatim}");
    expect(once).toContain("\\begin{tikzpicture}\n  \\draw (0,0) -- (1,1);\n\\end{tikzpicture}");
  });

  it("escapes special characters in text", () => {
    const { once } = roundTrip("100\\% of \\$5 \\& \\#3 with a\\_b\n");
    expect(once).toContain("100\\% of \\$5 \\& \\#3 with a\\_b");
  });

  it("keeps a postamble and re-emits it", () => {
    const tex = "\\begin{document}\nBody.\n\\end{document}\n% after\n";
    const { once, twice } = roundTrip(tex);
    expect(once).toContain("% after");
    expect(once).toBe(twice);
  });

  it("round-trips hard line breaks", () => {
    const { once } = roundTrip("a \\\\ b\n\nc \\\\[1em] d\n");
    expect(once).toContain("a \\\\ b");
    expect(once).toContain("c \\\\[1em] d");
  });

  it("round-trips non-breaking tildes", () => {
    const { once } = roundTrip("Fig.~1 shows it.\n");
    expect(once).toContain("Fig.~1");
  });

  it("round-trips comment runs without losing lines", () => {
    const { once } = roundTrip("intro % why\n% two\n\nnext\n");
    expect(once).toContain("intro % why");
    expect(once).toContain("% two");
    expect(once).toContain("next");
  });

  it("handles unbalanced environments without losing the rest", () => {
    const { once, twice } = roundTrip("\\begin{itemize}\n  \\item one\n");
    expect(once).toContain("\\item one");
    expect(once).toBe(twice);
  });

  it("round-trips nested list indentation", () => {
    const { once } = roundTrip(
      "\\begin{itemize}\n  \\item outer\n  \\begin{itemize}\n    \\item inner\n  \\end{itemize}\n\\end{itemize}\n",
    );
    expect(once).toContain("  \\item outer");
    expect(once).toContain("    \\begin{itemize}");
    expect(once).toContain("      \\item inner");
  });
});

describe("modeled environments (envBlock)", () => {
  it("parses the quote family with parsed content", () => {
    const doc = parseTex(
      "\\begin{quote}\nQuoted words.\n\n\\begin{itemize}\n  \\item Point\n\\end{itemize}\n\\end{quote}\n",
    );
    const quote = doc.content[0];
    expect(quote).toEqual({
      type: "envBlock",
      attrs: { env: "quote", opt: null },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Quoted words." }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              attrs: {},
              content: [{ type: "paragraph", content: [{ type: "text", text: "Point" }] }],
            },
          ],
        },
      ],
    });
  });

  it("parses abstract, center, and quotation by env name", () => {
    for (const env of ["abstract", "center", "quotation"]) {
      const doc = parseTex(`\\begin{${env}}\nText.\n\\end{${env}}\n`);
      expect(doc.content[0]).toMatchObject({
        type: "envBlock",
        attrs: { env, opt: null },
      });
    }
  });

  it("keeps a theorem's optional title as opt, quotes' brackets stay content", () => {
    const thm = parseTex("\\begin{proof}[of Lemma 1]\nDone.\n\\end{proof}\n");
    expect(thm.content[0]).toMatchObject({
      type: "envBlock",
      attrs: { env: "proof", opt: "of Lemma 1" },
    });
    // A quote never carries [opt]: the bracket would be content, not a title.
    const q = parseTex("\\begin{quote}\n[Starting bracket]\n\\end{quote}\n");
    expect(q.content[0]).toMatchObject({ attrs: { env: "quote", opt: null } });
  });

  it("keeps display math inside a modeled environment", () => {
    const { once, doc } = roundTrip(
      "\\begin{quote}\nSee:\n\n\\[\n  x = y\n\\]\n\\end{quote}\n",
    );
    expect(JSON.stringify(doc)).toContain('"mathBlock"');
    expect(once).toContain("\\[");
    expect(once).toContain("x = y");
  });

  it("serializes the house style: two-space body indent, nested lists deeper", () => {
    const { once, twice } = roundTrip(
      "\\begin{quote}\nQuoted words.\n\\begin{itemize}\n\\item Point\n\\end{itemize}\n\\end{quote}\n",
    );
    expect(once).toBe(
      "\\begin{quote}\n  Quoted words.\n\n  \\begin{itemize}\n    \\item Point\n  \\end{itemize}\n\\end{quote}\n",
    );
    expect(once).toBe(twice);
  });

  it("parses bracketed display math and inline paren math", () => {
    const { once, doc } = roundTrip("a\\[x\\]b\nm \\(y\\) n\n");
    expect(JSON.stringify(doc)).toContain('"mathBlock"');
    expect(JSON.stringify(doc)).toContain('"mathInline"');
    // Display math becomes its own block; inline paren math stays inline.
    expect(once).toContain("\\[x\\]");
    expect(once).toContain("m \\(y\\) n");
  });

  it("round-trips an opt title and an empty environment", () => {
    const { once } = roundTrip(
      "\\begin{theorem}[Euler]\nBody.\n\\end{theorem}\n\\begin{center}\n\\end{center}\n",
    );
    expect(once).toContain("\\begin{theorem}[Euler]");
    expect(once).toContain("\\begin{center}\n\\end{center}");
  });

  it("leaves unknown environments raw byte-for-byte", () => {
    const { once } = roundTrip("\\begin{myenv}[x]\n  keep  this\n\\end{myenv}\n");
    expect(once).toBe("\\begin{myenv}[x]\n  keep  this\n\\end{myenv}\n");
  });

  it("models theorem environments declared by \\newtheorem in the preamble", () => {
    const tex =
      "\\newtheorem{lemma}{Lemma}\n\\begin{document}\n\\begin{lemma}[First]\nStatement.\n\\end{lemma}\n\\end{document}\n";
    const { once, doc } = roundTrip(tex);
    const lemma = doc.content.find((b) => b.type === "envBlock");
    expect(lemma).toMatchObject({ attrs: { env: "lemma", opt: "First" } });
    expect(once).toContain("\\begin{lemma}[First]");
    expect(once).toContain("\\newtheorem{lemma}{Lemma}");
  });

  it("ignores commented-out \\newtheorem declarations", () => {
    const tex =
      "% \\newtheorem{ghost}{Ghost}\n\\begin{document}\n\\begin{ghost}\nx\n\\end{ghost}\n\\end{document}\n";
    const { once, doc } = roundTrip(tex);
    expect(doc.content.some((b) => b.type === "envBlock")).toBe(false);
    expect(once).toContain("\\begin{ghost}");
  });
});

describe("stability on assorted inputs", () => {
  const cases: string[] = [
    "% only a comment\n",
    "\\section{Empty}\n",
    "\\begin{document}\n\\end{document}\n",
    "\\begin{equation}\nx\n\\end{equation}\n",
    "$unterminated math\n",
    "\\label{a} \\label{b}\n",
    "text \\[ x \\] more\n",
    "a\n\n\n\nb\n",
    "\\begin{itemize}\n\\end{itemize}\n",
    "\\item outside a list\n",
    "escaped \\{ braces \\}\n",
    "\\begin{quote}\na quote\n\\end{quote}\n",
    "\\begin{theorem}[T]\nx\n\\end{theorem}\n",
    "\\begin{quote}\n\\begin{quote}\nnested\n\\end{quote}\n\\end{quote}\n",
    "\\begin{abstract}\n\\noindent\nAn abstract.\n\\end{abstract}\n",
    "\\begin{quote}\n\n\n\nspaced\n\n\n\\end{quote}\n",
  ];

  it.each(cases)("is idempotent for %#", (tex) => {
    const { once, twice } = roundTrip(tex);
    expect(once).toBe(twice);
  });
});
