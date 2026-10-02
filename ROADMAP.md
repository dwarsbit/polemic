# Roadmap: From LaTeX Editor to Research & Writing Tool

Status of this document: a planning list for discussion; nothing here is
scheduled. The status column tracks progress per item (updated as work
lands; "—" means not started).

## 1. LaTeX — Writing experience

| Feature | What it does | Notes | Status |
|---|---|---|---|
| Multi-file navigation | Click `\input`/`\include` to open the target; breadcrumbs for the current file | Outline already spans files via `useDocumentOrder` | — |
| Structure editing in the outline | Drag or move-up/down sections, promoting/demoting levels | Builds directly on the outline tree | — |
| Project-wide search & replace | Grep across all `.tex` files, with math-delimiter awareness | The natural next tab for the bottom dock | Partly done: search shipped as a dock tool (`SearchPanel`, math/text scope filter); replace pending |
| Path completion | Autocomplete file paths inside `\input{}`/`\includegraphics{}` | Completion infra exists (`completion.ts`) | Done: core five commands, extension-less inserts |
| Package manager | Browse CTAN packages with descriptions, insert/remove `\usepackage`, check what is installed locally | CTAN JSON API + `kpsewhich`/`tlmgr` for local detection | Done: dialog (Cmd/Ctrl + Alt + P) with async background loading, per-project package list, install-state detection, docs link |
| Environment pairing | Typing `\begin{...}` auto-closes with a matching `\end{...}` | Transaction filter on the editor | Done |
| Label manager | Project-wide label index: reference counts, unused/undefined badges, jump to definition, rename refactoring across files | `label-refs.ts` + cross-file scan | Done: left-rail Labels tab with prefix groups, search, click-to-jump, F2/pencil inline rename (one undo step in the active file), undefined-references section |
| Figure/table/listing browser | A "document map" of floats with jump-to-source and caption status | Pairs well with the properties column | — |
| Table & TikZ assistants | Generate table skeletons, wrap figures, basic TikZ snippets | Stretch — high polish cost | Done (v1): table dialog, wrap-in-figure, five TikZ snippets, editor toolbar; cell-grid editing would be the next step |
| Compile profiles | XeLaTeX/LuaLaTeX engines, `draft`/`final` flags, per-project latexmk config | Currently pdflatex-only | — |
| Accurate word counts | `texcount`-style section-aware counts per file/chapter | Status bar count is a rough heuristic today | — |
| Paper wizards | New-project templates for ACM/IEEE/thesis with class files | Template system exists | — |

## 2. Research — Reading and collecting

| Feature | What it does | Notes | Status |
|---|---|---|---|
| PDF library | Import papers (drag-drop, arXiv/DOI fetch), metadata card, tags and folders | pdf.js is already bundled for the preview pane | — |
| Built-in PDF reader | Read papers in a dock; highlights and margin notes | Reuse the preview renderer | — |
| Highlights → document | Turn a highlighted passage into a `\blockquote`/`\emph` with an attached `\cite` | The killer loop: read → quote → cite | — |
| Full-text paper search | Index imported PDFs (Rust-side index, e.g. tantivy) for instant search | Keeps the local-first promise | — |
| Notes | Per-project markdown notes, linkable to papers and to document positions (like comments, but non-inline) | Comment anchor system is reusable here | — |
| Metadata enrichment | Optional online lookup: CrossRef/Semantic Scholar for abstracts, "cited by" | Should be opt-in; default stays offline | — |

## 3. Assets — Figures and data

