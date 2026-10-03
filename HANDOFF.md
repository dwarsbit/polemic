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

## History

- 2026-10-02: Visual editor v1 landed (`322e03e`), see above.
- Earlier work up to v0.12.0 (`3851e33`): buttons restyle, visual bib editor
  rows/toolbar, Zotero status dots, Rust-side Zotero transport, sources as
  a global preference (library removed), WebStorm-style layout, git change
  bars.
