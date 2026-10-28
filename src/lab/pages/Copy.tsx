import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LabSection } from "@/lab/Lab";
import inventory from "@/lab/data/copy-inventory.json";
import { cn } from "@/lib/utils";

/**
 * Copy: the style guide, the renames that follow from it, and the full
 * inventory of user-facing strings (934, from a scan of
 * src/components and the native menu) with a search box.
 */

interface Entry {
  file: string;
  line: number;
  kind: string;
  text: string;
}

const RULES: { rule: string; example: string }[] = [
  {
    rule: "Sentence case for everything in the app: panel titles, buttons, labels, tabs, settings. Title Case only in native menus.",
    example:
      "FIGURES & TABLES → Figures & tables · New File stays in native context menus",
  },
  {
    rule: "One name per thing. Bibliography is the panel and the .bib data; Sources are where entries come from; References never appears. Issues (not problems, not errors list). Properties (not Info). Navigator is the left column, Preview the PDF.",
    example:
      "“Add from Sources…” stays; “Sources…” in the View menu → “Bibliography Sources…” under Project",
  },
  {
    rule: "Verbs lead buttons and menu items; nouns lead panels and settings. A button says what happens when pressed.",
    example: "Confirm → Rename · AI → Ask AI · Choose folder → Choose…",
  },
  {
    rule: "Tooltips name the action, then the shortcut in parentheses with the platform key. Never a sentence, never the state.",
    example: "“PDF preview: visible” → “Hide PDF preview (⇧⌘P)”",
  },
  {
    rule: "Descriptions say what the setting does to the document, in one sentence, no implementation words (engine, wordlist, PATH) unless the user must act on them.",
    example:
      "“A hover card above math blocks shows how they render. More engines can be added.” → “A card above a formula shows how it renders.”",
  },
  {
    rule: "Empty states: one line saying what belongs here and how to add it; no period after fragments, period after sentences.",
    example: "Empty project. → No files yet. Create one with the + button.",
  },
  {
    rule: "Numbers with a singular and plural form everywhere; counts in tabular figures; never “{n}×”.",
    example: "{n} errors → 1 error / 2 errors · 3× → 3 uses",
  },
  {
    rule: "Errors say what went wrong and what to do, in that order, without blame. Technical detail goes last or behind a disclosure.",
    example:
      "“git was not found on your PATH.” → “Git is not installed. Snapshots are used instead.”",
  },
  {
    rule: "US spelling. Unicode ellipsis (…), en dash for ranges (10–20 MB), × for dimensions, middle dot (·) as a separator.",
    example: "about 10-20 MB → 10–20 MB",
  },
  {
    rule: "LaTeX is written as users type it: one backslash. (JSX attributes do not unescape \\\\, so seven tooltips show two today.)",
    example: "Bold — \\\\textbf → Bold (\\textbf)",
  },
];

