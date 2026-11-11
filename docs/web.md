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
its origin for cookies and live sync. The app shows nothing until
`/api/auth/get-session` names an account (`src/web/start.tsx`): signed out,
it sends you to the server's `/sign-in`, which the dev server doesn't have,
so sign in through `/api/auth/sign-in/email` instead. An answer that isn't
the API's JSON, such as the app's own page from a proxy that sends `/api`
to the wrong container, fails with a message rather than a parse error.

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
  tree and reach the open file once it has no unsaved edits.
- New projects start from the desktop app's templates: `src/lib/templates.ts`
  reads the table in `src-tauri/src/templates.rs` at build time, so there is
  one list.
- Files come in through the browser's file picker or a drop on the editor
  (`src/web/uploads.ts` names picked files for `import_assets`), and a zip
  makes a new project. Both go through `readSnapshot`, as a desktop publish
  does: the same excludes, text into the document, other files uploaded as
  assets first. The app menu downloads the PDF and the project as a zip.
- Projects shared from the desktop app sync both ways with their folder
  (source `linked`, see `src/lib/link-sync.ts`), so they are edited here
  like projects made here. Only projects published one way by a desktop
  app from before linked projects (source `desktop`) open read-only, as
  do projects you can only comment on or view, and projects whose owner's
  storage is full (the server connects them read-only).
- The start screen shows storage and today's compile time from
  `GET /api/usage`; a full storage or used-up compile time says so where it
  stops you, with a link to the account page.
- Compiling waits until the server has every edit, then asks
  `POST /api/projects/:id/compile` with the engine the desktop app would
  pick (`src/lib/engine.ts`). The log, SyncTeX and bibliography output are
  read in the browser: `src/lib/logparse.ts` and `src/lib/synctex.ts` are
  ports of the desktop app's Rust parser and the review page's SyncTeX
  reader, with their tests.
- Presence (`src/web/presence.ts`) travels as awareness on the sync
  connection: each tab shares the file it has open and its cursor, as
  relative positions in that file's Y.Text. The server sets whose state it
  is from the connection's account, so names can't be faked. The top bar
  shows who else is in the project, and the code editor shows their cursors
  and selections (`src/lib/remote-cursors.ts`).
- Edits from others come into the code editor as changes outside its undo
  history (`applyRemoteContent`), so your cursor, selection and undo stay;
  behind the Visual face the file reloads.
- Comments from others (collaborators, or reviewers on a review link) show
  up as they arrive: a remote change to a file in `.polemic/comments/`
  reloads the Comments panel. Suggestions carry the account's name unless
  another one is set in the settings.

## Review and writing aids

- **Share** (`src/web/review.ts`) answers the desktop app's
  `share_*` commands for the open project. The project already is the
  server's, so publishing waits for every edit to reach the server, uploads
  this tab's last PDF and SyncTeX as assets, then posts the snapshot. Only
  the owner publishes and invites people; one published from the desktop
  app is shared from there. Someone invited can leave the project. There is
  no "Stop sharing": the server's copy is the project. A review link's
  address comes back only when the link is made, so the app keeps the ones
  made in this browser (`src/lib/review-links.ts`) to copy them again.
- **Open in the desktop app…** in the app menu hands the open project to
  the desktop app with a `polemic://open?project=<id>` link, and says
  what to do when no app answers. The app then asks where to keep the
  project (see [linked-projects.md](linked-projects.md)).
- Spelling runs in the browser: `src/lib/spell.ts` is a port of
  `src-tauri/src/spell.rs` with the same English word list (loaded on first
  use) and suggestions. Downloaded languages go to Cache Storage; words
  added to the dictionary to local storage.
- Grammar goes to the server's LanguageTool at `/api/grammar/v2/check`
  with the session cookie, on every plan. `src/lib/languagetool.ts` ports
  the desktop client: blocks joined into as few checks as the server's
  limit allows, issues split back, a 429's wait honored. There is no
  built-in checker, so no choice of checker.
- DOI lookup asks doi.org from the browser, when online lookup is on.

`features` in `src/lib/target.ts` lists the desktop features the browser
leaves out:

- folders on this computer: open a folder, the projects folder, saving to a
  place you pick (files are picked and downloaded instead)
- Git and the snapshots kept on this computer (the **Snapshots** panel shows
  the server's instead; see [linked-projects.md](linked-projects.md))
- TeX on this computer and the choice of where to compile
- the desktop sign-in (the browser uses the site's session)
- the assistant
- the built-in grammar checker, and with it the choice of checker
- reference sources outside the project: .bib files and Zotero

Components check those flags rather than the target, so each hidden feature
says why it is hidden. The browser gets an app menu in the top bar for what
the desktop app keeps in its menu bar.

The desktop build doesn't change: without `--mode web` the aliases are off
and every flag is on.
