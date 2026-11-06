# Changelog

## 0.19.0 (unreleased)

### Changed

- Polemic has a new look. The app icon is a white page with a slash on an indigo tile, and indigo is now the one accent color: buttons, links, focus rings, selected rows and the commands in the Polemic syntax theme. Open files are flat tabs with an indigo underline, the dot for unsaved changes is amber and the start screen sits on a plain background.
- The online services now come with every Polemic account, on the Free, Student and Pro plans. Grammar checking in every language, cloud compile and review links work on the Free plan too; the plan sets your storage, your compile time each day and how many review links work at once. **Settings → Account** shows your plan.
- When your plan's compile time for the day is used, the preview says so and offers to compile on this computer. Review links your plan has paused show as **Paused** in **Share for review**.
- When a file you have open changed in another program or through Git, the editor now takes in the change when you come back to Polemic and keeps your cursor, selection and undo history. Before, it reloaded the file.

### Fixed

- Picking a spelling language that has to be downloaded now switches to it right away. Before, the setting kept showing English and words already marked weren't checked again until you reopened Polemic.
- When Polemic can't load your recent projects, the start screen now says so. Before, it kept showing **Loading…**.

## 0.18.0 (2026-11-05)

### Added

- Assistant: a chat in the right sidebar that helps with LaTeX errors, packages, tables, floats, math and layout. It reads your project, proposes changes you review as diffs and, once you allow it, compiles to check a fix. A menu picks what it helps with: LaTeX, your text or both. In LaTeX mode, a change that edits your words shows a warning. Right-click in the editor to ask about the selection.

### Changed

- **Ask AI** on an issue now opens the assistant with that error, so you can follow up on the fix. The assistant needs a model that supports tool calls.
- The assistant's question field is now one card: the context chips sit on top, the field grows as you type, and the mode picker, the model in use and the send button sit below. Click the model name to open the settings.
- The assistant settings now start from a provider: Mistral, OpenAI, Anthropic, Ollama, LM Studio or a custom OpenAI-compatible endpoint. Each one fills in its address, asks for a key only when it needs one and lists the models you can pick, with **Load models** to fetch them from the provider. Local providers run without a key.

### Fixed

- Errors raised inside a package, such as fontspec saying it needs XeLaTeX or LuaLaTeX, now show in the issues list. Before, these compiles failed with no error to show.
- Automatic engine choice picks XeLaTeX or LuaLaTeX for more projects: those whose own class or style files load fontspec, Chinese and Japanese documents (ctex, xeCJK, luatexja), and projects whose latexmkrc names the engine.

## 0.17.0 (2026-11-05)

### Fixed

- The Windows installer is now signed, so Windows no longer warns that it comes from an unknown publisher.

## 0.16.0 (2026-11-05)

### Added

- Projects with a glossary or a nomenclature now compile with the list filled in.

### Changed

- Editor tabs scroll sideways with the mouse wheel, show a thin scrollbar on hover and fade at the edges where more tabs are hidden. The active tab stays in view.
- A project without `main.tex` now opens with its main file rather than the first chapter.

### Fixed

- Projects with chapters in subfolders now compile.
- A main file in a subfolder now finds its chapters, bibliography and figures.
- Long compile errors now show in full, and warnings point to the file they come from.
- While a compile has errors, the issues list no longer fills up with undefined citations and references that only follow from them. Errors come first and each issue is listed once.

## 0.15.0 (2026-11-04)

- Share for review (Professional): publish a project to your Polemic server and make review links that open its source and PDF in a browser.
- Comments that reviewers write on the review page arrive in the Comments panel with their name, and you can reply to them.

## 0.14.0 (2026-10-30)

Initial release! 🎉
