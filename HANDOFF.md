# Handoff notes

Working notes for ongoing work. Update this file when a session ends or a
phase finishes, so work can continue on another machine. Newest entries at
the top under "Current status"; older phases move down to "History".
Keep it short: what is done, what is in progress, what is next, how to
verify. Commit each phase with a useful message and push to
`origin/main`.

## Current status — Visual editor (Tiptap rich text face)

Last landed: commit `322e03e` "Visual editor: Tiptap rich text face for
.tex files" (2026-10-02 17:04, on `main`, pushed). Working tree was clean
afterwards.

### Done

- Round-trip core in `src/lib/visual`: comment-aware parser + idempotent
  serializer; raw fallbacks (verbatim, TikZ, theorems, unknown commands)
  round-trip byte-for-byte.
- Modelled content: sections, marks, itemize/enumerate, comments as marks,
  inline/display math (KaTeX, focus flips to raw source), figures with
  thumbnails, cite/ref/label pills.
- Preamble decomposed into documentclass/packages/title metadata;
  `\maketitle` renders as an editable title card; Document settings dialog
  edits class/font size/paper/columns/draft/metadata.
- V1 tooling parity: panel/dialog inserts (assets, citations, tables, TikZ,
  symbols) parse into nodes while Visual is the active face; pill in-place
  editing and context-menu navigation (ref -> label, cite -> Bibliography);
  pasted LaTeX converts; cursor survives the Visual/Code face toggle.

### Not started / known gaps

- No ROADMAP row tracks the visual editor yet.
- BBT-style Zotero citekeys not read; Zotero cloud path untested against a
  real key (from the sources v3 work).

### Next candidates

Superseded by the v2 plan below (2026-10-03 investigation).

## Plan — Visual editor v2 (2026-10-03)

Investigation read: `parse.ts`, `serialize.ts`, `doc-types.ts`,
`extensions.ts`, `insert.ts`, `face-anchor.ts`, `math-render.ts`,
`VisualTexEditor.tsx`, `EditorView.tsx`, `EditorToolbar.tsx`,
`EditorFaceToggle.tsx`, `store/ui.ts`, all `src/lib/visual` tests.
Baseline: 329/330 tests green; the 1 failure is pre-existing in
`comment-anchor.test.ts` (`resolveAnchor` far-away fallback), unrelated
to the visual editor — fix separately.

The v1 architecture is sound (raw-atom fallbacks, idempotent
serialization). The gaps are in *authoring* (you can't create structure
from the Visual face), *parity* (panels yank you to Code), and a few
modeled blocks. Phases, highest value first:

### Phase 1 — Authoring essentials

The visual face can't create or reshape the document skeleton:

1. **Heading controls** — the toolbar has no section insert or
   level control; a document can't gain a `\section` from Visual.
   Add a heading dropdown to `VisualToolbar` (section…subparagraph,
   mapped to `cmd` attrs) and promote/demote buttons (rewrite `cmd`
   between adjacent `SECTION_LEVELS`). Tiptap's Mod-Alt-1..6 already
   work; keep their numbering in sync with the dropdown.
2. **Pill input rules** — pasting `\cite{x}` becomes a pill, but
   typing it stays text (and serializes as literal `\cite`, which
   re-parses as a command on reload — confusing). Add input rules:
   `\cite{…}`, `\ref{…}`, `\label{…}` convert on closing brace,
   mirroring the existing `$…$` rule in `extensions.ts`.
3. **Quote environments** — `quote`/`quotation`/`center` are common
   but render as raw blocks. Model them: a `quoteBlock` node with the
   env name preserved, styled like a blockquote; `center` similar.
   Round-trip tests first (parse + serialize + idempotence).

### Phase 2 — Panel parity (stop yanking to Code)

4. **Jumps stay in Visual** — `EditorView.tsx` forces Code mode on
   every `jumpTarget` (labels, bibliography). Resolve jumps in the
   active face instead: in Visual, map the target line to a doc
   position via `face-anchor`-style heading/text matching and place
   the cursor there.
