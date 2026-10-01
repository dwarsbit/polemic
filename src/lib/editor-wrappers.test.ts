import { describe, expect, it } from "vitest";
import { TEXT_WRAPPERS, wrapOrUnwrap } from "./editor-wrappers";

describe("wrapOrUnwrap", () => {
  it("wraps a selection", () => {
    expect(wrapOrUnwrap("text", TEXT_WRAPPERS.bold)).toEqual({
      text: "\\textbf{text}",
    });
  });

  it("unwraps an exactly-wrapped selection", () => {
    expect(wrapOrUnwrap("\\emph{text}", TEXT_WRAPPERS.emph)).toEqual({
      text: "text",
    });
  });

  it("leaves a partial wrapper alone (no toggle on nesting)", () => {
    expect(wrapOrUnwrap("\\textbf{x} and more", TEXT_WRAPPERS.bold).text).toBe(
      "\\textbf{\\textbf{x} and more}",
    );
  });

  it("empty selection inserts the wrapper with the cursor inside", () => {
    expect(wrapOrUnwrap("", TEXT_WRAPPERS.underline)).toEqual({
      text: "\\underline{}",
      cursor: 11,
    });
  });
});
