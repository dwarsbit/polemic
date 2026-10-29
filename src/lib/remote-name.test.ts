import { describe, expect, it } from "vitest";
import { projectNameFromRemote, suggestedRepoName } from "@/lib/tauri";

describe("projectNameFromRemote", () => {
  it("takes the last path segment without .git", () => {
    expect(projectNameFromRemote("https://github.com/ada/paper.git")).toBe("paper");
    expect(projectNameFromRemote("git@gitlab.com:ada/thesis.git")).toBe("thesis");
    expect(projectNameFromRemote("https://git.overleaf.com/abc123")).toBe("abc123");
    expect(projectNameFromRemote("https://github.com/ada/paper/")).toBe("paper");
    expect(projectNameFromRemote("")).toBe("");
  });
});

describe("suggestedRepoName", () => {
  it("keeps the characters GitHub takes and dashes the rest", () => {
    expect(suggestedRepoName("My Thesis (2026)")).toBe("My-Thesis-2026");
    expect(suggestedRepoName("paper_v2.0")).toBe("paper_v2.0");
    expect(suggestedRepoName("  ***  ")).toBe("paper");
    expect(suggestedRepoName("..")).toBe("paper");
  });
});
