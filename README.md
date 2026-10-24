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

## License

[MIT](./LICENSE)
