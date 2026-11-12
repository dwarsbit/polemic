import { describe, expect, it } from "vitest";

import { errorText } from "./error-text";

describe("errorText", () => {
  it("shows a thrown sentence as it is", () => {
    expect(errorText("Could not save main.tex: the disk is full.")).toBe(
      "Could not save main.tex: the disk is full.",
    );
  });

  it("shows an Error without its name in front", () => {
    expect(errorText(new Error("Could not reach GitHub."))).toBe(
      "Could not reach GitHub.",
    );
    expect(errorText(new TypeError())).toBe("TypeError");
  });

  it("shows the message of a failure that carries a kind", () => {
    expect(errorText({ kind: "signed-out", message: "Sign in again." })).toBe(
      "Sign in again.",
    );
  });

  it("prints anything else", () => {
    expect(errorText(404)).toBe("404");
    expect(errorText({ message: "" })).toBe("[object Object]");
  });
});
