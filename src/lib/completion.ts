import {
  autocompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { useProjectStore } from "@/store/project";
import { MATH_SYMBOL_CATEGORIES } from "@/lib/math-symbols";
import type { FileEntry } from "@/lib/tauri";

interface CommandSpec {
  label: string;
  template: string;
  detail: string;
}

const COMMANDS: CommandSpec[] = [
  { label: "\\section", template: "\\section{${title}}", detail: "Section heading" },
  {
    label: "\\subsection",
    template: "\\subsection{${title}}",
    detail: "Subsection heading",
  },
  {
    label: "\\subsubsection",
    template: "\\subsubsection{${title}}",
    detail: "Subsubsection heading",
  },
  { label: "\\textbf", template: "\\textbf{${text}}", detail: "Bold text" },
  { label: "\\textit", template: "\\textit{${text}}", detail: "Italic text" },
  { label: "\\emph", template: "\\emph{${text}}", detail: "Emphasize" },
  { label: "\\underline", template: "\\underline{${text}}", detail: "Underline" },
  { label: "\\item", template: "\\item ", detail: "List item" },
  { label: "\\footnote", template: "\\footnote{${note}}", detail: "Footnote" },
  { label: "\\label", template: "\\label{${key}}", detail: "Label for referencing" },
  { label: "\\ref", template: "\\ref{${key}}", detail: "Reference a label" },
  { label: "\\eqref", template: "\\eqref{${key}}", detail: "Reference an equation" },
  {
    label: "\\usepackage",
    template: "\\usepackage{${package}}",
    detail: "Load a package",
  },
  { label: "\\title", template: "\\title{${title}}", detail: "Document title" },
  { label: "\\author", template: "\\author{${author}}", detail: "Document author" },
  { label: "\\date", template: "\\date{${date}}", detail: "Document date" },
  { label: "\\maketitle", template: "\\maketitle", detail: "Render title block" },
  {
    label: "\\tableofcontents",
    template: "\\tableofcontents",
    detail: "Table of contents",
  },
  { label: "\\newpage", template: "\\newpage", detail: "Page break" },
  {
    label: "\\includegraphics",
    template: "\\includegraphics[width=${width}\\textwidth]{${file}}",
    detail: "Include an image",
  },
];

const ENVIRONMENTS: { name: string; template: string }[] = [
  {
    name: "itemize",
    template: "\\begin{itemize}\n  \\item ${content}\n\\end{itemize}",
  },
  {
    name: "enumerate",
    template: "\\begin{enumerate}\n  \\item ${content}\n\\end{enumerate}",
  },
  { name: "center", template: "\\begin{center}\n  ${content}\n\\end{center}" },
  { name: "quote", template: "\\begin{quote}\n  ${content}\n\\end{quote}" },
  { name: "abstract", template: "\\begin{abstract}\n  ${content}\n\\end{abstract}" },
  {
    name: "equation",
    template:
      "\\begin{equation}\n  \\label{eq:${label}}\n  ${equation}\n\\end{equation}",
  },
  {
    name: "align",
    template: "\\begin{align}\n  \\label{eq:${label}}\n  ${equation}\n\\end{align}",
  },
  {
    name: "figure",
    template:
      "\\begin{figure}[${placement}]\n  \\centering\n  \\includegraphics[width=\\textwidth]{${file}}\n  \\caption{${caption}}\n  \\label{fig:${label}}\n\\end{figure}",
  },
  {
    name: "table",
    template:
      "\\begin{table}[${placement}]\n  \\centering\n  \\begin{tabular}{${cols}}\n    ${cell} & ${cell2} \\\\\n  \\end{tabular}\n  \\caption{${caption}}\n\\end{table}",
  },
];

const ENV_NAMES = [
  "document",
  "abstract",
  "itemize",
  "enumerate",
  "center",
  "quote",
  "equation",
  "align",
  "figure",
  "table",
  "tabular",
  "verbatim",
  "thebibliography",
];

function commandOptions(): Completion[] {
  const envOptions: Completion[] = ENVIRONMENTS.map((env) => ({
    label: `\\begin{${env.name}}`,
    type: "keyword",
    detail: "Environment",
    apply: snippet(env.template),
  }));
  const cmdOptions: Completion[] = COMMANDS.map((cmd) => ({
    label: cmd.label,
    type: "function",
    detail: cmd.detail,
    apply: snippet(cmd.template),
  }));
  return [...envOptions, ...cmdOptions, ...mathCommandOptions()];
}

/** Completions for math symbols from the symbols panel data. */
function mathCommandOptions(): Completion[] {
  const seen = new Set<string>();
  const out: Completion[] = [];
  for (const category of MATH_SYMBOL_CATEGORIES) {
    for (const symbol of category.symbols) {
      const cmd = symbol.insert.trim();
      if (!cmd.startsWith("\\") || cmd.includes("{") || seen.has(cmd)) continue;
      seen.add(cmd);
      out.push({
        label: cmd,
        type: "constant",
        detail: symbol.glyph,
        apply: snippet(`${cmd} `),
      });
    }
  }
  // Math constructs with argument templates (skipped above due to braces).
  const constructs: [string, string][] = [
    ["\\frac", "\\frac{${num}}{${den}}"],
    ["\\sqrt", "\\sqrt{${x}}"],
    ["\\sum", "\\sum_{${lower}}^{${upper}}"],
    ["\\int", "\\int_{${lower}}^{${upper}}"],
    ["\\lim", "\\lim_{${to}}"],
    ["\\binom", "\\binom{${n}}{${k}}"],
    ["\\bar", "\\bar{${x}}"],
    ["\\vec", "\\vec{${x}}"],
    ["\\hat", "\\hat{${x}}"],
    ["\\tilde", "\\tilde{${x}}"],
    ["\\overline", "\\overline{${x}}"],
    ["\\underline", "\\underline{${x}}"],
    ["\\mathbb", "\\mathbb{${x}}"],
    ["\\mathcal", "\\mathcal{${x}}"],
    ["\\mathrm", "\\mathrm{${x}}"],
  ];
  for (const [label, template] of constructs) {
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({
      label,
      type: "function",
      detail: "Math",
      apply: snippet(template),
    });
  }
  return out;
}

/** Extensions \includegraphics accepts (and our path completion offers). */
export const IMAGE_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".eps",
  ".gif",
];

