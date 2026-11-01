# Polemic content style

> This file is a copy of the **Content** section of the Polemic design system (https://claude.ai/artifact/3JkEix2wDtryweGKGMxZdX), the source of truth. Change the rules there first, then copy the file to polemic, polemic-server and polemic-website.

How Polemic writes. These rules cover every piece of public text: the editor's interface, the website, the docs, the server's pages and emails, READMEs and release notes. This section is the source of truth; each repository carries a copy as `CONTENT.md`. Change the rules here first, then copy the file to the repositories.

## Voice

Plain, precise and calm, for researchers and students who write papers.

- **Talk to the reader.** Address them as "you". Use "we" only for the Polemic project itself, in release notes and announcements.
- **Lead with what the reader can do**, not how it works internally. "Compile your project with Cmd/Ctrl + S", not "Polemic invokes latexmk on save".
- **Confident, not salesy.** State what Polemic does and let the reader judge. No superlatives ("best", "powerful", "blazing fast"), no hype ("seamless", "revolutionary"), no exclamation marks, no emoji.
- **No minimizers.** Drop "just", "simply", "easy", "obviously" and "it just works": what is easy for one reader is not for the next.
- **Name LaTeX things by their LaTeX names**: `\section`, preamble, BibTeX, `latexmk`. Readers know them; do not invent friendlier names.
- **Be honest about limits.** Say what Polemic does not do yet rather than hiding it.
- **Don't talk about internals.** Name a technology only if the reader sees, installs, configures or types it: LaTeX, BibTeX, Git, `latexmk`, TeX Live, MiKTeX, Zotero, SyncTeX. Never the frameworks, languages, libraries, databases, hosting or protocols Polemic is built with (React, Rust, Tauri, Tailwind and the like): describe what they do for the reader instead ("syncs in real time", not "uses CRDTs").
  - *Exception:* third parties that receive the reader's data (an AI provider, the payment processor) are named where it matters, such as the security and privacy pages. Honesty beats hiding internals.
  - *Out of scope:* developer documentation (READMEs, CONTRIBUTING, build docs) is written for contributors and may name the stack.

## Language

- **US English**: color, license, organize, behavior, catalog.
- **Contractions are fine** ("don't", "it's", "you'll"); they keep the tone relaxed.
- **Short sentences**, one idea each. Many readers are not native English speakers, so avoid idioms and wordplay.
- **Gender-neutral**: "they", "the author", "your co-author".

## Capitalization

- **Sentence case everywhere**: page titles, headings, nav, docs titles, buttons, menu items, dialog titles, tabs, table headers. "Download for macOS", "New file", "Compile and preview".
- Proper names keep their own case: LaTeX, BibTeX, Git, GitHub, Zotero, macOS, Polemic Professional.
- The only all-caps text is the logo.

## Punctuation

- **No serial comma**: "macOS, Windows and Linux". Add one only where a list would otherwise be ambiguous.
- **No full stop on headings** of any level, page titles or headlines. A question mark is fine ("Ready to write?").
- **Full stops on sentences**: body text, descriptions, help text and messages that form a sentence. Labels, buttons, tabs and table cells have none.
- **No em dashes.** Use a colon, comma, parentheses or a new sentence.
- **Colons introduce** a list, an example or an explanation; the word after a colon is lowercase unless it starts a full sentence that stands alone.
- **Ellipsis (…, one character)** for ongoing states ("Loading…", "Detecting…") and for menu items or buttons that open a dialog asking for more input ("Custom…", "Rename…"). Not for trailing off.
- **Ampersand**: write "and" in prose; "&" only in short labels where space is tight ("Figures & tables").
- **Quotes**: curly quotes (“ ” ‘ ’) in prose; straight quotes inside code.
- **Arrows**: "→" for menu paths (**File → New project**) and trailing "go to" links ("Manage packages →").

## Terminology

| Write | Not | Note |
| --- | --- | --- |
| Polemic | POLEMIC, polemic | All-caps only inside the logo |
| Polemic Professional | Pro, Premium, paid plan | The plan's name; "the Professional plan" in running text |
| LaTeX, TeX, BibTeX, biblatex, XeLaTeX, LuaLaTeX, pdfLaTeX | Latex, latex, LATEX, Bibtex | Always this casing, also in headings |
| TeX distribution | TeX install | TeX Live, MacTeX, MiKTeX by name |
| Git | git | `git` in code font only for the command |
| macOS, Windows, Linux | MacOS, OSX, Mac OS | |
| local-first | local first | |
| open source (noun), open-source (adjective) | Open-Source, opensource | "Polemic is open source", "an open-source editor" |
| project | workspace, document folder | A folder with your `.tex` and `.bib` files |
| snapshot | backup, version | Polemic's built-in history |
| review link | share link | The hosted link a reviewer opens |
| comment | note, annotation | |
| sign in, sign out (verbs), sign-in (noun) | log in, login | |
| email | e-mail | |
| PDF, DOI, arXiv | pdf, Arxiv | |
| Cmd/Ctrl + S | ⌘S, Command-S | Mac and Windows/Linux together, in `<kbd>` on the web |

Add a row whenever a new name comes up. Use one term per concept in every surface: if the editor says "snapshot", the docs and the website say "snapshot".

## Formatting

- **UI labels in bold** when docs refer to them: "open **Document settings**". Write the label exactly as the interface shows it.
- **Code font** for files, folders, commands, packages and macros: `main.tex`, `build/`, `latexmk`, `fontspec`, `\section`.
- **Keys** as `<kbd>Cmd/Ctrl</kbd> + <kbd>S</kbd>` on the web; "Cmd/Ctrl + S" in plain text.
- **Lists**: numbered for steps in order, bullets for everything else. Items are parallel (all verbs or all nouns). Items that are full sentences end with a full stop; fragments do not.
- **Links** say where they go ("see [comments](/docs/guides/comments)"), never "click here" or a bare URL in prose.

## Numbers, dates and units

- Numerals for 10 and above, words for one to nine, except for versions, sizes, keys, steps and anything the reader types or compares ("3 MB", "step 2", "4 spaces").
- Dates: "November 1, 2026"; in tight UI, "Nov 1, 2026". Relative times in lists ("2 hours ago").
- Versions: "Polemic 0.4", "version 0.4.1"; no "v" in prose (tags keep `v0.4.1`).
- Units with a space: "10 MB", "16 px". Times in 24-hour or with "a.m."/"p.m."; never mixed in one surface.

## The editor and server interface

- **Buttons and menu items start with a verb** and say what happens: "Insert table", "Share for review", "Delete row". Not "OK", "Yes" or "Submit" when a verb fits.
- **Confirmations name the action** in the title and the button: "Delete chapter2.tex?" with **Delete** and **Cancel**. State what cannot be undone.
- **Errors** say what happened and what the reader can do next, in that order, without blame or internal detail: "This link is invalid or has expired. Ask the author for a new one." Codes and stack traces go in the log, not the message.
- **Empty states** are a short label without a full stop ("No comments yet"), optionally followed by a sentence that says how to fill it ("Select text and press Cmd/Ctrl + M to comment.").
- **Placeholders** show an example, not an instruction: "10.1000/xyz123", not "Enter a DOI here".
- **Status and progress**: present participle with an ellipsis ("Compiling…"), then a plain result ("Compiled in 1.2 s", "3 errors").
- **Tooltips** name the control and its shortcut ("Bold (Cmd/Ctrl + B)"); no full stop.

## The website and docs

**Marketing pages**

- A headline is a short claim about what the reader can do ("Write LaTeX on your own machine"); the subheadline backs it with concrete facts.
- Every claim is true for the current release. Features that are not released yet say "Coming soon"; hosted features name their plan (Polemic Professional).
- Competitors (Overleaf, TeXstudio) are named only on Compare and in the FAQ, factually and without digs.
- No lorem ipsum or "Placeholder copy" in anything that ships: a section waits until its copy exists.

**Docs**

- Guide titles are tasks or topics ("Compile and preview", "Your first project"); reference titles are nouns ("Keyboard shortcuts").
- The `description` is one sentence, with a full stop, saying what the page lets you do.
- Open with the outcome, then the steps. Headings are tasks ("Create a project"), not labels ("Project creation").
- Callouts only for something the reader would otherwise get wrong; one or two per page at most.
- End with the next step when there is a natural one.

**Images** have alt text that says what they show ("The editor with the PDF preview on the right"); decorative images have empty alt.

## READMEs, release notes and emails

- **READMEs** open with one sentence on what the repository is, then how to run it. Same voice and rules as the docs.
- **Release notes** (`CHANGELOG.md`, GitHub releases) group changes under **Added**, **Changed**, **Fixed**, **Removed**, each item a sentence from the reader's side: "Comments now show in the PDF preview." Name the version and date in the heading.
- **Emails** from the server (sign-in links, review invites) have a subject that says what the email is for ("Your Polemic sign-in link"), one short paragraph, one button, and a plain-text fallback link.

## Checklist

1. US spelling, sentence case, no serial comma?
2. No internals: nothing the reader doesn't see, install, configure or type?
3. No full stop on headings; full stops on sentences only?
4. No em dashes, exclamation marks, emoji, superlatives or "just"?
5. Terms from the table, the same in every surface?
6. Buttons start with a verb; errors say what happened and what to do?
7. Every claim true for the current release, and no placeholder copy?
