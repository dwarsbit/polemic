# Handoff notes

Working notes for ongoing work. Update this file when a session ends or a
phase finishes, so work can continue on another machine. Newest entries at
the top under "Current status"; older phases move down to "History".
Keep it short: what is done, what is in progress, what is next, how to
verify. Commit each phase with a useful message and push to
`origin/main`.

## Current status — Visual editor v2, Phase 3 starting (2026-10-06)

Phase 2 landed (see the next section); the Phase 3–4 plan is scoped
in its own section below. Step 0 of Phase 3 is done: the
`comment-anchor.test.ts` failure was a broken test, not a broken
implementation — the fixture shifted the anchor by one line (inside
the 30-line window, so the fallback never ran) and expected line 7,
where the target text sat on line 5. Rebuilt the fixture to push
the anchor 40 lines out of the window and assert its true line.
Suite all green (377/377); `pnpm tsc` clean.

Next: Phase 3 item 1 — footnotes as inline pills.

Phase 3 item 1 landed (footnotes as inline pills):
- `footnote` inline atom with verbatim `src` (parse/serialize/
  idempotence tests in `parse-serialize.test.ts`); nested braces
  kept, `\footnotemark`/`\footnotetext` stay raw.
- Superscript chip preview carrying the note text (dashed border,
  ellipsis-clipped, full note in the hover title); raw editor opens
  on node selection — the math pattern — and commits as one undo
  step; typed `\footnote{…}` converts on the closing brace
  (closing-brace rule matches brace-free bodies only; nested
  content still arrives via paste/parse).
- DOM tests: `footnote.dom.test.ts`.

Next: Phase 3 item 2 — list item labels.

Phase 3 item 2 landed (list item labels):
- `ListItemView` node view on `listItem`: `\item[label]` shows as a
  chip floated beside the first content line, reading as the marker
  (`list-style: none` on labeled items — LaTeX replaces the bullet
  with the label); unlabeled items carry a "+" chip in a reserved
  left gutter, revealed on hover.
- Both chips edit via the meta-pill input pattern: Enter/blur
  commits a `setNodeMarkup` label change (one undo step), Escape
  reverts, an empty commit removes the label.
- DOM tests: `item-label.dom.test.ts`; stability case for
  `\item[a]` in `parse-serialize.test.ts`.

Follow-up fixes (user feedback, 2026-10-06):
- The "+" add chip was unclickable in the app: ProseMirror claimed
  the mousedown. The chip now follows the heading-cog pattern
  (mousedown preventDefault + stopEvent covering the chip), and an
  unchanged commit rebuilds the chip instead of leaving a stale
  input behind; while editing, the chip stays visible even when the
  mouse leaves the item (`vis-item-editing`).
- List markers were invisible: Tailwind preflight strips
  list-style app-wide and nothing restored it (predates the label
  work). `.visual-editor` now renders disc / circle / decimal.
- Code-face inserts (toolbar lists, dialogs, panels) landed
  multi-line snippets mid-line; `freshLineInsert` in
  `editor-insert.ts` frames block snippets with newlines when the
  cursor is not at a line boundary (tests:
  `editor-insert.test.ts`). The Visual face already parsed fragments
  into nodes, so it was unaffected. Known same-class gap: the
  wrap-in-figure scaffold still lands inline.

Phase 3 item 3 landed (theorem-env light polish, CSS only):
- Name line tightened: no stray top margin, the first paragraph of
  the statement joins it closely, and the trailing dot gets a hair
  of space after the title pill.
- QED chrome: the proof marker is now the real tombstone (U+220E,
  \qedsymbol — the old chrome showed an empty-set glyph) and rides
  the last line when the proof ends in a paragraph; a
  list/equation ending drops it to the next line, matching LaTeX
  without \qedhere.
- Accent left bar: unchanged (theorem and proof already share it;
  user-declared \newtheorem envs join via isTheoremEnv).