/** Commands whose first braced argument is a project file path. */
const PATH_COMMANDS: Record<string, { extensions: string[]; kind: string }> = {
  input: { extensions: [".tex"], kind: "TeX file" },
  include: { extensions: [".tex"], kind: "TeX file" },
  includegraphics: { extensions: IMAGE_EXTENSIONS, kind: "Image" },
  bibliography: { extensions: [".bib"], kind: "Bibliography" },
  addbibresource: { extensions: [".bib"], kind: "Bibliography" },
};

/** Project-relative paths of all files in the tree, depth first. */
function flattenFilePaths(entries: FileEntry[], out: string[] = []): string[] {
  for (const entry of entries) {
    if (entry.isDir) {
      flattenFilePaths(entry.children, out);
    } else {
      out.push(entry.path);
    }
  }
  return out;
}

/**
 * Completion labels for path arguments: LaTeX resolves these extensions
 * itself, so paths are inserted without one. Image paths keep their
 * extension when two files share a stem, so the reference stays
 * unambiguous (e.g. plot.pdf next to plot.png).
 */
export function pathCompletionLabels(
  paths: string[],
): Map<string, string> {
  const stems = paths.map((path) => path.replace(/\.[^./]+$/, ""));
  const ambiguous = new Set(
    stems.filter((stem, index) => stems.indexOf(stem) !== index),
  );
  const out = new Map<string, string>();
  paths.forEach((path, index) => {
    out.set(ambiguous.has(stems[index]) ? path : stems[index], path);
  });
  return out;
}

export function latexCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  // Environment name inside \begin{...}
  const envContext = context.matchBefore(/\\begin\{[a-zA-Z*]*/);
  if (envContext && envContext.to === context.pos) {
    return {
      from: envContext.from + "\\begin{".length,
      options: ENV_NAMES.map((name) => ({ label: name, type: "type" })),
      validFor: /^[a-zA-Z*]*$/,
    };
  }

  // Label reference inside \ref{...} or \eqref{...}
  const refContext = context.matchBefore(/\\(eq)?ref\{[^}]*/);
  if (refContext && refContext.to === context.pos) {
    const labels = useProjectStore.getState().allLabels();
    if (labels.length === 0) return null;
    const brace = refContext.text.lastIndexOf("{");
    return {
      from: refContext.from + brace + 1,
      options: labels.map((label) => ({ label, type: "variable" })),
      validFor: /^[^}]*$/,
    };
  }

  // Citation keys inside the \cite family (\citep, \textcite, …)
  const citeContext = context.matchBefore(
    /\\[A-Za-z]*cite\*?(?:\[[^\]]*\])*\{[^}]*/,
  );
  if (citeContext && citeContext.to === context.pos) {
    const citeKeys = useProjectStore.getState().allCiteKeys();
    if (citeKeys.length === 0) return null;
    const brace = citeContext.text.lastIndexOf("{");
    const from = citeContext.from + brace + 1;
    // With a multi-key \cite{a,b}, complete the key the cursor is in.
    const typed = citeContext.text.slice(brace + 1);
    const keyStart = typed.lastIndexOf(",") + 1;
    return {
      from: from + keyStart,
      options: citeKeys.map((key) => ({ label: key, type: "variable" })),
      validFor: /^[^},]*/,
    };
  }

  // File path inside \input{...}, \include{...}, \includegraphics{...},
  // \bibliography{...} or \addbibresource{...} (\includegraphics may
  // carry options between the command and the brace)
  const pathContext = context.matchBefore(
    /\\(includegraphics|include|input|bibliography|addbibresource)(?:\[[^\]]*\])?\{[^}]*/,
  );
  if (pathContext && pathContext.to === context.pos) {
    const spec =
      PATH_COMMANDS[pathContext.text.match(/^\\(\w+)/)?.[1] ?? ""];
    if (spec) {
      const { files, activeFile } = useProjectStore.getState();
      const candidates = flattenFilePaths(files).filter(
        (path) =>
          path !== activeFile &&
          spec.extensions.some((ext) => path.toLowerCase().endsWith(ext)),
      );
      if (candidates.length === 0) return null;
      const brace = pathContext.text.lastIndexOf("{");
      const labels = pathCompletionLabels(candidates);
      return {
        from: pathContext.from + brace + 1,
        options: [...labels.entries()].map(([label, path]) => ({
          label,
          type: "file",
          detail: `${spec.kind} (${path})`,
          // Shorter paths first.
          boost: -label.length,
        })),
        validFor: /^[^}\s]*$/,
      };
    }
  }

  // Command name after a backslash
  const cmdContext = context.matchBefore(/\\[a-zA-Z]*/);
  if (cmdContext && cmdContext.to === context.pos) {
    return {
      from: cmdContext.from,
      options: commandOptions(),
      validFor: /^\\[a-zA-Z]*$/,
    };
  }

  return null;
}

export const latexAutocompletion = autocompletion({
  override: [latexCompletionSource],
});
