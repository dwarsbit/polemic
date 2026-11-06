# The browser build

Polemic also builds for the browser, from the same front end. It runs at
`/projects` on the Polemic server's own origin (app.polemicapp.com), next to
the account pages, and keeps projects on the server: you sign in on the
site, pick or create a project, edit it with changes saved as you type, and
compile it on the server with the PDF, issues and SyncTeX in the preview.

```bash
pnpm dev:web      # http://localhost:1420/projects/
pnpm build:web    # dist-web/, served at /projects/
```

`pnpm dev:web` passes `/api` on to a Polemic server running locally
(`POLEMIC_SERVER`, default `http://localhost:4000`, the API without Caddy).
Start that API with `PUBLIC_URL=http://localhost:1420`, so the dev server is
its origin for cookies and live sync. Signed out, the app sends you to the
server's `/sign-in`, which the dev server doesn't have: sign in through
`/api/auth/sign-in/email` instead.

The image in `docker/web` serves the build with Caddy; the Web image
workflow pushes it to `ghcr.io/dwarsbit/polemic-web` from main, and
polemic-server's Compose stack routes `/projects` to it.

## How it works

The front end reaches the desktop app through a few Tauri modules: commands
through `invoke` (all in `src/lib/tauri.ts`), dialogs, link opening and the
app version. `--mode web` points those imports at `src/web/` instead
(`vite.config.ts`):

| Tauri module                | Browser version                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@tauri-apps/api/core`      | `src/web/core.ts`: answers commands in the browser. Commands without an answer yet fail with "This isn't available in your browser yet." |
| `@tauri-apps/plugin-dialog` | `src/web/dialog.ts`: `ask` shows the app's own confirm dialog; file pickers return nothing                                               |
| `@tauri-apps/plugin-opener` | `src/web/opener.ts`: links open in a new tab                                                                                             |
| `@tauri-apps/api/app`       | `src/web/app.ts`: the version from `package.json`                                                                                        |

Settings live in the browser's local storage, in the same shape as the
desktop app's settings file (`src/web/settings.ts`).

## Projects

A project is the server's live document for it (layout in
`src/lib/project-doc.ts`), not a folder. `src/web/projects.ts` answers the
project, file, comment and compile commands from that document:

- The project list comes from `GET /api/projects`; a project's path in the
  editor is `/projects/<id>`, which is also its address in the browser
  (`src/web/session.ts` keeps the two in step).
- Opening a project connects to `/api/sync` with the session cookie and
  waits for the server's copy. Files are the document's texts and assets;
  folders exist through their files (an empty one lasts until the tab
  closes). `.polemic/` holds the comments, `project.json` and
  `assets.json`, as on disk.
- Edits save after a short pause in typing. A save carries the text the
  edit started from, and `applyTextMerge` moves the edit past changes
  others made since, so both are kept. Changes from others reload the file
  tree and the open file once it has no unsaved edits.
- New projects start from the desktop app's templates: `src/lib/templates.ts`
  reads the table in `src-tauri/src/templates.rs` at build time, so there is
  one list.
- Files come in through the browser's file picker or a drop on the editor
  (`src/web/uploads.ts` names picked files for `import_assets`), and a zip
  makes a new project. Both go through `readSnapshot`, as a desktop publish
  does: the same excludes, text into the document, other files uploaded as
  assets first. The app menu downloads the PDF and the project as a zip.
- Projects published from the desktop app open read-only (the server
  refuses browser writes to them until linked projects); so do projects
  you can only comment on or view, and projects whose owner's storage is
  full (the server connects them read-only).
- The start screen shows storage and today's compile time from
  `GET /api/usage`; a full storage or used-up compile time says so where it
  stops you, with a link to the account page.
- Compiling waits until the server has every edit, then asks
  `POST /api/projects/:id/compile` with the engine the desktop app would
  pick (`src/lib/engine.ts`). The log, SyncTeX and bibliography output are
  read in the browser: `src/lib/logparse.ts` and `src/lib/synctex.ts` are
  ports of the desktop app's Rust parser and the review page's SyncTeX
  reader, with their tests.

`features` in `src/lib/target.ts` lists the desktop features the browser
leaves out:

- folders on this computer: open a folder, the projects folder, saving to a
  place you pick (files are picked and downloaded instead)
- Git and snapshots
- TeX on this computer and the choice of where to compile
- the desktop sign-in (the browser uses the site's session)
- the assistant
- spelling and grammar checks
- reference sources outside the project: .bib files and Zotero

Components check those flags rather than the target, so each hidden feature
says why it is hidden. The browser gets an app menu in the top bar for what
the desktop app keeps in its menu bar.

The desktop build doesn't change: without `--mode web` the aliases are off
and every flag is on.