Phase 3 is complete. Next: Phase 4 item 4 — cursor across external
reloads (re-anchor in the `docVersion` effect when the file identity
didn't change).

## Visual editor v2, Phase 1–2 landed (2026-10-03)

Phase 1 is done, one commit per step, all pushed to `origin/main`.
Baseline for the suite: 367/368 green; the single failure is
pre-existing in `comment-anchor.test.ts` (`resolveAnchor` far-away
fallback), still unfixed.

### Landed (Phase 1)

1. `4eefcd9` — `envBlock` parse/serialize: quote/quotation/center/
   abstract + amsthm theorem family (opt kept for theorems); unknown
   envs stay byte-for-byte raw. Fixed a pre-existing parser bug found
   on the way: `findLiteral` consumed `\]`/`\)` markers via the
   escape skip, so bracketed display math degraded and paren math
   swallowed the file.
2. `bcb74fb` — `envBlock` views + CSS chrome, TextQuote toolbar
   button (wrap/lift), `> ` input rule opening a quote.
3. `382c7a2` — theorem modeling: `\newtheorem` harvest (comment
   aware, starred), name line with editable title chip (Enter
   commits, Escape reverts, empty clears), QED chrome for proof.
4. `15753ad` — heading controls: `#`…`#####` rules writing
   consistent cmd/level pairs (fixing Tiptap's built-in mismatched
   rules), toolbar level dropdown (Part…Subparagraph + Body text),
   Notion-style level chip (`[section]`, `[section*]`) in a reserved
   left gutter, visible on hover/caret, clickable (native menu);
   heading display sizes rebalanced.
5. `fa81cc4` — pill input rules: typed `\cite`/`\ref`/`\label`
   families convert on the closing brace, node selected so its raw
   editor opens.

Known quirk to keep in mind: a converted pill/math node is
node-selected, and typing with a node selection replaces the node —
tests must move the cursor first (same as the math tests).

### Next (Phase 3, from the plan above)

Phase 2 landed (2026-10-03):
- `ce021fc` — jumps stay in Visual: `anchorForLine` maps a source
  line to a face anchor (`-1` headingIndex for lines before the first
  heading), `posForAnchor` resolves it; the hidden CodeMirror view
  skips jump consumption while Visual is active.
- `b61374e` — pill hygiene badges: cite pills warn on keys no .bib
  defines, ref pills on undefined labels, label pills fade when
  unused; statuses recompute when the project's cross-file indexes
  change. Fixed the pre-existing nested pill chrome on the way.

### Phase 3–4 plan (detailed, scoped 2026-10-06)

The comment-anchor fix lands first as its own commit; then one
commit per item, tests with each. Suite baseline for the visual
phases: all green once step 0 lands.

Phase 3 — more modeled content:

0. Done (2026-10-06): the failing test was broken, not the code —
   the fixture never exercised the fallback (1-line shift, well
   inside the window) and expected a line the target never sat on.
   Rebuilt to push the anchor 40 lines out of the window.
1. Done (2026-10-06): footnotes — `\footnote{…}` becomes an inline
   pill node; parse/serialize round-trips it verbatim; in-place raw
   editor via the math-node pattern; input rule on the closing brace,
   mirroring the cite/ref/label family.
2. Done (2026-10-06): list item labels — `\item[label]` already
   round-trips; show the label on the first item line, edit in place
   (meta-pill input pattern, one-step attr change), add/remove a
   label from Visual.
3. Done (2026-10-06): theorem-env light polish — CSS pass on the
   name line and QED chrome only; theorems are fully modeled since
   Phase 1, so no modeling work.

Phase 4 — polish and performance (all three):

4. Cursor across external reloads — re-anchor in the `docVersion`
   effect (`setContent`) when the file identity didn't change;
   today only the face toggle preserves place.
5. Debounced serialization — debounce the `setContent`/`markDirty`
   side of `onUpdate` (whole-doc `serializeTex` per keystroke
   today); keep `anchorRef` immediate; the Code-face resync already
   tolerates a lagging store.
6. Editor settings — respect the `fontSize` setting in
   `.visual-editor` (Code already does); native spellcheck on
   prose text nodes, excluded on raw/pill/math nodes.

After Phase 4 the v2 plan is complete; per the roadmap's suggested
order, work resumes on multi-file navigation and project-wide
replace, before the PDF library build-out.

Design amendments (user feedback, 2026-10-03):
- The heading gutter holds a settings cog, not a text label
  ("Section" did not fit; the node type is one setting among
  several). The cog's tooltip names the kind; the menu is the
  level list as before. Gutter shrunk to 3rem.
- The preamble card carries a title metadata settings row
  (Title/Author/Date pills, the same machinery as the title card),
  editable with or without \maketitle; packages stay hidden behind
  the summary bar.

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
- **Heading level chip** (decided 2026-10-03, Notion-style): each
  heading shows a small mono chip — `[section]`, starred variants as
  `[section*]` — on hover and while the caret is in the heading.
  Placement: a **reserved left gutter** (constant strip left of the
  content column) so heading text never shifts. **Clickable**: the
  chip opens the same level menu as the toolbar dropdown
  (Part…Subparagraph, Body text) at the chip. Visual vocabulary:
  the raw-source/pill chip styles.
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
