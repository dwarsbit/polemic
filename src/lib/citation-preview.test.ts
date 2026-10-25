import { describe, expect, it } from "vitest";
import {
  detectBiblatexStyle,
  renderBibliography,
  renderCitations,
  type PreviewEntry,
} from "./citation-preview";

const entry = (type: string, fields: Record<string, string>): PreviewEntry => ({
  type,
  key: "k",
  fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
});

const flat = (segments: { text: string }[]) => segments.map((s) => s.text).join("");

const article = entry("article", {
  author: "Vaswani, Ashish and Shazeer, Noam and Parmar, Niki",
  title: "Attention Is All You Need",
  journal: "NeurIPS",
  volume: "30",
  number: "2",
  year: "2017",
  pages: "5998--6008",
  doi: "10.1/x",
});

describe("renderCitations", () => {
  it("numbers and labels", () => {
    expect(renderCitations(article, "numeric", 3)[0].output).toBe("[3]");
    expect(renderCitations(article, "alphabetic", 1)[0].output).toBe("[VSP17]");
  });

  it("shortens three authors in author styles", () => {
    const [paren, text] = renderCitations(article, "authoryear", 1);
    expect(paren.output).toBe("(Vaswani et al. 2017)");
    expect(text.output).toBe("Vaswani et al. (2017)");
  });

  it("falls back to the title when there is no author", () => {
    const book = entry("book", { title: "The TeXbook", year: "1984" });
    expect(renderCitations(book, "authoryear", 1)[0].output).toBe("(The TeXbook 1984)");
  });

  it("adds the title for authortitle", () => {
    const [paren] = renderCitations(article, "authortitle", 1);
    expect(paren.output).toBe("(Vaswani et al., “Attention Is All You Need”)");
  });
});

describe("renderBibliography", () => {
  it("formats an article in a numeric style", () => {
    expect(flat(renderBibliography(article, "numeric"))).toBe(
      "Ashish Vaswani, Noam Shazeer, and Niki Parmar. “Attention Is All You Need”. " +
        "In: NeurIPS 30.2 (2017), pp. 5998–6008. DOI: 10.1/x.",
    );
  });

  it("puts the year after the authors in authoryear", () => {
    expect(flat(renderBibliography(article, "authoryear"))).toBe(
      "Vaswani, Ashish, Noam Shazeer, and Niki Parmar (2017). “Attention Is All You Need”. " +
        "In: NeurIPS 30.2, pp. 5998–6008. DOI: 10.1/x.",
    );
  });

  it("formats a book with an italic title", () => {
    const book = entry("book", {
      author: "Knuth, Donald E.",
      title: "The {TeX}book",
      publisher: "Addison-Wesley",
      address: "Reading",
      year: "1984",
    });
    const out = renderBibliography(book, "numeric");
    expect(flat(out)).toBe("Donald E. Knuth. The TeXbook. Reading: Addison-Wesley, 1984.");
    expect(out.find((s) => s.italic)?.text).toBe("The TeXbook");
  });

  it("keeps corporate authors whole", () => {
    const report = entry("techreport", {
      author: "{Barnes and Noble}",
      title: "Report",
      institution: "Inst",
      year: "2000",
    });
    expect(flat(renderBibliography(report, "numeric"))).toContain("Barnes and Noble. Report.");
  });

  it("renders an arXiv preprint", () => {
    const preprint = entry("misc", {
      author: "Vaswani, Ashish",
      title: "Attention",
      publisher: "arXiv",
      year: "2017",
      eprint: "1706.03762",
      archiveprefix: "arXiv",
    });
    expect(flat(renderBibliography(preprint, "numeric"))).toBe(
      "Ashish Vaswani. Attention. arXiv, 2017. arXiv: 1706.03762.",
    );
  });
});

describe("detectBiblatexStyle", () => {
  it("reads the style option", () => {
    expect(
      detectBiblatexStyle(["\\usepackage[backend=biber,style=authoryear]{biblatex}"]),
    ).toEqual({ name: "authoryear", known: true, style: "authoryear" });
  });

  it("defaults to numeric and ignores commented lines", () => {
    expect(detectBiblatexStyle(["%\\usepackage[style=alphabetic]{biblatex}\n\\usepackage{biblatex}"]))
      .toEqual({ name: "numeric", known: true, style: "numeric" });
  });

  it("maps unknown styles to their family", () => {
    expect(detectBiblatexStyle(["\\usepackage[style=apa]{biblatex}"])).toEqual({
      name: "apa",
      known: false,
      style: "authoryear",
    });
  });

  it("is null without biblatex", () => {
    expect(detectBiblatexStyle(["\\usepackage{natbib}"])).toBeNull();
  });
});
