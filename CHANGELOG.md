# Changelog

## 0.24.0 (unreleased)

### Changed

- The issues list says the most common LaTeX errors in plain words. "Undefined control sequence" becomes "Unknown command `\frrac`", with the command named even when the error is inside a macro or an argument. A missing package, image or file, a document that needs XeLaTeX or LuaLaTeX, a character pdfLaTeX can't print, a `$` or a brace that is missing and many more read the same way.
- Open an issue to see what to do about it, the source line with the place marked and TeX's own message.
- The error to fix first is on top and open. The errors after it fold into one row, since they usually disappear with the first. An error that repeats is one row that says how often.
- Warnings of one kind, such as citations without a bibliography entry or font variants that were replaced, are one row that lists each place.
- When a compile fails, the preview names the first error, and **Show the error** takes you to it.
- The issues list opens by itself when a compile starts to fail. If you close it, it stays closed until a compile works and a later one fails.
- The marks in the editor show the same wording.
- An open issue offers what Polemic can do about it: **Compile with XeLaTeX** or **Compile with LuaLaTeX** when the document needs another TeX engine, and a link to CTAN for a package or class that isn't found.
- **Fix** covers more errors and says what it will change: `\newcommand` for a command that exists and `\renewcommand` for one that doesn't, an environment that is never closed, a `}` forgotten at the end of a heading or command, and an image or included file whose name is close to one in the project, also when only capitals or the extension differ.
- **Ask AI** passes on what Issues says about the error, so the answer starts from there.
- An open issue links to the section of the guide to LaTeX errors on the website that covers it.

### Fixed

- Errors in files that TeX finds through the main file's folder now show in the issues list. Before, a project with its main file in a subfolder could fail with no error to show.
- A missing package, class or file now points at the line where the compile stopped. The "Emergency stop" that follows it is no longer listed as an error of its own.
- When a class or package stops because it needs XeLaTeX or LuaLaTeX, the issues list says so instead of showing only "Emergency stop".
- A failed BibTeX, glossary or index run is reported in the issues list. Before, some of these compiles failed with no error to show. BibTeX errors such as a repeated entry point at the line in your `.bib` file.
- **Fix** is offered for more errors, because Polemic now finds the source line that TeX prints below its help text.
- The hint about fonts that Polemic's server doesn't have no longer shows on the error that says a document needs XeLaTeX or LuaLaTeX.

## 0.23.0 (2026-11-11)

### Added

- A **Share** button in the toolbar, in the desktop app and in your browser. It opens a small panel where you invite someone by email and copy a review link. **Manage sharing…** opens the full dialog.
- Review links can be copied again later, on the computer where you made them. Before, a link was shown once.
- **Open from your account…** now asks where to keep a project that isn't on your computer yet: in your projects folder, or in a new or empty folder you pick. Projects that are already on this computer say so and open their folder.
- In your browser, the menu has **Open in the desktop app…**. It opens the project in Polemic on your computer, where you choose its folder, and it stays in sync with what you write in the browser. Without the desktop app, it points you to the download.

### Changed

- The **Share** dialog is simpler: people first, then review links, with less to read. Your first review link publishes the project for you, and **Publish again** shows reviewers your latest changes.
- The **Share** dialog mentions sync only when something needs your attention. The status bar still shows whether the project is synced.
- In your browser, an empty projects list says how to start: name a project and pick a template, or upload a zip of a project you have.

## 0.22.0 (2026-11-09)

### Added

- When you're signed in, your photo or initials show at the right end of the toolbar, in the desktop app and in your browser. Click it to see your plan, your storage and today's compile time, and to manage your account or sign out.

### Changed

- Your account shows how much of today's cloud compile you've used as a percentage, on every plan, Pro included.
- The accent color is now plum, the warm purple of the old app icon, in place of indigo: the app icon, buttons, links, focus rings, selected rows and the commands in the Polemic syntax theme.
- The interface and the visual view use DM Sans, the typeface of the Polemic logo and website, instead of your computer's system font. It comes with the app, so Polemic looks the same on every computer.

## 0.21.0 (2026-11-09)

### Added

- Shared projects now sync both ways with your Polemic account. What you save in the desktop app appears within seconds when you open the project in your browser, and changes made there arrive in the folder. A file you have open with unsaved edits takes in the changes and keeps yours. Changes you make offline sync when you're back online. Projects you shared before sync the next time you open them, after a one-time notice, and become editable in the browser. The status bar shows whether the project is synced, and **Share** opens it in your browser.
- **Open from your account…** on the start screen opens a project you made in your browser, or shared from another computer, in a new folder in your projects folder that stays in sync.
- A shared project inside iCloud Drive, Google Drive, Proton Drive, Dropbox or OneDrive gets a one-time warning, since two syncs on the same files can get in each other's way.
- Invite people to a shared project by email from **Share**, as editors or commenters. Editors work on the project in their own desktop app or in the browser with a free account, and what they add counts toward your storage. You can change what each person can do, cancel invites and remove people. A project someone shared with you shows whose it is, and you can leave it.
- A shared project with a Git remote, that other people work on too, gets a one-time notice: their changes already arrive through Polemic, and conflict markers from a Git merge would reach everyone.
- Shared projects have online snapshots, kept once an hour while anyone works on them: all of the last two days, then one a day for 30 days. They don't count toward your storage. **Online snapshots** in the desktop app, and **Snapshots** in the browser, show what changed since one, and the owner and editors can restore the whole project or a single file for everyone. Comments stay as they are, and the project as it was before is kept as a snapshot, so a restore can be undone.

### Changed

- The assistant's modes are now **Syntax** and **Prose**. Syntax fixes LaTeX and leaves your text alone. Prose polishes your wording and never changes what your text says: a change that would alter a citation, reference, math, a number or a "not", or that spans more than one paragraph, is held back. LaTeX becomes Syntax and Both becomes Prose.
- **Share for review** is now **Share**, since it also invites people.
- The account card in Settings is redesigned. Signed in, it shows your photo from Google, Apple or Microsoft sign-in (or your initials), your plan, and how much storage and compile time you've used today. Signed out, **Create account** opens the sign-up form in your browser. The server field is now behind **Use custom server**.

## 0.20.0 (2026-11-07)

### Added

- **Settings → Account** links to your account page, where you can download a copy of your data or delete your account, and to the privacy policy.

## 0.19.0 (2026-11-06)

### Changed

- Polemic has a new look. The app icon is a white page with a slash on an indigo tile, and indigo is now the one accent color: buttons, links, focus rings, selected rows and the commands in the Polemic syntax theme. Text fields have the same rounded corners as buttons, with a border. Open files are flat tabs with an indigo underline, the dot for unsaved changes is amber and the start screen sits on a plain background, picks the template from one row and shows when you last opened each recent project.
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