const PROPOSALS: { where: string; from: string; to: string; why?: string }[] = [
  {
    where: "Rail",
    from: "Figures & Tables",
    to: "Figures & tables",
    why: "sentence case",
  },
  { where: "Rail", from: "Compile Log", to: "Compile log" },
  { where: "Rail", from: "Search", to: "Search in project" },
  { where: "Rail", from: "Manage packages (Cmd/Ctrl + Alt + P)", to: "Packages (⌥⌘P)" },
  {
    where: "Rail",
    from: "Document settings (class, paper, title)",
    to: "Document settings",
  },
  {
    where: "Panel headers",
    from: "FILES, OUTLINE, SYMBOLS, ASSETS, LABELS, BIBLIOGRAPHY, GIT, HISTORY, SNAPSHOTS, COMMENTS, PROPERTIES, PREVIEW, ISSUES, COMPILE LOG",
    to: "Files, Outline, … in sentence case, 12px medium",
    why: "one header component",
  },
  {
    where: "Git panel",
    from: "STAGED / CHANGES",
    to: "Staged · Changes (group labels)",
  },
  {
    where: "Header",
    from: "Rename project · Switch project (hover icons)",
    to: "Project menu: Rename…, Show in Finder, Switch project…",
  },
  {
    where: "Header",
    from: "PDF preview: visible / hidden",
    to: "Hide PDF preview / Show PDF preview (⇧⌘P)",
  },
  {
    where: "Header",
    from: "Auto-compile on save: on / off",
    to: "Auto-compile on save (on) / (off)",
  },
  { where: "Header", from: "Compile the project now", to: "Compile (⇧⌘R)" },
  {
    where: "Status bar",
    from: "TeX ready",
    to: "TeX Live 2025 (the distribution found)",
  },
  {
    where: "Status bar",
    from: "TeX distribution not found",
    to: "No TeX distribution found",
  },
  { where: "Status bar", from: "Not compiled", to: "Not compiled yet" },
  {
    where: "Status bar",
    from: "Compiled · lualatex",
    to: "Compiled · lualatex (keep)",
  },
  {
    where: "Issues",
    from: "{n} errors, {n} warnings",
    to: "1 error · 2 warnings (singular aware, dot separator)",
  },
  { where: "Issues", from: "AI", to: "Ask AI" },
  {
    where: "Issues",
    from: "Ask the configured AI provider for a fix, with a preview",
    to: "Ask the AI assistant for a fix",
  },
  {
    where: "Issues",
    from: "Compilation failed with no parsed issues — check the compile log.",
    to: "The compile failed without a readable error. See the compile log.",
  },
  {
    where: "Issues",
    from: "No automatic fix for this one — try Fix with AI.",
    to: "No built-in fix for this error. Try Ask AI.",
  },
  {
    where: "Preview",
    from: "Press Compile (or {modKey}S) to build and preview the PDF.",
    to: "Compile to see the PDF here (⌘S saves and compiles).",
  },
  {
    where: "Preview",
    from: "Compilation failed. Showing the last successful build; see the issues panel below the editor.",
    to: "The last compile failed. This is the previous PDF; the errors are in Issues.",
  },
  {
    where: "Preview",
    from: "Open PDF in system viewer",
    to: "Open in Preview / Open in default viewer",
  },
  {
    where: "Files",
    from: "Empty project.",
    to: "No files yet. Create one with the + button.",
  },
  {
    where: "Files",
    from: "New File / New Folder (context menu)",
    to: "Unchanged: native menus keep Title Case",
  },
  { where: "Files", from: "Confirm (rename dialog)", to: "Rename" },
  {
    where: "Files",
    from: "Delete {path}? It moves to the system trash, where you can restore it.",
    to: "Move {name} to the trash? You can restore it from there.",
  },
  {
    where: "Outline",
    from: "No sections in this document.",
    to: "No sections yet. Add one with \\section.",
  },
  {
    where: "Assets",
    from: "No assets yet. Import image, PDF, or data files with the + button — they are copied into the project's assets/ folder.",
    to: "No assets yet. Import images, PDFs or data with the + button; they are copied into assets/.",
  },
  { where: "Assets", from: "{n}×", to: "{n} uses" },
  {
    where: "Assets",
    from: "Used in {n} place / {n} places",
    to: "Used {n} time / {n} times",
  },
  {
    where: "Bibliography",
    from: "No bibliography yet. Create a .bib file for this project to start adding references.",
    to: "No bibliography yet. Create bibliography.bib to start adding entries.",
  },
  {
    where: "Bibliography",
    from: "No entries in the project's .bib files.",
    to: "No entries yet. Add one with + or from Sources.",
  },
  {
    where: "Bibliography",
    from: "incomplete / unused (pill text)",
    to: "Incomplete / Unused",
  },
  {
    where: "Bibliography",
    from: "Import by DOI or arXiv ID…",
    to: "Import by DOI or arXiv…",
  },
  {
    where: "Labels",
    from: "No labels in this project yet.",
    to: "No labels yet. Add one with \\label.",
  },
  {
    where: "Comments",
    from: "No comments yet. Right-click in the editor to add one.",
    to: "No comments yet. Select text and press ⌥⌘C.",
  },
  {
    where: "Comments",
    from: "Mark resolved / Mark unresolved",
    to: "Resolve / Reopen",
  },
  {
    where: "Git",
    from: "git was not found on your PATH.",
    to: "Git is not installed. Snapshots are used instead.",
  },
  {
    where: "Git",
    from: "This project is not a git repository yet.",
    to: "This project is not under version control yet.",
  },
  {
    where: "Git",
    from: "Working tree clean.",
    to: "No changes since the last commit.",
  },
  { where: "Git", from: "Commit message…", to: "Commit message" },
  { where: "Git", from: "Show changes vs HEAD", to: "Show changes" },
  {
    where: "Search",
    from: "Type to search across all .tex files in the project.",
    to: "Type to search every .tex and .bib file.",
  },
  { where: "Search", from: "all / math / text", to: "All · Math · Text" },
  {
    where: "Search",
    from: "Replace every match (Cmd/Ctrl+Enter)",
    to: "Replace all (⌘↩)",
  },
  {
    where: "Properties",
    from: "Math (inline · display)",
    to: "Math (inline · display) (keep)",
  },
  { where: "Projects", from: "Open existing folder", to: "Open folder…" },
  { where: "Projects", from: "TEMPLATE / RECENT PROJECTS", to: "Template / Recent" },
  {
    where: "Projects",
    from: "Not installed in your TeX distribution: {packages}. With TeX Live, run …",
    to: "This template needs {packages}, which your TeX distribution lacks. Install them with: tlmgr install {packages}",
  },
  {
    where: "Tabs",
    from: "Close {file}?  This file has unsaved changes.  Discard / Save & Close",
    to: "Save changes to {file}?  Your changes will be lost if you don't save them.  Don't Save / Cancel / Save",
  },
  { where: "Settings", from: "Reopen last project", to: "Reopen the last project" },
  {
    where: "Settings",
    from: "Include new files automatically",
    to: "Add new files to the main document",
  },
  { where: "Settings", from: "Version control", to: "Track changes with" },
  {
    where: "Settings",
    from: "Spellcheck / Spellcheck language",
    to: "Check spelling / Language (under Writing)",
  },
  { where: "Settings", from: "Auto-braces for ^ and _", to: "Braces after ^ and _" },
  { where: "Settings", from: "Convert $$ to \\[ \\]", to: "Turn $$ into \\[ \\]" },
  {
    where: "Settings",
    from: "Math preview (On / Off toggle)",
    to: "Math preview on hover (switch)",
  },
  {
    where: "Settings",
    from: "Grammar and style (section) + Checker and rules (section)",
    to: "Grammar and style (one card: switch, English variant, checker)",
  },
  { where: "Settings", from: "TeX & Compile", to: "Compile" },
  { where: "Settings", from: "AI / AI quickfix provider", to: "Assistant / Provider" },
  {
    where: "Settings",
    from: "Online DOI/arXiv lookup",
    to: "Look up DOI and arXiv IDs online",
  },
  {
    where: "Settings",
    from: "Font settings (card) · Editor font · Editor font size · Syntax theme",
    to: "Editor font (card) · Font · Size · Syntax colors",
  },
  {
    where: "Settings",
    from: "Cursor style / Cursor color",
    to: "Text cursor (card) · Shape / Color",
  },
  { where: "Settings", from: "Choose folder", to: "Choose…" },
  { where: "Toolbar", from: "Bold — \\\\textbf (Cmd/Ctrl + B)", to: "Bold (⌘B)" },
  {
    where: "Toolbar",
    from: "Insert a table, or edit the one at the cursor (Cmd/Ctrl + Shift + T)",
    to: "Insert or edit table (⇧⌘T)",
  },
  { where: "Toolbar", from: "Bulleted list (itemize)", to: "Bulleted list" },
  { where: "Help", from: "Open the Sources settings", to: "Open bibliography sources" },
  {
    where: "Palette",
    from: "New project (back to the projects view)",
    to: "Close project",
  },
  {
    where: "Palette",
    from: "Auto-compile: turn off / on",
    to: "Turn auto-compile off / on",
  },
  {
    where: "Menu",
    from: "Toggle Sidebar / Toggle PDF Preview / Toggle Right Panel",
    to: "Navigator / PDF Preview / Properties (checkmarks)",
  },
  {
    where: "Menu",
    from: "Show Issues / Show Compile Log",
    to: "Issues / Compile Log (checkmarks)",
  },
  { where: "Menu", from: "Export PDF as…", to: "Export PDF…" },
  { where: "Menu", from: "Go to Editor", to: "removed (Visual / Code replace it)" },
];

