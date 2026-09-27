import {
  autocompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { useProjectStore } from "@/store/project";

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
  return [...envOptions, ...cmdOptions];
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

  // Citation key inside \cite{...}
  const citeContext = context.matchBefore(/\\cite\{[^}]*/);
  if (citeContext && citeContext.to === context.pos) {
    const citeKeys = useProjectStore.getState().allCiteKeys();
    if (citeKeys.length === 0) return null;
    const brace = citeContext.text.lastIndexOf("{");
    return {
      from: citeContext.from + brace + 1,
      options: citeKeys.map((key) => ({ label: key, type: "variable" })),
      validFor: /^[^}]*$/,
    };
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
