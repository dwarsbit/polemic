import { ensurePackages } from "@/lib/editor-figure";
import { insertAtCursor } from "@/lib/editor-insert";

export interface TikzSnippet {
  id: string;
  title: string;
  keywords: string;
  /** \usepackage names the snippet needs (tikz, pgfplots). */
  packages: string[];
  template: string;
}

/** Five starter snippets covering the common thesis-figure cases. */
export const TIKZ_SNIPPETS: TikzSnippet[] = [
  {
    id: "scaffold",
    title: "Insert TikZ picture",
    keywords: "tikz scaffold empty basic",
    packages: ["tikz"],
    template: "\\begin{tikzpicture}\n  \n\\end{tikzpicture}",
  },
  {
    id: "axes",
    title: "Insert TikZ: axes with grid",
    keywords: "tikz axes coordinate grid plot math",
    packages: ["tikz"],
    template: [
      "\\begin{tikzpicture}",
      "  % Axes",
      "  \\draw[->] (-4,0) -- (4,0) node[right] {$x$};",
      "  \\draw[->] (0,-3) -- (0,3) node[above] {$y$};",
      "  % Grid",
      "  \\draw[gray, very thin] (-4,-3) grid (4,3);",
      "\\end{tikzpicture}",
    ].join("\n"),
  },
  {
    id: "plot",
    title: "Insert TikZ: pgfplots function plot",
    keywords: "tikz pgfplots function graph plot math",
    packages: ["pgfplots"],
    template: [
      "\\begin{tikzpicture}",
      "  \\begin{axis}[",
      "    axis lines = left,",
      "    xlabel = $x$,",
      "    ylabel = {$f(x)$},",
      "  ]",
      "    \\addplot[domain = -3:3, samples = 100] {sin(deg(x))};",
      "  \\end{axis}",
      "\\end{tikzpicture}",
    ].join("\n"),
  },
  {
    id: "tree",
    title: "Insert TikZ: tree",
    keywords: "tikz tree nodes hierarchy diagram",
    packages: ["tikz"],
    template: [
      "\\begin{tikzpicture}[",
      "  every node/.style = {draw, circle, minimum size = 6mm},",
      "  level distance = 15mm,",
      "]",
      "  \\node {A}",
      "    child { node {B} }",
      "    child { node {C}",
      "      child { node {D} }",
      "    };",
      "\\end{tikzpicture}",
    ].join("\n"),
  },
  {
    id: "flowchart",
    title: "Insert TikZ: flowchart",
    keywords: "tikz flowchart diagram boxes arrows process",
    packages: ["tikz"],
    template: [
      "\\begin{tikzpicture}[",
      "  node distance = 20mm,",
      "  block/.style = {rectangle, draw, rounded corners, minimum width = 25mm, minimum height = 8mm},",
      "  ]",
      "  \\node[block] (start) {Start};",
      "  \\node[block, below of = start] (step) {Step};",
      "  \\node[block, below of = step] (end) {End};",
      "  \\draw[->] (start) -- (step);",
      "  \\draw[->] (step) -- (end);",
      "\\end{tikzpicture}",
    ].join("\n"),
  },
];

/**
 * Insert a snippet at the cursor, adding its packages to the preamble
 * when missing. No-op when the editor is not mounted.
 */
export function insertTikzSnippet(id: string): void {
  const snippet = TIKZ_SNIPPETS.find((s) => s.id === id);
  if (!snippet) return;
  ensurePackages(snippet.packages);
  insertAtCursor(snippet.template);
}
