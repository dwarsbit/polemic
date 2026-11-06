import { describe, expect, it } from "vitest";
import {
  backward,
  forward,
  parseSyncTex,
  projectFileFor,
  readSyncTexGz,
  sourceAt,
} from "@/lib/synctex";
import fixture from "./fixtures/two-pages.synctex?raw";

// pdflatex -synctex=1 of main.tex (two pages) with \input{chapters/intro}; word positions from
// `pdftotext -bbox` of the same PDF, in points from the top-left.
const files = ["main.tex", "chapters/intro.tex"];

describe("SyncTeX backward search", () => {
  const sync = parseSyncTex(fixture);

  it("reads the inputs and the pages", () => {
    expect(sync.inputs.get(1)).toBe("./main.tex");
    expect(sync.inputs.get(6)).toBe("./chapters/intro.tex");
    expect([...sync.pages.keys()]).toEqual([1, 2]);
  });

  it.each([
    ["the heading", 1, 170, 132, "main.tex", 3],
    ["'world.'", 1, 175, 154, "main.tex", 4],
    ["'included', from the input file", 1, 180, 166, "chapters/intro.tex", 1],
    [
      "'lines.', on the same output line from the next source line",
      1,
      450,
      166,
      "chapters/intro.tex",
      2,
    ],
    ["'Hello,', the first word of a paragraph", 1, 140, 154, "main.tex", 4],
    ["'page.' on page 2", 2, 230, 154, "main.tex", 10],
  ])("finds %s", (_what, page, x, y, file, line) => {
    expect(sourceAt(sync, files, page, x, y)).toEqual({ file, line });
  });

  it("takes the nearest line for a point between lines or in the margin", () => {
    expect(sourceAt(sync, files, 1, 60, 155)).toEqual({ file: "main.tex", line: 4 });
    expect(sourceAt(sync, files, 2, 300, 600)).toMatchObject({ file: "main.tex" });
  });

  it("finds nothing on a page that does not exist", () => {
    expect(backward(sync, 9, 100, 100)).toBeNull();
  });

  it("reads the gzip the editor uploads", async () => {
    const stream = new Blob([fixture])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const read = await readSyncTexGz(await new Response(stream).arrayBuffer());
    expect(read.pages.size).toBe(2);
  });
});

describe("SyncTeX forward search", () => {
  const sync = parseSyncTex(fixture);

  it.each([
    ["the heading", "main.tex", 3, 1, 132],
    ["a line of the input file", "chapters/intro.tex", 1, 1, 166],
    ["a line on page 2", "main.tex", 10, 2, 154],
  ])("finds %s", (_what, file, line, page, y) => {
    const hit = forward(sync, files, file, line)!;
    expect(hit.page).toBe(page);
    // The baseline of the line box, within a point or two of the words on it.
    expect(Math.abs(hit.y - y)).toBeLessThan(10);
  });

  it("goes back and forth to the same line", () => {
    const hit = forward(sync, files, "main.tex", 4)!;
    expect(sourceAt(sync, files, hit.page, hit.x + 5, hit.y - 2)).toEqual({
      file: "main.tex",
      line: 4,
    });
  });

  it("takes the next line with output for a line without", () => {
    expect(forward(sync, files, "main.tex", 1)?.page).toBe(1);
  });

  it("finds nothing for a file outside the document", () => {
    expect(forward(sync, files, "notes.tex", 1)).toBeNull();
  });
});

describe("projectFileFor", () => {
  it("maps absolute and relative input names to project files", () => {
    expect(projectFileFor("/home/me/thesis/./chapters/intro.tex", files)).toBe(
      "chapters/intro.tex",
    );
    expect(projectFileFor("./main.tex", files)).toBe("main.tex");
    expect(projectFileFor("main.tex", files)).toBe("main.tex");
    expect(projectFileFor("C:\\thesis\\main.tex", files)).toBe("main.tex");
  });

  it("prefers the longest matching path and ignores files outside the project", () => {
    expect(projectFileFor("/p/a/main.tex", ["main.tex", "a/main.tex"])).toBe(
      "a/main.tex",
    );
    expect(projectFileFor("/usr/share/texlive/article.cls", files)).toBeNull();
    expect(projectFileFor("/p/xmain.tex", files)).toBeNull();
  });
});
