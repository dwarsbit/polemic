# Polemic website

The landing page and documentation for Polemic, built with Next.js,
[Fumadocs](https://fumadocs.dev), Tailwind CSS and shadcn/ui. It exports to
static HTML, so any static host works.

## Development

```bash
cd website
pnpm install
pnpm dev
```

## Build

```bash
SITE_URL=https://example.org pnpm build   # static output in out/
pnpm start                                # serve out/ locally
```

`SITE_URL` is the site's public address, used for Open Graph image URLs.

## Layout

- `app/(home)/page.tsx`: the landing page, with `components/landing/`.
- `content/docs/`: the documentation as MDX; `meta.json` files set the sidebar order.
- `components/ui/`: shadcn components (button, badge and tabs are shared with
  the desktop app).
- `app/global.css`: the theme, the same tokens as the app's `src/index.css`.
