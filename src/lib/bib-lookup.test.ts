import { describe, expect, it } from "vitest";
import { bibtexToDraft, parseLookupId } from "./bib-lookup";

describe("parseLookupId", () => {
  it("reads bare and prefixed DOIs", () => {
    const expected = { kind: "doi", doi: "10.1145/3292500.3330701" };
    expect(parseLookupId("10.1145/3292500.3330701")).toEqual(expected);
    expect(parseLookupId(" doi:10.1145/3292500.3330701 ")).toEqual(expected);
    expect(parseLookupId("https://doi.org/10.1145/3292500.3330701")).toEqual(expected);
    expect(parseLookupId("https://dx.doi.org/10.1145%2F3292500.3330701")).toEqual(expected);
  });

  it("reads arXiv IDs in every common spelling", () => {
    const expected = {
      kind: "arxiv",
      id: "1706.03762",
      doi: "10.48550/arXiv.1706.03762",
    };
    expect(parseLookupId("1706.03762")).toEqual(expected);
    expect(parseLookupId("arXiv:1706.03762v5")).toEqual(expected);
    expect(parseLookupId("https://arxiv.org/abs/1706.03762")).toEqual(expected);
    expect(parseLookupId("https://arxiv.org/pdf/1706.03762v7.pdf")).toEqual(expected);
    expect(parseLookupId("10.48550/arXiv.1706.03762")).toEqual(expected);
  });

  it("reads old-style arXiv IDs", () => {
    expect(parseLookupId("hep-th/9901001")).toEqual({
      kind: "arxiv",
      id: "hep-th/9901001",
      doi: "10.48550/arXiv.hep-th/9901001",
    });
  });

  it("rejects anything else", () => {
    expect(parseLookupId("")).toBeNull();
    expect(parseLookupId("attention is all you need")).toBeNull();
    expect(parseLookupId("10.12/short")).toBeNull();
    expect(parseLookupId("1234")).toBeNull();
  });
});

describe("bibtexToDraft", () => {
  const crossref =
    "@article{Knuth_1984, title={Literate Programming}, volume={27}, ISSN={0010-4620}, " +
    "url={http://dx.doi.org/10.1093/comjnl/27.2.97}, DOI={10.1093/comjnl/27.2.97}, " +
    "number={2}, journal={The Computer Journal}, publisher={Oxford University Press (OUP)}, " +
    "author={Knuth, D. E.}, year={1984}, month=jan, pages={97–111} }";

  it("regenerates the key and normalizes fields", () => {
    const draft = bibtexToDraft(crossref, ["knuth1984"], { kind: "doi", doi: "10.1093/comjnl/27.2.97" });
    expect(draft?.key).toBe("knuth19842");
    expect(draft?.type).toBe("article");
    const get = (name: string) => draft?.fields.find((f) => f.name === name)?.value;
    expect(get("doi")).toBe("10.1093/comjnl/27.2.97");
    expect(get("journal")).toBe("The Computer Journal");
    expect(get("month")).toBe("1");
    expect(get("title")).toBe("Literate Programming");
  });

  it("adds eprint fields and drops noise for arXiv", () => {
    const datacite =
      "@misc{https://doi.org/10.48550/arxiv.1706.03762, doi = {10.48550/ARXIV.1706.03762}, " +
      "author = {Vaswani, Ashish and Shazeer, Noam}, keywords = {Computation and Language (cs.CL)}, " +
      "title = {Attention Is All You Need}, publisher = {arXiv}, year = {2017}, " +
      "copyright = {arXiv.org perpetual, non-exclusive license}}";
    const draft = bibtexToDraft(datacite, [], {
      kind: "arxiv",
      id: "1706.03762",
      doi: "10.48550/arXiv.1706.03762",
    });
    expect(draft?.key).toBe("vaswani2017");
    const names = draft?.fields.map((f) => f.name);
    expect(names).not.toContain("copyright");
    expect(names).not.toContain("keywords");
    expect(draft?.fields.find((f) => f.name === "eprint")?.value).toBe("1706.03762");
    expect(draft?.fields.find((f) => f.name === "archiveprefix")?.value).toBe("arXiv");
  });

  it("returns null for text without an entry", () => {
    expect(bibtexToDraft("<html></html>", [], { kind: "doi", doi: "10.1/x" })).toBeNull();
  });
});
