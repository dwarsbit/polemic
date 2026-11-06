// Mirrors the engine tests in src-tauri/src/profile.rs.
import { describe, expect, it } from "vitest";
import { resolveEngine } from "@/lib/engine";

const auto = { engine: null };
const resolve = (source: string) => resolveEngine(auto, "main.tex", source);

describe("resolveEngine", () => {
  it("reads magic comments", () => {
    expect(resolve("% !TEX program = xelatex\n\\documentclass{article}")).toBe(
      "xelatex",
    );
    expect(resolve("%!TEX TS-program = LuaLaTeX\n")).toBe("lualatex");
    expect(resolve("\\documentclass{article}\n% !TEX program = xelatex\n")).toBe(
      "pdflatex",
    );
    expect(resolve("% !TEX program = rm -rf\n")).toBe("pdflatex");
  });

  it("guesses from the preamble", () => {
    expect(
      resolve(
        "\\documentclass{article}\n\\usepackage{fontspec}\n\\begin{document}\\end{document}",
      ),
    ).toBe("xelatex");
    expect(
      resolve("\\documentclass{article}\n% \\usepackage{fontspec}\n\\begin{document}"),
    ).toBe("pdflatex");
    expect(resolve("\\begin{document}\\usepackage{fontspec}")).toBe("pdflatex");
  });

  it("guesses from CJK and LuaTeX packages", () => {
    expect(resolve("\\documentclass[UTF8]{ctexart}\n")).toBe("xelatex");
    expect(resolve("\\documentclass{article}\n\\usepackage{amsmath, xeCJK}\n")).toBe(
      "xelatex",
    );
    expect(resolve("\\documentclass{ltjsarticle}\n")).toBe("lualatex");
    expect(
      resolve("\\documentclass{article}\n\\usepackage[match]{luatexja-fontspec}\n"),
    ).toBe("lualatex");
    expect(resolve("\\documentclass{article}\n\\usepackage{amsmath}\n")).toBe(
      "pdflatex",
    );
  });

  it("follows the project's own class and packages", () => {
    const files: Record<string, string> = {
      "tex/cv.cls": "\\LoadClass{article}\n\\RequirePackage[quiet]{fontspec}\n",
      "mystyle.sty": "\\RequirePackage{xcolor}\n\\RequirePackage{inner}\n",
      "inner.sty": "\\RequirePackage{unicode-math}\n",
      "both.sty": "\\ifxetex\n\\RequirePackage{fontspec}\n\\fi\n",
    };
    const read = (path: string) => files[path] ?? null;
    expect(resolveEngine(auto, "tex/main.tex", "\\documentclass{cv}\n", read)).toBe(
      "xelatex",
    );
    expect(
      resolveEngine(
        auto,
        "main.tex",
        "\\documentclass{article}\\usepackage{mystyle}\n",
        read,
      ),
    ).toBe("xelatex");
    expect(resolveEngine(auto, "main.tex", "\\documentclass{article}\n", read)).toBe(
      "pdflatex",
    );
    expect(
      resolveEngine(
        auto,
        "main.tex",
        "\\documentclass{article}\\usepackage{both}\n",
        read,
      ),
    ).toBe("pdflatex");
  });

  it("reads the engine from a latexmkrc", () => {
    const files: Record<string, string> = {
      latexmkrc: "$out_dir = 'build';\n$pdf_mode = 4; # lualatex\n",
      "doc/.latexmkrc": "$pdf_mode=5;\n",
    };
    const read = (path: string) => files[path] ?? null;
    expect(resolveEngine(auto, "main.tex", "\\documentclass{article}\n", read)).toBe(
      "lualatex",
    );
    expect(
      resolveEngine(auto, "doc/main.tex", "\\documentclass{article}\n", read),
    ).toBe("xelatex");
    expect(
      resolveEngine(
        auto,
        "main.tex",
        "% !TEX program = pdflatex\n\\documentclass{article}\n",
        read,
      ),
    ).toBe("pdflatex");
  });

  it("lets the project setting win", () => {
    expect(
      resolveEngine({ engine: "lualatex" }, "main.tex", "% !TEX program = xelatex\n"),
    ).toBe("lualatex");
    expect(
      resolveEngine({ engine: "auto" }, "main.tex", "% !TEX program = xelatex\n"),
    ).toBe("xelatex");
  });
});
