import { describe, expect, it } from "vitest";
import { sourceName, type SourceDef } from "@/store/sources";

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

describe("sourceName", () => {
  it("prefers the user's label", () => {
    expect(sourceName(source({ name: "Work refs" }))).toBe("Work refs");
  });

  it("falls back per kind", () => {
    expect(sourceName(source({}))).toBe("Bib source");
    expect(sourceName(source({ kind: "zotero-app" }))).toBe("Zotero app");
    expect(sourceName(source({ kind: "zotero-cloud" }))).toBe("Zotero cloud");
  });

  it("falls back to the path's last part", () => {
    expect(sourceName(source({ path: "/Users/leon/refs.bib" }))).toBe("refs.bib");
    expect(sourceName(source({ path: "/Users/leon/papers" }))).toBe("papers");
  });
});
