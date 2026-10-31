# polemicapp.com — website plan

Replaces `polemic/website` (Next.js + Fumadocs, deployed to GitHub Pages under `/polemic`).
Built on the Tailwind Plus **Oatmeal** template (mauve / Instrument Serif variant).

## Stack

- Next.js 16, static export (`output: "export"`), Tailwind v4, `@tailwindplus/elements`.
- Oatmeal `components/elements`, `sections`, `icons` copied in as-is (only the ones we use).
- Docs: keep **Fumadocs** (MDX, search, sidebar, `llms.txt`), restyled with the Oatmeal
  tokens (mauve palette, Instrument Serif headings, Inter body) so it looks like the rest of the site.
- Placeholder images: one `<Placeholder label="…">` component, swapped for real screenshots later.

## Sitemap

| Route | Template sections | Content now |
| --- | --- | --- |
| `/` | Hero centered with demo, features three-column, features alternating, CTA | Dummy |
| `/features` | Hero simple centered, features stacked alternating (one block per feature, links to its guide) | Dummy |
| `/pricing` | Pricing hero (monthly/yearly toggle) with **Community** and **Professional**, plan comparison table, FAQ | Dummy, placeholder prices |
| `/compare` | Hero, comparison table Polemic / Overleaf / TeXstudio, short summaries, CTA | Dummy |
| `/download` | Hero with primary button for the visitor's OS, cards per OS with every installer, TeX requirement | Links to GitHub Releases |
| `/docs/guides/…` | Fumadocs, tab "Guides" | Existing docs migrated (or dummy, see questions) |
| `/docs/reference/…` | Fumadocs, tab "Reference" | Dummy (shortcuts, settings, compile options, security…) |
| later | `/privacy`, `/terms`, status link | Template `document-left-aligned` section |

Navbar: Features · Pricing · Compare · Docs — Log in (→ `app.polemicapp.com/sign-in`) · **Download**.
Footer: Product / Docs / Community / Legal (legal links added later).

## Download links

Release assets carry the version in the name (Tauri), so `releases/latest/download/<name>` can't be fixed.
Plan: fetch the latest published release from the GitHub API **at build time**, map assets to
macOS arm64/x64 `.dmg`, Windows `.exe`/`.msi`, Linux `.AppImage`/`.deb`/`.rpm`, and trigger a site rebuild
from `release.yml` when a release is published. A small client script picks the primary button by OS.

## Hosting

- `polemicapp.com` (apex) for the site; `app.polemicapp.com` stays the services app (polemic-server).
- Keep `.github/workflows/website.yml`; drop the `/polemic` base path, add `public/CNAME`.
- Old Pages URLs (`/polemic/docs/...`) → redirect to the new domain.

## Steps

1. Scaffold new site in `website/` (template elements, theme, fonts, layout, nav, footer).
2. Pages: home, features, pricing, compare, download (dummy content + placeholders).
3. Docs: Fumadocs with Guides/Reference tabs, Oatmeal theme, search, `llms.txt`, OG images.
4. Build-time release fetch for download links.
5. Deploy changes (domain, CNAME, workflow), README update.
6. Check: lint, types, build, screenshots desktop/mobile, light/dark.

## Decisions

- Docs: Fumadocs, restyled with Oatmeal tokens.
- Existing docs migrate into Guides (shortcuts and security into Reference); dummy pages fill the gaps.
- Hosting: GitHub Pages with a custom domain (`CNAME` → polemicapp.com).
- Pricing: placeholder prices (€X / €XX) for now.