5. **Cite pill hygiene badges** — the Bibliography panel knows
   undefined citation keys; surface that on cite pills (red dot /
   tooltip), reusing the existing cross-file key index.
6. **Lint markers** — the Code face shows missing-key warnings
   inline; Visual shows none. Reuse the same issue data to badge
   pills (5 and 6 can share the mechanism).

### Phase 3 — More modeled content

7. **Footnotes** — `\footnote{…}` is a raw inline today. Make it an
   inline pill with an in-place editor (the math pattern), serialized
   verbatim.
8. **List item labels** — `parseItems` keeps `\item[label]` and
   round-trips it, but Visual can't create or edit one. Show and edit
   the label on the first item line.
9. **Theorem environments** — keep raw but give `rawTexBlock` views
   a styled chrome for `theorem`/`proof`/`definition` envs (name +
   body preview) so they read like content instead of noise. Full
   modeling only if cheap.

### Phase 4 — Polish and performance

10. **Cursor across external reloads** — the `docVersion` effect
    (`setContent`) resets the cursor to the doc start; only the face
    toggle preserves place. Re-anchor on reload when the file didn't
    change identity.
11. **Debounced serialization** — `onUpdate` runs `serializeTex` on
    the whole doc per keystroke plus store writes. Debounce the
    `setContent`/`markDirty` side (keep `anchorRef` immediate); the
    Code-face resync already tolerates a lagging store.
12. **Editor settings** — respect the `fontSize` setting in
    `.visual-editor` (Code does); consider spellcheck for prose text
    nodes (Code face has a whole popover; a first step is native
    spellcheck in the content area).

Deliberately deferred: table cell-grid editing (roadmap tracks it
under the table assistant), comments in Visual, search-and-replace in
Visual (replace is pending even in Code).

Each phase lands as its own commit (or a few), tests with it
(`parse-serialize.test.ts` for modeling, DOM tests for rules/views),
and this file updated.

### Verify

- `pnpm test` / `pnpm tsc` (round-trip tests live in
  `src/lib/visual/*.test.ts` and `src/components/VisualTexEditor.dom.test.tsx`).
- Manual: toggle Visual/Code after each change; confirm no diff in
  the Code face for untouched documents (idempotence).

## Phase 1 plan (detailed, 2026-10-03)

Scope decisions (asked and answered): theorems **fully modeled**
in Phase 1 (not just styled chrome); **citation blocks skipped**
(thebibliography / csquotes stay raw, revisit later); quote family =
**quote, quotation, center, abstract**; headings via toolbar dropdown
**plus markdown shortcuts** (`#`-style). No new promote/demote keys —
the dropdown converts levels.

### 1. Environment blocks (`envBlock`) — quote family + theorems

One generic node instead of per-env types.

- **Model** (`doc-types.ts`): `EnvBlockNode { type: "envBlock",
  attrs: { env: string, opt?: string }, content: Block[] }`.
  `opt` is the optional argument right after `\begin{env}[...]`
  (amsthm note/theorem title).
- **Parse** (`parse.ts`): new `MODELED_ENVS`. Static quote family:
  `quote`, `quotation`, `center`, `abstract`. Theorem envs: static
  fallbacks (`theorem`, `lemma`, `corollary`, `proposition`,
  `definition`, `remark`, `example`, `proof`, `fact`) **plus** env
  names harvested from `\newtheorem{env}…` in the raw preamble `src`
  (scan at `parseTex` time, pass down to `parseEnv`; fragment parsing
  via `insert.ts` has no preamble — fallback list only). Body parses
  recursively with `parseBody` (lists/math/pills inside work); strip a
  leading `[opt]` into `opt`. Everything else stays `rawTexBlock` —
  the byte-for-byte raw promise is untouched for unknown envs.
- **Serialize** (`serialize.ts`): `\begin{env}[opt]` + 2-space
  indented body + `\end{env}` (house style, same as lists). Known
  trade-off, accepted: newly modeled envs reformat on first
  Visual→Code round-trip; parse∘serialize is idempotent.
