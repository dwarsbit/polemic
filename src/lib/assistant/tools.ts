/**
 * The assistant's tools: what the model may call while it works. Read
 * tools run right away; `compile` runs once the user allows it for the
 * project; `propose_change` never writes, it hands a change card to the
 * user. Each tool returns plain text for the model. The app is reached
 * through `AssistantHost`, so the tools run against fakes in tests.
 */

import type { CompileIssue, AgentToolSpec, TexPackageInfo } from "@/lib/tauri";
import {
  describeProseChange,
  planReplacements,
  proseChange,
  type ProseChange,
  type Replacement,
} from "./edits";
import { searchText } from "@/lib/project-search";

/** A change the model proposed, waiting for the user. */
export interface ProposedChange {
  id: number;
  path: string;
  explanation: string;
  replacements: Replacement[];
  /** The file's text the change was planned against. */
  before: string;
  after: string;
  /** True when the file does not exist yet. */
  creates: boolean;
  /** Set in LaTeX mode when the change edits the prose. */
  prose: ProseChange | null;
}

export interface CompileResult {
  success: boolean;
  issues: CompileIssue[];
}

/** What the tools need from the app. */
export interface AssistantHost {
  /** Project-relative paths of every file. */
  listFiles(): string[];
  mainFile(): string | null;
  /** The text as the user sees it now; null when there is no such file. */
  readFile(path: string): Promise<string | null>;
  /** The issues of the last compile. */
  issues(): CompileIssue[];
  /** Compiles, asking the user first when compiling is not allowed
   *  yet; null when the user declines. Throws when the compile cannot
   *  run (no TeX distribution). */
  compile(): Promise<CompileResult | null>;
  packageInfo(names: string[]): Promise<TexPackageInfo[]>;
  /** Shows a change card; returns its number. */
  propose(change: Omit<ProposedChange, "id">): number;
  /** Whether prose changes are flagged (LaTeX mode). */
  flagProse(): boolean;
}

/** A tool result longer than this is cut, to keep small models usable. */
const MAX_RESULT = 12_000;
const MAX_READ_LINES = 400;
const MAX_SEARCH_HITS = 60;
const TEXT_FILE =
  /\.(tex|bib|sty|cls|bst|bbx|cbx|def|cfg|ltx|dtx|txt|md|latexmkrc)$|(^|\/)latexmkrc$/i;

export const TOOL_SPECS: AgentToolSpec[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List every file in the project, with the main file marked.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a text file of the project as the user sees it now (unsaved changes included). Lines come numbered as `12| text`; the numbers are not part of the file. Read at most 400 lines at a time.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Project-relative path, e.g. sections/methods.tex",
          },
          from_line: {
            type: "integer",
            description: "First line, 1-based. Default 1.",
          },
          to_line: { type: "integer", description: "Last line, inclusive." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_project",
      description:
        "Find a literal string (case-insensitive) in the project's text files. Returns `path:line: text` for each matching line.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_compile_issues",
      description: "The errors and warnings of the last compile, from the LaTeX log.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "compile",
      description:
        "Save the open files and compile the project, then return the errors and warnings. Use it to see the current state or to check that an applied change worked. The user may decline.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "package_info",
      description:
        "Whether LaTeX packages are installed in the user's TeX distribution, with their short descriptions.",
      parameters: {
        type: "object",
        properties: { names: { type: "array", items: { type: "string" } } },
        required: ["names"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_change",
      description:
        "Propose a change to one file. The user sees it as a diff and applies or discards it; nothing is written by this tool. Each `find` must be copied exactly from the file (no line numbers) and occur exactly once; keep it short but unique. To create a new file, pass one replacement with an empty `find`. Propose one change per file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative path." },
          explanation: {
            type: "string",
            description: "One or two sentences for the user on what the change does.",
          },
          replacements: {
            type: "array",
            items: {
              type: "object",
              properties: { find: { type: "string" }, replace: { type: "string" } },
              required: ["find", "replace"],
            },
          },
        },
        required: ["path", "explanation", "replacements"],
      },
    },
  },
];

/** A short line for the chat about what a tool call did. */
export function describeCall(name: string, args: Record<string, unknown>): string {
  const path = typeof args.path === "string" ? args.path : "";
  switch (name) {
    case "list_files":
      return "Listed the project files";
    case "read_file":
      return `Read ${path}`;
    case "search_project":
      return `Searched for “${String(args.query ?? "")}”`;
    case "get_compile_issues":
      return "Read the compile issues";
    case "compile":
      return "Compiled the project";
    case "package_info":
      return `Looked up ${Array.isArray(args.names) ? args.names.join(", ") : "packages"}`;
    case "propose_change":
      return `Proposed a change to ${path}`;
    default:
      return `Called ${name}`;
  }
}

function cut(text: string): string {
  return text.length > MAX_RESULT
    ? `${text.slice(0, MAX_RESULT)}\n[cut: ${text.length - MAX_RESULT} more characters]`
    : text;
}

