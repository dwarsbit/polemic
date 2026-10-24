# Polemic

An open source, local-first LaTeX editor. Write LaTeX with a code editor and
live PDF preview, compiled on your own machine with your own TeX distribution.
Think of it as a lightweight, desktop Overleaf alternative.

## Status

Pre-alpha. Working today: projects and templates, a code editor and a
visual editor for `.tex` and `.bib` files, compilation with `latexmk`,
a live PDF preview with SyncTeX navigation, snapshots and git, comments,
references (BibTeX and Zotero), and an optional AI quickfix for compile
errors. See [ROADMAP.md](./ROADMAP.md) for what comes next.

## Security notes

Opening a project folder you received from someone else is safe to
compile: Polemic runs `latexmk` with `-norc`, so a `latexmkrc` inside
the project never runs (your own `~/.latexmkrc` still applies), and git
runs with every command-running setting from the project's `.git/config`
blanked and git hooks switched off.

## Requirements

- Node.js 20+ and pnpm
- Rust (stable) with cargo
- A TeX distribution on your PATH: TeX Live, MacTeX, or MiKTeX
  (including `latexmk`)

## Development

```bash
pnpm install
pnpm tauri dev
```

## Build

```bash
pnpm tauri build
```

## Releasing

Push a `vX.Y.Z` tag. CI runs the test suite, then builds for macOS
(Apple Silicon and Intel), Linux, and Windows with that version and
attaches the installers to a draft GitHub release.

macOS builds are signed and notarized when these repository secrets
are set (otherwise they stay unsigned):

| Secret                       | Value                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `APPLE_CERTIFICATE`          | `base64 -i cert.p12 \| tr -d '\n'` of the Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password of the `.p12` export                                                  |
| `APPLE_SIGNING_IDENTITY`     | e.g. `Developer ID Application: Name (TEAMID)`                                 |
| `APPLE_ID`                   | Apple ID email                                                                 |
| `APPLE_PASSWORD`             | App-specific password for that Apple ID                                        |
| `APPLE_TEAM_ID`              | Apple Developer team ID                                                        |

## License

[MIT](./LICENSE)
