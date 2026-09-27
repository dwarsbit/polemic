# Polemic

An open source, local-first LaTeX editor. Write LaTeX with a code editor and
live PDF preview, compiled on your own machine with your own TeX distribution.
Think of it as a lightweight, desktop Overleaf alternative.

## Status

Pre-alpha. The application shell, LaTeX editor, document outline, and TeX
distribution detection are in place. Compilation, project management, and the
PDF preview pane are upcoming.

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
