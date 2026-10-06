/**
 * The AI fallback of "Fix this": ask an OpenAI-compatible provider
 * for a minimal fix to one compile error, then validate its answer
 * into concrete document edits. The model returns find/replace
 * pairs instead of line numbers (those drift); every pair must match
 * the file verbatim or it is rejected. Pure pieces (prompt building,
 * response parsing) are testable without the network.
 */

import type { SourceEdit } from "./label-index";
import { aiChat, type AiSettings, type CompileIssue } from "./tauri";

export interface AiFix {
  /** What the model changed, shown above the diff. */
  explanation: string;
  /** Edits against the document's current text. */
  edits: SourceEdit[];
  /** The document with every edit applied, for the diff preview. */
  fixed: string;
}

export type AiFixResult = { fix: AiFix } | { error: string };

/** The excerpt of the file sent to the model: a window around the
 *  error line (or the head when the error has no line). */
export function promptWindow(
  doc: string,
  line: number | null,
  before = 30,
  after = 40,
): { text: string; firstLine: number } {
  const lines = doc.split("\n");
  const errorLine = line === null ? 1 : Math.min(Math.max(line, 1), lines.length);
  const from = Math.max(1, errorLine - before);
  const to = Math.min(lines.length, errorLine + after);
  return { text: lines.slice(from - 1, to).join("\n"), firstLine: from };
}

const SYSTEM_PROMPT = [
  "You fix single LaTeX compile errors for a desktop editor.",
  "Reply with ONLY a JSON object of the shape",
  '{"explanation": string, "replacements": [{"find": string, "replace": string}]}',
  "- \"find\" must be copied verbatim from the file, as short as possible while still unambiguous.",
  "- Keep the fix minimal: never reformat or touch unrelated lines. At most 3 replacements.",
  "- If the file needs no edit (a recompile or external change is the fix), return an empty replacements array and explain.",
  "- \"explanation\" is one or two sentences for the user, no markdown.",
].join("\n");

export function buildUserPrompt(issue: CompileIssue, doc: string): string {
  const { text, firstLine } = promptWindow(doc, issue.line);
  const errorLine =
    issue.line !== null && issue.line >= firstLine && issue.line < firstLine + text.split("\n").length
      ? text.split("\n")[issue.line - firstLine]
      : null;
  const parts = [
    `File: ${issue.file ?? "(the compiled file)"}${issue.line !== null ? `, error at line ${issue.line}` : ""}`,
    "Error from the LaTeX log:",
    `  ${issue.message}`,
    ...(issue.detail.map((d) => `  ${d}`)),
    "",
    `Excerpt (starts at line ${firstLine}${errorLine !== null ? "; the error line reads exactly:" : ""})`,
    ...(errorLine !== null ? [errorLine] : []),
    text,
    "",
    "Fix the error.",
  ];
  return parts.join("\n");
}

interface Replacement {
  find: string;
  replace: string;
}

/** The model's JSON, unwrapped from optional markdown fences. */
function parseModelJson(content: string): { explanation: string; replacements: Replacement[] } | null {
  const stripped = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as {
      explanation?: unknown;
      replacements?: unknown;
    };
    const replacements: Replacement[] = [];
    if (Array.isArray(parsed.replacements)) {
      for (const item of parsed.replacements) {
        if (
          item !== null &&
          typeof item === "object" &&
          typeof (item as Replacement).find === "string" &&
          typeof (item as Replacement).replace === "string"
        ) {
          replacements.push(item as Replacement);
        }
      }
    }
    if (typeof parsed.explanation !== "string") return null;
    return { explanation: parsed.explanation, replacements: replacements.slice(0, 3) };
  } catch {
    return null;
  }
}

/** Where a `find` lands: its occurrence closest to the error line,
 *  skipping ranges already covered by earlier edits. */
function locate(
  doc: string,
  find: string,
  anchor: number,
  covered: { from: number; to: number }[],
): number | null {
  if (find.length === 0 || find === doc) return null;
  let best = -1;
  let bestDist = Infinity;
  let at = doc.indexOf(find);
  while (at !== -1) {
    const overlaps = covered.some((range) => at < range.to && at + find.length > range.from);
    if (!overlaps && Math.abs(at - anchor) < bestDist) {
      best = at;
      bestDist = Math.abs(at - anchor);
    }
    at = doc.indexOf(find, at + 1);
  }
  return best === -1 ? null : best;
}

/** Turn the model's response into validated edits against the
 *  document, or an error explaining why it cannot be applied. */
export function parseAiFixResponse(
  content: string,
  doc: string,
  line: number | null,
): AiFixResult {
  const parsed = parseModelJson(content);
  if (parsed === null) {
    return { error: "The model did not return readable JSON." };
  }
  if (parsed.replacements.length === 0) {
    return { error: parsed.explanation };
  }
  // The anchor for choosing between duplicate finds.
  let anchor = 0;
  if (line !== null) {
    const before = doc.split("\n").slice(0, line - 1);
    anchor = before.join("\n").length + (before.length > 0 ? 1 : 0);
  }
  const covered: { from: number; to: number }[] = [];
  const edits: SourceEdit[] = [];
  for (const { find, replace } of parsed.replacements) {
    const at = locate(doc, find, anchor, covered);
    if (at === null) {
      return { error: "The model's suggestion does not match the file." };
    }
    covered.push({ from: at, to: at + find.length });
    edits.push({ from: at, to: at + find.length, insert: replace });
  }
  const fixed = [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce((out, edit) => out.slice(0, edit.from) + edit.insert + out.slice(edit.to), doc);
  return { fix: { explanation: parsed.explanation, edits, fixed } };
}

/** Ask the configured provider for a fix for the issue. */
export async function requestAiFix(
  issue: CompileIssue,
  doc: string,
  ai: AiSettings,
): Promise<AiFixResult> {
  if (ai.baseUrl === null || ai.apiKey === null || ai.model === null) {
    return { error: "The AI provider is not configured — see Settings → AI." };
  }
  let content: string;
  try {
    content = await aiChat({
      baseUrl: ai.baseUrl,
      apiKey: ai.apiKey,
      model: ai.model,
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(issue, doc),
    });
  } catch (e) {
    return { error: String(e) };
  }
  return parseAiFixResponse(content, doc, issue.line);
}