| Feature | What it does | Notes | Status |
|---|---|---|---|
| Asset manager panel | Grid of images/PDFs in the project; drag into the editor inserts a ready `\includegraphics` with correct relative path and sensible width | Highest daily-payoff item in this category | Done (v1): left-rail Assets tab with thumbnail grid, copy-in import into `assets/`, smart per-type insert; linked external folders (`\graphicspath`) deliberately deferred. v2: search (name/folder/tags), file-type filter, tags (`.polemic/assets.json`), click-to-select inspector (dimensions, size, type, folder, date, tags), used-in-document detection; insert via double-click, drag still drops a figure |
| Image details | Dimensions, format, unused/missing detection (file renamed but still referenced) | Like `label-refs.ts` but for graphics paths | Partly done: dimensions, format, size, modified date, and unused detection live in the asset inspector; missing-reference detection (renamed file still referenced in the doc) remains |
| Figure navigator | All floats in the document: preview, jump to source, check captioned | Ships with the asset manager | — |
| Asset hygiene | Rename/move updates references; import converts formats LaTeX can't embed (e.g. SVG → PDF) | | — |
| Data → table | CSV import assistant generating `booktabs` tables or pgfplots plots | Stretch | — |

## 4. Bibliography — Citations

| Feature | What it does | Notes | Status |
|---|---|---|---|
| `.bib` entry browser | Table of entries with fields, search/filter; jump to entry in the file | `bibtex.ts` already extracts keys | Done (v1): Bibliography tab aggregating all project .bib files, grouped by type, search, click-to-jump, citation counts with unused badges, undefined-citations section, package-aware `\cite` insertion (context menu per loaded packages) |
| Entry editor & validation | Form editing with required-fields-per-type validation, duplicate key detection | | Done: dialog editor (key/type/fields, per-type required-field warnings, duplicate-key blocking, add/remove fields, auto-suggested key for new entries); edits apply in place preserving the .bib's formatting |
| Citation hygiene | Unused entries, missing keys (cited but not in `.bib`), key rename refactoring across files | `label-refs.ts` pattern extends naturally | Done: unused badges and undefined-citations section in the panel; missing-key warning in the editor lint; F2/pencil key rename refactors all .tex files plus the .bib entry, as one undo step in the active file |
| Import | Paste a DOI/arXiv ID → fetch BibTeX (online, opt-in); import from exported `.bib` | An online provider in Settings > Bibliography; its results copy into the project bibliography like any other source | — |
| Zotero integration | Zotero connections: the desktop app (local API, no key) and the cloud (Web API with key) — live query, no sync; entries convert at insert time | Zotero stays the source of truth; generated keys (surname+year, deduped against the project) | Done (v2): arbitrary Zotero sources in Settings > Bibliography (the app singleton + any number of cloud keys, each with its own label), searched live by "Add from Sources…". Desktop requests route through a Rust-side transport (zotero_local_fetch): Zotero drops connections that carry an Origin header, so webview fetches can never reach the local API. Caveats: BBT-style citekeys not read; cloud path untested against a real key |
| Biblatex support | Both bibtex and biblatex backends, style preview of rendered citations | | Partly: citation completion/insertion recognizes the biblatex and natbib command families (package-aware); backend-neutral otherwise |
| Source list | The user's collection of sources across projects; references flow from enabled sources into each project's bibliography | Sources list *providers*, not references: configured in Settings > Bibliography; references surface at insert time via the Bibliography panel's "Add from Sources…" search | Done (v3): sources are a global preference — any number of .bib files/folders anywhere on the filesystem (referenced in place, read-only; no copy-in) plus Zotero connections (at most one local app, any number of cloud keys) — with enable toggles; "Add from Sources…" groups results per source. The Polemic Library folder is gone. Next: a single-file view for editing external .bib/.tex; DOI/arXiv lookup as an online provider |

## Suggested order

1. **Asset manager + figure navigator** — smallest distance from what exists
   (file tree, completion), biggest writing friction removed.
2. **Citation hygiene + .bib browser** — completes the loop that
   `extractCiteKeys`/completion started.
3. **Multi-file navigation + project-wide search** — makes big projects usable.
   (Search half landed; navigation and replace remain.)
4. **PDF library + reader with highlights→cite** — the research differentiator,
   but the largest build; start once 1–3 stabilize.
5. **Compile profiles and the rest** — quality-of-life fills.

Guiding principle: every feature should feed the write → compile → revise
loop rather than bolt on a separate "research app". The highlights-to-citation
flow is where Polemic could genuinely beat Overleaf.
