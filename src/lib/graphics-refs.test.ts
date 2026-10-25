import { describe, expect, it } from "vitest";
import {
  extractGraphicsPaths,
  extractGraphicsRefs,
  isCheckableRef,
  resolveGraphicsRef,
  rewriteBibRefs,
  rewriteGraphicsRefs,
} from "@/lib/graphics-refs";

describe("extractGraphicsRefs", () => {
  it("finds paths with options, starred forms, and offsets", () => {
    const src = "a \\includegraphics[width=1cm]{figs/a}\n\\includegraphics*{ b.png }";
    const refs = extractGraphicsRefs(src);
    expect(refs.map((r) => r.path)).toEqual(["figs/a", "b.png"]);
    expect(src.slice(refs[0].from, refs[0].to)).toBe("\\includegraphics[width=1cm]{figs/a}");
  });

  it("skips commented-out commands but not escaped percent signs", () => {
    const src = "% \\includegraphics{gone}\n50\\% \\includegraphics{kept}";
    expect(extractGraphicsRefs(src).map((r) => r.path)).toEqual(["kept"]);
  });
});

describe("extractGraphicsPaths", () => {
  it("reads every folder of \\graphicspath", () => {
    expect(extractGraphicsPaths("\\graphicspath{{figs/}{./img}}")).toEqual(["figs/", "./img"]);
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
    expect(resolveGraphicsRef("photo", files, ["figs", "./img/"])).toBe("img/photo.jpg");
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

describe("rewriteGraphicsRefs", () => {
  const files = new Set(["figs/plot.pdf", "figs/old/a.png", "logo.png"]);
  const move = (from: string, to: string) => (path: string) =>
    path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : null;

  it("follows a renamed file, keeping the extension-less style", () => {
    const src = "\\includegraphics[width=2cm]{figs/plot} and \\includegraphics{logo.png}";
    expect(rewriteGraphicsRefs(src, files, [], move("figs/plot.pdf", "figs/results.pdf"))).toBe(
      "\\includegraphics[width=2cm]{figs/results} and \\includegraphics{logo.png}",
    );
  });

  it("keeps the extension when it changed, and follows folder moves", () => {
    const src = "\\includegraphics{figs/plot}\n\\includegraphics{figs/old/a}";
    expect(rewriteGraphicsRefs(src, files, [], move("figs/plot.pdf", "plot.png"))).toContain(
      "\\includegraphics{plot.png}",
    );
    expect(rewriteGraphicsRefs(src, files, [], move("figs/old", "figs/new"))).toContain(
      "\\includegraphics{figs/new/a}",
    );
  });

  it("stays relative to the \\graphicspath folder while the file is in it", () => {
    const src = "\\includegraphics{plot}";
    expect(rewriteGraphicsRefs(src, files, ["figs/"], move("figs/plot.pdf", "figs/p2.pdf"))).toBe(
      "\\includegraphics{p2}",
    );
    expect(rewriteGraphicsRefs(src, files, ["figs/"], move("figs/plot.pdf", "img/p2.pdf"))).toBe(
      "\\includegraphics{img/p2}",
    );
  });

  it("leaves comments and unrelated references alone", () => {
    const src = "% \\includegraphics{logo}\n\\includegraphics{logo}";
    expect(rewriteGraphicsRefs(src, files, [], move("logo.png", "brand.png"))).toBe(
      "% \\includegraphics{logo}\n\\includegraphics{brand}",
    );
  });
});

describe("rewriteBibRefs", () => {
  const move = (path: string) => (path === "refs.bib" ? "bib/refs.bib" : null);

  it("rewrites \\bibliography lists and \\addbibresource paths", () => {
    expect(rewriteBibRefs("\\bibliography{other, refs}", move)).toBe(
      "\\bibliography{other,bib/refs}",
    );
    expect(rewriteBibRefs("\\addbibresource{refs.bib}", move)).toBe(
      "\\addbibresource{bib/refs.bib}",
    );
    expect(rewriteBibRefs("\\bibliography{other}", move)).toBe("\\bibliography{other}");
  });
});
