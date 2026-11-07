import { describe, expect, it } from "vitest";
import { kindLabel, onlineChanges } from "@/lib/online-snapshots";

describe("onlineChanges", () => {
  it("lists what differs between a snapshot and the project now", () => {
    const changes = onlineChanges(
      {
        files: [
          { path: "main.tex", text: "One.\nTwo.\n" },
          { path: "same.tex", text: "Same.\n" },
          { path: "gone.tex", text: "Gone.\n" },
          { path: ".polemic/comments/c1.json", text: "{}" },
        ],
        assets: [
          { path: "fig/a.png", hash: "aa", size: 1, type: "image/png" },
          { path: "fig/b.png", hash: "bb", size: 1, type: "image/png" },
        ],
      },
      [
        { path: "main.tex", kind: "text", text: "One.\nThree.\n" },
        { path: "same.tex", kind: "text", text: "Same.\n" },
        { path: "new.tex", kind: "text", text: "New.\n" },
        { path: ".polemic/comments/c2.json", kind: "text", text: "{}" },
        { path: "fig/a.png", kind: "asset", hash: "aa", size: 1, type: "image/png" },
        { path: "fig/b.png", kind: "asset", hash: "cc", size: 1, type: "image/png" },
      ],
    );
    expect(changes.map((c) => [c.path, c.status, c.addedLines, c.removedLines])).toEqual([
      ["fig/b.png", "modified", 0, 0],
      ["gone.tex", "removed", 0, 1],
      ["main.tex", "modified", 1, 1],
      ["new.tex", "added", 1, 0],
    ]);
    expect(changes.find((c) => c.path === "fig/b.png")).toMatchObject({
      before: null,
      after: null,
    });
  });

  it("names the snapshots that aren't hourly", () => {
    expect(kindLabel("hourly")).toBeNull();
    expect(kindLabel("restore")).toBe("Before a restore");
    expect(kindLabel("published")).toBe("Published");
  });
});
