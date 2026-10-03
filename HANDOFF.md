# Handoff notes

Working notes for ongoing work. Update this file when a session ends or a
phase finishes, so work can continue on another machine. Newest entries at
the top under "Current status"; older phases move down to "History".
Keep it short: what is done, what is in progress, what is next, how to
verify.

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

Pick up visual-editor polish where it left off; concrete ideas should be
listed here before starting.

### Verify

- `pnpm test` / `pnpm tsc` (check `package.json` scripts before running;
  round-trip tests live in `src/lib/visual` and `src/lib/*.test.ts`).

## History

- 2026-10-02: Visual editor v1 landed (`322e03e`), see above.
- Earlier work up to v0.12.0 (`3851e33`): buttons restyle, visual bib editor
  rows/toolbar, Zotero status dots, Rust-side Zotero transport, sources as
  a global preference (library removed), WebStorm-style layout, git change
  bars.