const KINDS = [
  "all",
  "label",
  "button",
  "tooltip",
  "placeholder",
  "title",
  "description",
  "empty",
  "error",
  "menu",
  "header",
  "other",
];

export function CopyPage() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const entries = inventory as Entry[];
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (kind === "all" || e.kind === kind) &&
        (q === "" ||
          e.text.toLowerCase().includes(q) ||
          e.file.toLowerCase().includes(q)),
    );
  }, [entries, query, kind]);

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Labels and text</h1>
      <p className="mb-8 max-w-2xl text-sm text-muted-foreground">
        A scan found 934 user-facing strings in 56 files. The style guide below is what
        every string is checked against; the renames are the ones that follow from it.
        The shell and settings prototypes already use the new wording.
      </p>

      <LabSection title="Style guide">
        <ol className="space-y-3">
          {RULES.map((r, i) => (
            <li key={i} className="rounded-xl border bg-card px-4 py-3 shadow-xs">
              <p className="text-sm">{r.rule}</p>
              <p className="mt-1 font-mono text-2xs text-muted-foreground">
                {r.example}
              </p>
            </li>
          ))}
        </ol>
      </LabSection>

      <LabSection
        title="Renames"
        note={`${PROPOSALS.length} changes, grouped by where they appear. Strings not listed keep their wording (most descriptions and dialogs already follow the guide).`}
      >
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-2xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Where</th>
                <th className="px-3 py-2 text-left font-medium">Today</th>
                <th className="px-3 py-2 text-left font-medium">Proposed</th>
              </tr>
            </thead>
            <tbody>
              {PROPOSALS.map((p, i) => (
                <tr key={i} className="border-t align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {p.where}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{p.from}</td>
                  <td className="px-3 py-2">
                    {p.to}
                    {p.why && (
                      <span className="ml-1 text-2xs text-muted-foreground">
                        ({p.why})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LabSection>

      <LabSection
        title="Inventory"
        note="Every string the scan found, as written in the source."
      >
        <div className="mb-3 flex items-center gap-2">
          <div className="relative w-72">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 rounded-lg pl-8 text-xs"
              placeholder="Search strings or files"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className={cn(
                  "rounded-full border px-2 py-0.5 text-2xs capitalize",
                  kind === k
                    ? "border-tint-edge bg-tint-soft text-tint-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
                onClick={() => setKind(k)}
              >
                {k}
              </button>
            ))}
          </div>
          <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
            {rows.length} strings
          </span>
        </div>
        <div className="max-h-[560px] overflow-y-auto rounded-xl border bg-card shadow-xs">
          <table className="w-full text-xs">
            <tbody>
              {rows.map((e, i) => (
                <tr key={i} className="border-t first:border-t-0">
                  <td className="w-40 px-3 py-1.5 font-mono text-2xs text-muted-foreground">
                    {e.file.split("/").pop()}:{e.line}
                  </td>
                  <td className="w-20 px-2 py-1.5 text-2xs text-muted-foreground">
                    {e.kind}
                  </td>
                  <td className="px-3 py-1.5">{e.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LabSection>
    </>
  );
}
