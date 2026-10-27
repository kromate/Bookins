# Bookins brand and interface rules

Direction: **Day Rail, the booked slot.** Bookins is a day: a vertical time rail, with appointments sitting on it as slots. Every brand surface is built from that one idea, so the logo, the Today screen, a time chip on the guest page and the favicon are recognisably the same object.

## Mark and wordmark

- **Mark.** A lowercase *b* drawn on a 32-unit grid. The indigo stem is the time rail. The marigold bowl is a booked slot: square on the rail side, rounded on the open side. The ink bar inside is the entry written into that slot.
  - stem `M5 4.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5V29H5z`
  - slot `M11 13H22a7 7 0 0 1 7 7v2a7 7 0 0 1-7 7H11z`
  - entry `rect x=15.5 y=19.75 w=9 h=2.5 rx=1.25`
- **Wordmark.** "bookins" in lowercase, drawn as stroked paths (stroke 3.4 in a 100 x 26 box) with slot-shaped bowls, so it renders identically everywhere without a web font.
- **Lockup.** viewBox `0 0 156 32`, wordmark at `translate(38 0.6) scale(1.18)`.
- **Clear space:** half the mark's width on every side. **Minimum size:** 16px for the mark, 96px wide for the lockup.
- **Do:** use it on canvas, white or indigo (inverse); use the one-colour version (`mono`) when only one ink is available.
- **Don't:** recolour the slot, rotate or outline the mark, set the wordmark in a font, or put the lockup on a photo.

The component is `components/BookinsLogo.vue` (`compact` = mark only, `inverse`, `mono`, `decorative` when the word "Bookins" is already written next to it).

## Colour

| Role | Token | Hex | Use |
| --- | --- | --- | --- |
| Accent | `--accent` | `#2E3FA8` indigo | Actions, links, selected states, the rail |
| Now | `--now` | `#F2B33D` marigold | Only: the now-line, today, and items that are due. Never a button. |
| Ink | `--ink` | `#1A1F3D` | Text |
| Canvas | `--canvas` | `#F4F5F8` | Page background |
| Line | `--line` | `#DDE1EA` | Borders, dividers |
| Muted | `--muted` | `#5B6273` | Secondary text (4.5:1 or better on white) |
| Done | `--success` | `#1F7A55` | Completed, saved |
| Danger | `--danger` | `#B42318` | Destructive actions, errors |

Status is never colour alone. `.status` pairs a shape with the word: confirmed is a filled dot, completed a green dot, no-show a hollow red ring, cancelled a dashed ring with struck-through text.

## Type

System UI fonts only (`ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`); no web font to load or license. Tabular figures (`.tnum`) for every time, count and price. Sentence case everywhere: no uppercase labels, no eyebrows above headings, no middle dots as separators (use commas or line breaks). Ranges use an en dash for display (`10:00–18:00`).

## Tokens

`css/global.css` has three tiers:

1. **Primitives:** `--n-*` neutrals, `--indigo-*`, `--marigold-*`, green, red and amber, `--space-1..8`, `--radius-*`.
2. **Semantic:** `--canvas`, `--surface`, `--surface-soft`, `--surface-sunken`, `--line`, `--line-strong`, `--ink`, `--ink-soft`, `--muted`, `--faint`, `--accent*`, `--now*`, `--success*`, `--danger*`, `--warning*`, the type scale and `--shadow-1..3`.
3. **Component:** `--control-h`, `--card-padding`, `--focus-ring`, `--slot-*`, shell sizes, and the `--gm-*` bridge that brands the shared Goalmatic controls.

Pages use semantic tokens, never raw hex. The guest page (`pages/Book.vue`) has its own small token set because hosts choose its theme.

## The signature: the slot

`.slot` is a 4px left stem with `border-radius: 2px 6px 6px 2px`, driven by `--slot-stem` and `--slot-fill`. It is used for appointments on the Today rail and the Bookings week, time chips on the guest page, the Next up card, the confirmation reference card, notices (the stem carries the tone), and the active item in the sidebar. `DayBar` draws open hours to scale on the same rail (Availability, Team); `SlotMeter` shows a service's length against its start-time interval (Services).

## Guest booking page

The booking page belongs to the host. The header carries no Bookins logo and never links away; the host's name is the one `h1`; the footer reads "Booked with Bookins" with a small one-colour mark, not a link. Themes (`booking-appearance.ts`) keep their stored IDs: Indigo `#2e3fa8`, Sage `#2f6b52`, Sand (brass `#6f4e0f` on `#f5f1e8`) and Midnight (`#a9b6ff` on `#141833`, with dark text on the accent). Time chips are at least 48px tall with 15px text.

## Accessibility and motion

- Every control is at least 40px (44px or more on touch). Focus is a visible 3px ring.
- Text meets WCAG AA contrast; the marigold "now" colour is never used for text on white.
- Motion is short (160–200ms) and fully disabled under `prefers-reduced-motion`.
- Menus are `<details data-menu>`: Escape and an outside click close them (handled once in `App.vue`).

## Assets

Sources (SVG) and renders (PNG) live in `public/bookins/`:

| File | Size | Use |
| --- | --- | --- |
| `mark.svg`, `mark-mono.svg` | 32 | Mark, full colour and one colour |
| `logo.svg`, `logo-inverse.svg`, `logo-stacked.svg` | lockups | Documents, the boot screen |
| `favicon.svg`, `favicon-32.png` | 32 | Browser tab (indigo tile) |
| `favicon.svg`, `favicon-64.png` | 64 | Favicon upload in Goalmatic App settings |
| `touch-icon.svg`, `apple-touch-icon.png` | 180, full bleed | iOS home screen |
| `app-icon.svg`, `app-icon-512.png` | 512, full bleed | App icon in source |
| `app-icon.svg`, `app-icon-1024.png` | 1024, full bleed | Icon upload in Goalmatic App settings |
| `og.svg`, `og.png` | 1200 x 630 | Social card and og:image upload (no text, so it works in any language) |
| `brand-sheet.svg`, `brand-sheet.png` | 1600 x 1000 | This page, on one sheet |

The PNGs are rendered from the SVGs with Sharp by the QA helpers `render-brand-assets.cjs` and, for the two upload sizes, `render-release-assets.cjs`. Both check every output size; the upload PNGs are the same artwork at a larger size, not a new design.

## Release gates for the brand

- The hosted App's icon, favicon and og:image are still the remote assets referenced in `.goalmatic/app.json` and the SEO plugin. The App settings uploader needs an icon of 1024 x 1024 (PNG or WebP, under 5 MB), a favicon of at least 64 x 64, and a 1200 x 630 og:image under 5 MB. Upload `app-icon-1024.png`, `favicon-64.png` and `og.png` there, then confirm the hosted page serves them before release. `app-icon-512.png` and `favicon-32.png` are too small for the uploader. This source does not change the asset IDs or URLs; update them only from what the upload actually returns.
- Check the guest page in all four themes on a real phone, including Midnight's dark text on the accent.