/** Issues as the model reads them, one per line. */
export function formatIssues(issues: CompileIssue[]): string {
  if (issues.length === 0) return "No errors or warnings.";
  return issues
    .slice(0, 40)
    .map((issue) => {
      const where = issue.file
        ? ` ${issue.file}${issue.line !== null ? `:${issue.line}` : ""}`
        : "";
      const detail = issue.detail.length > 0 ? `\n  ${issue.detail.join("\n  ")}` : "";
      const hint = issue.hint ? `\n  Hint: ${issue.hint}` : "";
      return `${issue.severity}${where}: ${issue.message}${detail}${hint}`;
    })
    .join("\n");
}

/** The lines of `text` numbered `n| line`, clamped to MAX_READ_LINES. */
export function numberLines(text: string, from = 1, to?: number): string {
  const lines = text.split("\n");
  const first = Math.min(Math.max(1, Math.floor(from)), Math.max(1, lines.length));
  const last = Math.min(
    lines.length,
    to === undefined ? first + MAX_READ_LINES - 1 : Math.floor(to),
    first + MAX_READ_LINES - 1,
  );
  const body = lines
    .slice(first - 1, last)
    .map((line, i) => `${first + i}| ${line}`)
    .join("\n");
  const more =
    last < lines.length ? `\n[lines ${last + 1}-${lines.length} not shown]` : "";
  return `${body}${more}`;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Runs one tool call and returns its result for the model. */
export async function runTool(
  host: AssistantHost,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "list_files": {
      const main = host.mainFile();
      const files = host.listFiles();
      if (files.length === 0) return "The project has no files.";
      return files.map((f) => (f === main ? `${f} (main file)` : f)).join("\n");
    }
    case "read_file": {
      const path = str(args.path);
      if (path === null) return "Error: give a path.";
      const text = await host.readFile(path);
      if (text === null) return `Error: there is no file ${path}. Use list_files.`;
      const from = typeof args.from_line === "number" ? args.from_line : 1;
      const to = typeof args.to_line === "number" ? args.to_line : undefined;
      return cut(numberLines(text, from, to));
    }
    case "search_project": {
      const query = str(args.query);
      if (query === null || query === "") return "Error: give a query.";
      const hits: string[] = [];
      for (const path of host.listFiles().filter((f) => TEXT_FILE.test(f))) {
        const text = await host.readFile(path);
        if (text === null) continue;
        for (const hit of searchText(text, query, {
          caseSensitive: false,
          scope: "all",
        })) {
          hits.push(`${path}:${hit.line}: ${hit.text}`);
          if (hits.length >= MAX_SEARCH_HITS) break;
        }
        if (hits.length >= MAX_SEARCH_HITS) break;
      }
      if (hits.length === 0) return "No matches.";
      return cut(hits.join("\n"));
    }
    case "get_compile_issues":
      return cut(formatIssues(host.issues()));
    case "compile": {
      let result: CompileResult | null;
      try {
        result = await host.compile();
      } catch (e) {
        return `The compile could not run: ${String(e)}`;
      }
      if (result === null)
        return "The user did not allow compiling. Don't ask again; work from the last compile's issues.";
      return cut(
        `${result.success ? "The compile succeeded." : "The compile failed."}\n${formatIssues(result.issues)}`,
      );
    }
    case "package_info": {
      const names = Array.isArray(args.names)
        ? args.names.filter((n): n is string => typeof n === "string").slice(0, 20)
        : [];
      if (names.length === 0) return "Error: give package names.";
      const info = await host.packageInfo(names);
      return names
        .map((n, i) => {
          const item = info[i];
          if (!item) return `${n}: unknown`;
          return `${n}: ${item.installed ? "installed" : "not installed"}${item.description ? `, ${item.description}` : ""}`;
        })
        .join("\n");
    }
    case "propose_change": {
      const path = str(args.path)?.replace(/^\.?\//, "") ?? null;
      const explanation = str(args.explanation) ?? "";
      if (path === null || path === "") return "Error: give a path.";
      if (path.split("/").includes(".."))
        return "Error: the path must stay inside the project.";
      const replacements = Array.isArray(args.replacements)
        ? args.replacements.filter(
            (r): r is Replacement =>
              r !== null &&
              typeof r === "object" &&
              typeof (r as Replacement).find === "string" &&
              typeof (r as Replacement).replace === "string",
          )
        : [];
      const existing = await host.readFile(path);
      const before = existing ?? "";
      const planned = planReplacements(before, replacements);
      if ("error" in planned) return `Error: ${planned.error} Nothing was proposed.`;
      if (planned.after === before) return "Error: the change does not alter the file.";
      const prose =
        host.flagProse() && path.toLowerCase().endsWith(".tex")
          ? proseChange(before, planned.after)
          : null;
      const id = host.propose({
        path,
        explanation,
        replacements,
        before,
        after: planned.after,
        creates: existing === null,
        prose,
      });
      const note = prose
        ? ` Note: ${describeProseChange(prose)} The user was warned.`
        : "";
      return `Proposed as change ${id}. The user will review it; it is not applied yet.${note}`;
    }
    default:
      return `Error: there is no tool ${name}.`;
  }
}
