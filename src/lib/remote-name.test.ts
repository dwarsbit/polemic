import { describe, expect, it } from "vitest";
import { projectNameFromRemote } from "@/lib/tauri";

describe("projectNameFromRemote", () => {
  it("takes the last path segment without .git", () => {
    expect(projectNameFromRemote("https://github.com/ada/paper.git")).toBe("paper");
    expect(projectNameFromRemote("git@gitlab.com:ada/thesis.git")).toBe("thesis");
    expect(projectNameFromRemote("https://git.overleaf.com/abc123")).toBe("abc123");
    expect(projectNameFromRemote("https://github.com/ada/paper/")).toBe("paper");
    expect(projectNameFromRemote("")).toBe("");
  });
});
