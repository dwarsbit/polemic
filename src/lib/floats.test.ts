import { describe, expect, it } from "vitest";
import { parseFloats } from "@/lib/floats";

describe("parseFloats", () => {
  it("reads kind, line, caption, label, and graphic", () => {
    const src = [
      "intro",
      "\\begin{figure}[ht]",
      "  \\centering",
      "  \\includegraphics[width=\\linewidth]{figs/plot}",
      "  \\caption[Short]{The {nested} \\emph{result}.\\label{fig:plot}}",
      "\\end{figure}",
      "\\begin{table*}",
      "  \\begin{tabular}{ll}a&b\\end{tabular}",
      "\\end{table*}",
    ].join("\n");
    expect(parseFloats(src)).toEqual([
      {
        kind: "figure",
        env: "figure",
        line: 2,
        caption: "The {nested} \\emph{result}.",
        label: "fig:plot",
        graphic: "figs/plot",
      },
      { kind: "table", env: "table*", line: 7, caption: null, label: null, graphic: null },
    ]);
  });

  it("lists outer floats only and skips commented ones", () => {
    const src = [
      "% \\begin{figure}\\caption{gone}\\end{figure}",
      "\\begin{figure}",
      "\\begin{subfigure}{.5\\linewidth}\\includegraphics{a}\\caption{A}\\end{subfigure}",
      "\\caption{Both}",
      "\\end{figure}",
      "\\begin{algorithm}\\caption{Search}\\label{alg:s}\\end{algorithm}",
    ].join("\n");
    const floats = parseFloats(src);
    expect(floats.map((f) => [f.kind, f.line])).toEqual([
      ["figure", 2],
      ["algorithm", 6],
    ]);
    // The float's own caption wins over a subfigure's.
    expect(floats[0].caption).toBe("Both");
    expect(parseFloats("\\begin{figure}\\begin{subfigure}{1cm}\\caption{Only}\\end{subfigure}\\end{figure}")[0].caption).toBe("Only");
  });

  it("treats empty captions and labels as missing", () => {
    const [float] = parseFloats("\\begin{wrapfigure}{r}{3cm}\\caption{ }\\label{}\\end{wrapfigure}");
    expect(float.caption).toBeNull();
    expect(float.label).toBeNull();
  });
});