- **Views** (`extensions.ts` + `index.css`): `envBlock` is a
  container node (content `block+`). CSS per env:
  `vis-env-quote` (left rule, indented), `vis-env-quotation`
  (same, tighter leading), `vis-env-center` (centered text),
  `vis-env-abstract` ("Abstract" label, indented),
  `vis-env-theorem` (accent left bar, bold name line — display
  name from `\newtheorem{env}{Name}` when present, else the env
  name capitalized; `proof` gets the QED-square styling). Theorem
  `opt` (title) edits in place via the meta-pill input pattern,
  committing a `setNodeMarkup` attr change.
- **Creation**: toolbar BlockQuote button inserts `quote`; typing
  `> ` in an empty paragraph becomes a quote (own input rule;
  StarterKit's blockquote is disabled). Others (abstract, center,
  theorems) arrive by parsing existing source — dropdown can grow
  later.
- **Tests**: parse/serialize per env; nesting (quote containing a
  list; theorem with `\label` and a formula); `opt` round-trip;
  idempotence; unknown env still byte-for-byte raw; DOM test for the
  `> ` rule and theorem title editing.

### 2. Heading controls

- **Consistency fix first**: heading nodes carry `cmd` + `level`;
  every creation path must write a consistent pair. Canonical pairs
  from `SECTION_LEVELS` (part..subparagraph = 1..6; `paragraph`/
  `subparagraph` share 6, `cmd` disambiguates). Tiptap's built-in
  `#` input rules are replaced — they create level-1 headings with
  the default `cmd:"section"`, a live mismatch today.
- **Markdown rules** (`extensions.ts`): `#`→section, `##`→
  subsection, `###`→subsubsection, `####`→paragraph, `#####`→
  subparagraph (article-doc mapping, Overleaf-style). Six `#`:
  none. Rules create the heading with the pair, caret after.
- **Toolbar dropdown** (`VisualTexEditor.tsx`): current level
  shown; options Part, Chapter, Section, Subsection,
  Subsubsection, Paragraph, Subparagraph, Body text. Selecting
  converts the block at the cursor (heading↔heading via
  `setNodeMarkup` with the new pair; heading→paragraph via
  `setParagraph`; paragraph→heading inserts an empty heading).
  This is the promote/demote path — no extra keyboard shortcut.
- **Display** (`index.css`): with `#` now mapping to section
  (level 3, h3 at 1.15rem), the visual hierarchy skews small.
  Adjust `.visual-editor h1..h6` sizes so a section reads as the
  document's top level in article-class files (h3 gets ~h2 size;
  part/chapter keep the larger steps).
- **Tests**: DOM tests for `#`/`##` rules; dropdown conversion
  heading→heading→paragraph round-trips through serialize.

### 3. Pill input rules

- Typing `\cite{…}`, `\ref{…}`, `\label{…}` (incl. optional
  `[...]` before the braces, and the natbib/biblatex family —
  reuse `isCiteCmd`/`REF_CMDS` from `parse.ts`, exported from a
  shared module rather than re-listed) converts into the pill
  node on the closing `}`, selects it (math pattern), so the raw
  editor opens immediately. Single InputRule matching the pill
  command families; `$…$` and `$$` rules stay as they are.
- **Tests**: DOM tests per family; lone `\cite` without braces
  stays text.

### 4. Landing order (one commit each, tests with each)

1. `envBlock` parse/serialize + round-trip tests (no UI).
2. `envBlock` node views + CSS + `> `/toolbar quote creation.
3. Theorem envs: `\newtheorem` scan + name line + `opt` editing.
4. Heading pairs + markdown rules + toolbar dropdown + CSS sizes.
5. Pill input rules.
6. ROADMAP: add a "Visual editor" row; update this file.

Out of scope (explicit): citation blocks, tables, footnotes,
item labels, panel parity (Phase 2).

## History

- 2026-10-02: Visual editor v1 landed (`322e03e`), see above.
- Earlier work up to v0.12.0 (`3851e33`): buttons restyle, visual bib editor
  rows/toolbar, Zotero status dots, Rust-side Zotero transport, sources as
  a global preference (library removed), WebStorm-style layout, git change
  bars.
