// Mirrors the tests in src-tauri/src/templates.rs, on the table as the
// browser build reads it.
import { describe, expect, it } from "vitest";
import { parseTemplates, TEMPLATES } from "@/lib/templates";
import source from "../../src-tauri/src/templates.rs?raw";

describe("TEMPLATES", () => {
  it("reads every template in templates.rs", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([
      "blank",
      "article",
      "report",
      "beamer",
      "thesis",
      "acm",
      "ieee",
      "lncs",
      "elsevier",
    ]);
    for (const t of TEMPLATES) {
      expect(t.name).not.toBe("");
      expect(t.description).not.toBe("");
    }
  });

  it("reads files as written", () => {
    const blank = TEMPLATES.find((t) => t.id === "blank")!;
    expect(blank.files).toEqual([]);
    const article = TEMPLATES.find((t) => t.id === "article")!;
    expect(article.files.map((f) => f.path)).toEqual(["main.tex"]);
    expect(article.files[0].text).toMatch(/^\\documentclass\[11pt\]\{article\}\n/);
    expect(article.files[0].text).toMatch(/\\end\{document\}\n$/);
    const thesis = TEMPLATES.find((t) => t.id === "thesis")!;
    expect(thesis.files.length).toBeGreaterThan(1);
  });

  it("gives paper templates their class and bibliography", () => {
    const papers = TEMPLATES.filter((t) => t.requires.length > 0);
    expect(papers.map((t) => t.id)).toEqual(["acm", "ieee", "lncs", "elsevier"]);
    for (const t of papers) {
      const main = t.files.find((f) => f.path === "main.tex")!.text;
      expect(main.split("\n")[0].endsWith(`{${t.requires[0].file}}`)).toBe(true);
      const bib = t.files.find((f) => f.path === "references.bib")!.text;
      expect(bib).toMatch(/^@article\{knuth84,/);
    }
    expect(papers[0].requires[2]).toEqual({ file: "zi4", package: "inconsolata" });
  });

  it("reads a Windows checkout's CRLF line ends as LF", () => {
    expect(parseTemplates(source.replace(/\n/g, "\r\n"))).toEqual(TEMPLATES);
  });
});
