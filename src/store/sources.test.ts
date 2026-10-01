import { describe, expect, it } from "vitest";
import { bibSourceFiles, sourceName, type SourceDef } from "@/store/sources";

function source(patch: Partial<SourceDef>): SourceDef {
  return {
    id: "s",
    kind: "bib",
    enabled: true,
    name: null,
    path: null,
    userId: null,
    apiKey: null,
    ...patch,
  };
}

const ALL = [
  "sources.bib",
  "sub/refs.bib",
  "sub/deep/x.bib",
  "other/y.bib",
];

describe("bibSourceFiles", () => {
  it("covers the whole library when the path is null", () => {
    expect(bibSourceFiles(source({ path: null }), ALL)).toEqual(ALL);
  });

  it("returns a single file source's own path", () => {
    expect(bibSourceFiles(source({ path: "sub/refs.bib" }), ALL)).toEqual([
      "sub/refs.bib",
    ]);
  });

  it("returns the files under a folder source, nested included", () => {
    expect(bibSourceFiles(source({ path: "sub" }), ALL)).toEqual([
      "sub/refs.bib",
      "sub/deep/x.bib",
    ]);
  });

  it("returns nothing for non-bib sources", () => {
    expect(
      bibSourceFiles(source({ kind: "zotero-cloud", path: null }), ALL),
    ).toEqual([]);
  });
});

describe("sourceName", () => {
  it("prefers the user's label", () => {
    expect(sourceName(source({ name: "Work refs" }))).toBe("Work refs");
  });

  it("falls back per kind", () => {
    expect(sourceName(source({}))).toBe("Polemic Library");
    expect(sourceName(source({ kind: "zotero-app" }))).toBe("Zotero app");
    expect(sourceName(source({ kind: "zotero-cloud" }))).toBe("Zotero cloud");
  });

  it("falls back to the path's last part", () => {
    expect(sourceName(source({ path: "sub/refs.bib" }))).toBe("refs.bib");
    expect(sourceName(source({ path: "sub" }))).toBe("sub");
  });
});
