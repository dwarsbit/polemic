// Mirrors the tests in src-tauri/src/bib_lookup.rs.
import { describe, expect, it } from "vitest";
import { checkDoi, encodeDoi } from "@/web/writing";

describe("DOI lookup", () => {
  it("accepts real DOIs", () => {
    expect(() => checkDoi("10.1145/3292500.3330701")).not.toThrow();
    expect(() => checkDoi("10.48550/arXiv.1706.03762")).not.toThrow();
  });

  it("rejects unsafe values", () => {
    for (const doi of [
      "not a doi",
      "10.1000/abc def",
      "10.1000/abc?x=1",
      "10.1000/abc\r\nHost: x",
      "11.1000/abc",
      "10.1002/x<693>",
    ]) {
      expect(() => checkDoi(doi)).toThrow();
    }
  });

  it("encodes path-unsafe characters", () => {
    expect(encodeDoi("10.1000/a+b[1]")).toBe("10.1000/a%2Bb%5B1%5D");
  });
});
