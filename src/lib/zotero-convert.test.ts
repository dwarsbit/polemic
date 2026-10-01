import { describe, expect, it } from "vitest";

import { formatEntry } from "./bib-entries";
import { zoteroCreators, zoteroItemToBib, zoteroYear } from "./zotero-convert";

describe("zoteroCreators", () => {
  it("formats family/given names as BibTeX name lists", () => {
    expect(
      zoteroCreators([
        { creatorType: "author", firstname: "Donald E.", lastname: "Knuth" },
        { creatorType: "author", firstname: "Leslie", lastname: "Lamport" },
      ]),
    ).toBe("Knuth, Donald E. and Lamport, Leslie");
  });

  it("keeps single-field names (organizations) as-is", () => {
    expect(zoteroCreators([{ creatorType: "author", name: "ACM" }])).toBe("ACM");
  });

  it("skips empty names", () => {
    expect(
      zoteroCreators([
        { creatorType: "author" },
        { creatorType: "author", firstname: "", lastname: "" },
      ]),
    ).toBe("");
  });
});

describe("zoteroYear", () => {
  it("extracts the four-digit year", () => {
    expect(zoteroYear("June 1984")).toBe("1984");
    expect(zoteroYear("1984-06")).toBe("1984");
    expect(zoteroYear(undefined)).toBe("");
    expect(zoteroYear("n.d.")).toBe("");
  });
});

describe("zoteroItemToBib", () => {
  const article = {
    itemType: "journalArticle",
    title: "Literate Programming",
    creators: [
      { creatorType: "author", firstname: "Donald E.", lastname: "Knuth" },
    ],
    date: "1984-01",
    publicationTitle: "The Computer Journal",
    volume: "27",
    issue: "2",
    pages: "97-111",
    DOI: "10.1093/comjnl/27.2.97",
    tags: [{ tag: "typesetting" }],
  };

  it("maps a journalArticle to @article with journal and fields", () => {
    const bib = zoteroItemToBib(article, []);
    expect(bib.type).toBe("article");
    expect(bib.key).toBe("knuth1984");
    expect(bib.title).toBe("Literate Programming");
    const value = (name: string) =>
      bib.fields.find((field) => field.name === name)?.value;
    expect(value("author")).toBe("Knuth, Donald E.");
    expect(value("journal")).toBe("The Computer Journal");
    expect(value("year")).toBe("1984");
    expect(value("pages")).toBe("97-111");
    expect(value("doi")).toBe("10.1093/comjnl/27.2.97");
    expect(value("keywords")).toBe("typesetting");
  });

  it("maps conference papers, theses, reports, and preprints", () => {
    const paper = zoteroItemToBib(
      {
        itemType: "conferencePaper",
        title: "A Paper",
        creators: [{ creatorType: "author", firstname: "J", lastname: "Doe" }],
        date: "1999",
        proceedingsTitle: "Proc. X",
        DOI: "10.1/x",
      },
      [],
    );
    expect(paper.type).toBe("inproceedings");
    expect(paper.fields.find((f) => f.name === "booktitle")?.value).toBe("Proc. X");

    const thesis = zoteroItemToBib(
      {
        itemType: "thesis",
        title: "A Thesis",
        creators: [{ creatorType: "author", firstname: "J", lastname: "Doe" }],
        date: "2020",
        university: "MIT",
        thesisType: "Master's Thesis",
      },
      [],
    );
    expect(thesis.type).toBe("phdthesis");
    expect(thesis.fields.find((f) => f.name === "school")?.value).toBe("MIT");

    const preprint = zoteroItemToBib(
      {
        itemType: "preprint",
        title: "A Preprint",
        creators: [{ creatorType: "author", firstname: "J", lastname: "Doe" }],
        date: "2021",
        url: "https://arxiv.org/abs/2101.00001",
      },
      [],
    );
    expect(preprint.type).toBe("misc");
    expect(preprint.fields.find((f) => f.name === "note")?.value).toBe("Preprint");
    expect(preprint.fields.find((f) => f.name === "url")?.value).toContain("arxiv");

    const report = zoteroItemToBib(
      {
        itemType: "report",
        title: "A Report",
        creators: [{ creatorType: "author", firstname: "J", lastname: "Doe" }],
        institution: "NIST",
      },
      [],
    );
    expect(report.type).toBe("techreport");
    expect(report.fields.find((f) => f.name === "institution")?.value).toBe("NIST");
  });

  it("uses editors when there are no authors", () => {
    const bib = zoteroItemToBib(
      {
        itemType: "book",
        title: "An Edited Volume",
        creators: [{ creatorType: "editor", firstname: "J", lastname: "Doe" }],
        publisher: "Springer",
        date: "2010",
      },
      [],
    );
    expect(bib.fields.find((f) => f.name === "editor")?.value).toBe("Doe, J");
    expect(bib.fields.find((f) => f.name === "author")).toBeUndefined();
  });

  it("falls back to unknown types as misc and generates unique keys", () => {
    const bib = zoteroItemToBib(
      {
        itemType: "film",
        title: "Unknown Item",
        creators: [{ creatorType: "author", firstname: "J", lastname: "Doe" }],
        date: "1999",
      },
      ["doe1999"],
    );
    expect(bib.type).toBe("misc");
    expect(bib.key).toBe("doe19992");
  });

  it("produces valid BibTeX through formatEntry", () => {
    const bib = zoteroItemToBib(article, []);
    const text = formatEntry(bib.type, bib.key, bib.fields);
    expect(text).toContain("@article{knuth1984,");
    expect(text).toContain("journal = {The Computer Journal},");
    expect(text).toContain("doi = {10.1093/comjnl/27.2.97},");
  });
});
