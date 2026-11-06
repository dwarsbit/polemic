# The browser build

Polemic also builds for the browser, from the same front end. It will run on
app.polemicapp.com next to the account pages and use the Polemic server for
projects, compiling and review. The plan has six steps; this is the first:
the build itself, with the desktop features it can't offer hidden.

```bash
pnpm dev:web      # http://localhost:1420
pnpm build:web    # dist-web/
```

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

`features` in `src/lib/target.ts` lists the desktop features the browser
leaves out:

- folders on this computer: open a folder, the projects folder, file pickers
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
