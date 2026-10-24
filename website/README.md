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

- `SITE_URL`: the site's origin, used for Open Graph image URLs.
- `NEXT_PUBLIC_BASE_PATH`: set when the site is served from a subpath, such as
  `/polemic` on GitHub Pages.

## Deploy

`.github/workflows/website.yml` builds the site on pull requests that touch
`website/`, and deploys it to GitHub Pages on pushes to `main`. Enable it once in the
repository settings: Pages → Build and deployment → Source: GitHub Actions.

## Layout

- `app/(home)/page.tsx`: the landing page, with `components/landing/`.
- `content/docs/`: the documentation as MDX; `meta.json` files set the sidebar order.
- `components/ui/`: shadcn components (button, badge and tabs are shared with
  the desktop app).
- `app/global.css`: the theme, the same tokens as the app's `src/index.css`.
