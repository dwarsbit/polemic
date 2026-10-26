import { describe, expect, it } from "vitest";
import {
  extractGraphicsPaths,
  extractGraphicsRefs,
  isCheckableRef,
  planGraphicsRename,
  resolveGraphicsRef,
} from "@/lib/graphics-refs";
import { applyEdits } from "@/lib/label-index";

describe("extractGraphicsRefs", () => {
  it("finds paths with options, starred forms, and offsets", () => {
    const src = "a \\includegraphics[width=1cm]{figs/a}\n\\includegraphics*{ b.png }";
    const refs = extractGraphicsRefs(src);
    expect(refs.map((r) => r.path)).toEqual(["figs/a", "b.png"]);
    expect(src.slice(refs[0].from, refs[0].to)).toBe(
      "\\includegraphics[width=1cm]{figs/a}",
    );
  });

  it("skips commented-out commands but not escaped percent signs", () => {
    const src = "% \\includegraphics{gone}\n50\\% \\includegraphics{kept}";
    expect(extractGraphicsRefs(src).map((r) => r.path)).toEqual(["kept"]);
  });
});

describe("extractGraphicsPaths", () => {
  it("reads every folder of \\graphicspath", () => {
    expect(extractGraphicsPaths("\\graphicspath{{figs/}{./img}}")).toEqual([
      "figs/",
      "./img",
    ]);
    expect(extractGraphicsPaths("% \\graphicspath{{figs/}}")).toEqual([]);
  });
});

describe("resolveGraphicsRef", () => {
  const files = new Set(["figs/plot.pdf", "img/photo.jpg", "logo.png"]);

  it("resolves exact paths and implied extensions", () => {
    expect(resolveGraphicsRef("logo.png", files)).toBe("logo.png");
    expect(resolveGraphicsRef("logo", files)).toBe("logo.png");
    expect(resolveGraphicsRef("./figs/plot", files)).toBe("figs/plot.pdf");
  });

  it("searches \\graphicspath folders", () => {
    expect(resolveGraphicsRef("plot", files)).toBeNull();
    expect(resolveGraphicsRef("plot", files, ["figs/"])).toBe("figs/plot.pdf");
    expect(resolveGraphicsRef("photo", files, ["figs", "./img/"])).toBe(
      "img/photo.jpg",
    );
  });

  it("reports renamed or moved files as missing", () => {
    expect(resolveGraphicsRef("figs/old-plot", files)).toBeNull();
    expect(resolveGraphicsRef("../outside", files)).toBeNull();
  });

  it("leaves macros and absolute paths unchecked", () => {
    expect(isCheckableRef("\\figdir/a")).toBe(false);
    expect(isCheckableRef("/abs/a.png")).toBe(false);
    expect(isCheckableRef("C:/a.png")).toBe(false);
    expect(isCheckableRef("figs/a")).toBe(true);
  });
});

describe("planGraphicsRename", () => {
  const files = new Set(["figures/plot.png", "figures/sub/map.pdf", "logo.pdf"]);
  const run = (source: string, from: string, to: string, paths: string[] = []) =>
    applyEdits(source, planGraphicsRename(source, { from, to }, files, paths));

  it("follows a renamed file, keeping options and the implied extension", () => {
    expect(
      run(
        "\\includegraphics[width=3cm]{figures/plot}",
        "figures/plot.png",
        "figures/result.png",
      ),
    ).toBe("\\includegraphics[width=3cm]{figures/result}");
    expect(
      run("\\includegraphics{figures/plot.png}", "figures/plot.png", "img/plot.png"),
    ).toBe("\\includegraphics{img/plot.png}");
  });

  it("follows a renamed folder and its \\graphicspath entry", () => {
    const source =
      "\\graphicspath{{figures/}}\n\\includegraphics{plot}\n\\includegraphics{figures/sub/map}";
    expect(run(source, "figures", "figs", ["figures/"])).toBe(
      "\\graphicspath{{figs/}}\n\\includegraphics{plot}\n\\includegraphics{figs/sub/map}",
    );
  });

  it("writes a root path when the file leaves its \\graphicspath folder", () => {
    expect(
      run("\\includegraphics{plot}", "figures/plot.png", "plot.png", ["figures/"]),
    ).toBe("\\includegraphics{plot}");
    expect(
      run("\\includegraphics{sub/map}", "figures/sub/map.pdf", "maps/map.pdf", [
        "figures/",
      ]),
    ).toBe("\\includegraphics{maps/map}");
  });

  it("leaves other references and commented ones alone", () => {
    const source = "\\includegraphics{logo}\n% \\includegraphics{figures/plot}";
    expect(run(source, "figures/plot.png", "x.png")).toBe(source);
  });
});
