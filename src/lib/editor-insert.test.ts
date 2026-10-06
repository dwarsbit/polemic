import { describe, expect, it } from "vitest";
import { freshLineInsert } from "./editor-insert";

describe("freshLineInsert", () => {
  const LIST = "\\begin{itemize}\n  \\item \n\\end{itemize}";

  it("passes single-line snippets through untouched", () => {
    expect(freshLineInsert("$x$", "some text ", " more")).toBe("$x$");
    expect(freshLineInsert("\\alpha", "", "")).toBe("\\alpha");
  });

  it("lands a block snippet mid-line on fresh lines", () => {
    expect(freshLineInsert(LIST, "intro text ", "")).toBe("\n" + LIST);
  });

  it("does not prepend a newline at a line start", () => {
    expect(freshLineInsert(LIST, "", "")).toBe(LIST);
    // Only whitespace before the cursor still reads as a line start.
    expect(freshLineInsert(LIST, "  ", "")).toBe(LIST);
  });

  it("appends a newline when text follows on the line", () => {
    expect(freshLineInsert(LIST, "", "trailing")).toBe(LIST + "\n");
  });

  it("frames the snippet when the cursor sits mid-line", () => {
    expect(freshLineInsert(LIST, "before ", "after")).toBe("\n" + LIST + "\n");
  });
});
