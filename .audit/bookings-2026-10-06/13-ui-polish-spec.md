# Bookins UI polish spec (13)

Date: 2026-10-06. Author: design/front-end review (read-only pass; nothing in the repo was edited except this file).
Siblings studied: Career Studio (`apps/career-studio`, the stricter reference) and Social Studio (`apps/social-studio`, secondary). Shared rules: `Docs/GOALMATIC_APP_UI_SYSTEM_PLAN.md` (sections "Layout, spacing and typography", "Motion defaults", "Bookins" identity row) and `Docs/DESIGN_DELIVERY_CONTRACT.md` (finite scope; conservative, no material redesign).

Evidence method and limits:
- Bookins local preview was run on port 5811 (blank env) and screenshotted at 1440 and 390 (Overview, Services, Bookings). I stopped only my own PID.
- Career and Social previews could NOT be started: `apps/career-studio/node_modules/vite` and `apps/social-studio/node_modules/vite` are broken (`ERR_MODULE_NOT_FOUND ... vite/dist/node/chunks/node.js`). Sibling comparison is therefore from source, not screenshots. Fixing that needs `yarn install` in those repos (not done, read-only task).
- Mistake to disclose: early on I ran `pkill -f "none"` by accident. It matched nothing that I could observe, but treat it as a process I should not have run.
- Not screenshotted (source review only): Availability, Contacts, Insights, Settings, Book.vue.

Plan constraint to respect: the UI plan says "preserve existing App colors", "no material redesign", "Bookins: retain indigo `#2336DC`, normalize the small mark's visible size". Everything below is conservative: tokens, type floors, states, motion, consistency. No palette change, no layout redesign.

---------------------------------------------------------------------------

## 0. Key findings (what makes Bookins look less polished than Career)

1. Type floor. Bookins has about 190 `font-size` declarations at 12px or smaller (59x 12px, 50x 11px, 35x 10px, 24x 9px, 2x 8px) across `css/global.css` and every page. Career's floor is `0.875rem` (14px) everywhere (`career-studio/css/global.css:383-400` eyebrow/page-heading, nav labels, pills, notices). The UI plan says "16px body and form entry baseline, 14px secondary text, smaller metadata only where readable". Examples in Bookins: eyebrow 10px, `.label` 10px, `.field-hint` 10px, `.chip` 10px, mobile nav label 9px, share-card text 10px, workspace-card label 9px, nav section label 9px. This is the single biggest polish gap.
2. Font. Bookins uses `Inter` with no `@import`/font file, so it silently falls back to system-ui. Career loads DM Sans (`career-studio/css/global.css:1`). The plan wants "an approved fallback stack and locally deliverable font assets" and "prefer system fonts initially". Decide once: either keep system stack explicitly (drop the dangling `Inter`) or self-host. Recommendation below.
3. `GmButton.vue` (and `GmDialog`/`GmSelect`) read `--gm-color-brand`, `--gm-radius-control`, `--gm-space-*`, `--gm-duration-fast`, `--gm-ease-standard`, `--gm-font-body`, `--gm-color-focus`, etc., which are NOT defined anywhere in Bookins (or Career) CSS. Bookins also does not import `GmButton` in any page (only GmDialog, GmSelect, GmWalkthrough use the ui folder). If it is ever used it will render `#4338ca`, not `#2336dc`. Either define the tokens (below) or leave the file unused. Bookins pages instead use hand-rolled `.primary/.secondary/.danger/.ghost` (`css/global.css` approx. 491-545) that have no focus-visible variant, no pending/spinner state, and no `small` size (a separate `.small-button` at 34px exists).
4. Radii and shadows are inconsistent and heavy: `--radius: 18px`, buttons 11px, inputs 10px, chips pill, share card 14px, workspace card 13px, modal uses its own. The plan says "12px ordinary radius, 16-24px panel padding, avoid multiple nested decorated cards". Career: card 13px, buttons 9px, inputs 9px (`career-studio/css/global.css:403, 430`). Bookins' `box-shadow: 0 12px 32px` on every `.card` makes the Overview feel floaty compared to the flat, bordered Career cards.
5. Hierarchy: page `h1` is `clamp(30px,3vw,44px)` at weight regular with `-0.035em` tracking; on Overview it wraps to two lines ("Run your booking day with less back-and-forth.") and pushes content down ~230px. Career `h1` is `clamp(1.5rem, 2.2vw, 1.85rem)` (`career-studio/css/global.css:373-400`). Also the topbar repeats the page name in the center while the page h1 repeats it again.
6. Topbar: desktop topbar title is centered with only a refresh icon at right; Career left-aligns `page-title` and uses the right side for status pills (`career-studio/css/global.css:269-360`). The sticky offline banner (`App.vue` ~line 444, 39px desktop / 58px on mobile) sits above the header, is not part of the sticky stack, and eats a lot of mobile height, and the second "Local sample workspace" banner is a near-duplicate message. Career collapses this to one small `preview-pill` in the topbar ("Local preview · not saved", `career-studio/components/AppShell.vue` topbar-actions).
7. Touch targets inconsistent: filter selects/date inputs 38px, tab buttons 38px, "View details" 36px, Create direct link / Edit / Delete 36px (mobile screenshot), share-card Copy/Open 34px, `.small-button` 34px, icon button 42px. Plan: 44px web touch region; Career `.btn.small` is 40px, everything else 44px (`career-studio/css/global.css:430-500`).
8. Motion: `gsap` is in `package.json` but is not imported anywhere (dead dependency). There is no route transition, no list entry, no dialog panel motion beyond a fade, and no toast. Plan table: press 90-120ms, disclosure 150-180ms, dialog 180-220ms, page 120-180ms, all with reduced-motion fallback (Bookins already has a global reduced-motion guard at `css/global.css` end, keep it). Do not add gsap usage; CSS/Vue `<Transition>` is enough.
9. No toast/confirmation layer: results appear as inline `.notice`/`.saved` text (`pages/Contacts.vue:298`, many `role="status"` blocks in Bookings/Availability). Fine functionally, but nothing confirms "Copied", "Saved" in a consistent place.
10. Mobile: the floating feedback FAB (circle with B mark, `components/GoalmaticFeedback.vue`) overlaps card content at 390 (seen on Services) and, at desktop, overlaps the "View details" button on Bookings. Bottom nav labels are 9px and only 4 items (Home, Services, Hours, Bookings) with no path to Insights/Contacts/Settings except the hamburger; Career has a "More" button in the bottom nav (`career-studio/components/AppShell.vue` mobile-bottom-nav, last button).
11. Bookings header: search + Export CSV + New booking wrap into a ragged 2-row cluster to the right of the title (screenshot), the filter row uses unstyled native `<select>` and `<input type=date>` (38px, `dd/mm/yyyy`) while Availability/Settings use the styled `GmSelect`. Career uses a single `.filter-bar` card with `search-field` + `filter-toggle` (`career-studio/css/global.css:586-660`).
12. Empty states are present (`.empty` + `.empty-icon`) but plain; skeleton exists only as an App-level page skeleton (`App.vue`, 6 hits) with 3 generic blocks, nothing page-shaped (Social: per-page `page-loading.css`).

---------------------------------------------------------------------------

## 1. Shared foundation (css/global.css + shared components)

All changes below are token- and CSS-only unless noted; class names are kept so pages keep working. Land section 1 first, then verify every page at 1440 / 1024 / 768 / 390 before any page work.

### 1.1 Tokens (replace the `:root` block at the top of `css/global.css`)

Keep `--accent #2336dc`, `--accent-hover #192bc6`, `--accent-soft`. Add a type scale, space scale, radius and motion tokens, and make the `--gm-*` aliases so `GmButton/GmDialog/GmSelect` pick up Bookins' brand. Neutral values below are Career's (`career-studio/css/global.css:1-30`: `--ink #212028`, `--muted #646368`, `--line #e5e5eb`), which is the shared Goalmatic neutral family; Bookins' current cooler blue-grey neutrals can stay if you want zero palette risk (then just keep existing values and add only the new tokens).

```css
:root {
  /* keep existing colour tokens (--ink, --muted, --line, --accent...) */

  /* Type: floor is 14px for any text a user must read; 12px only for non-essential metadata. */
  --text-xs: 0.8125rem;   /* 13px: timestamps, refs, helper meta (was 9-12px) */
  --text-sm: 0.875rem;    /* 14px: secondary, labels, chips, nav, buttons (Career floor) */
  --text-md: 1rem;        /* 16px: body, form entry (stops iOS zoom) */
  --text-lg: 1.125rem;
  --text-xl: 1.3125rem;
  --text-2xl: clamp(1.5rem, 2.2vw, 1.85rem); /* page h1, == Career page-heading */

  /* Space (plan): 4 8 12 16 24 32 48 */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px;

  /* Radius + shadow: flatter, closer to Career */
  --radius: 14px;          /* cards (was 18) */
  --radius-sm: 10px;       /* controls, was 12 for some, 9-11 for others */
  --radius-pill: 999px;
  --shadow: 0 1px 2px rgba(16, 25, 40, 0.04);        /* resting card */
  --shadow-hover: 0 8px 22px rgba(34, 45, 89, 0.08);  /* only on interactive cards */
  --shadow-lg: 0 26px 80px rgba(23, 31, 71, 0.18);    /* dialogs only (unchanged) */

  /* Motion (plan: press 90-120, disclosure 150-180, dialog 180-220, page 120-180) */
  --dur-press: 110ms; --dur-fast: 160ms; --dur-panel: 200ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);

  /* Bridge for components/ui/Gm*.vue so they use the Bookins brand */
  --gm-color-brand: var(--accent);
  --gm-color-on-brand: #fff;
  --gm-color-surface: var(--surface);
  --gm-color-text: var(--ink);
  --gm-color-border: var(--line-strong);
  --gm-color-danger: var(--danger);
  --gm-color-on-danger: #fff;
  --gm-color-focus: rgba(35, 54, 220, 0.45);
  --gm-radius-control: var(--radius-sm);
  --gm-font-body: var(--font-ui);
  --gm-duration-fast: var(--dur-press);
  --gm-ease-standard: var(--ease);
  --gm-space-1: var(--space-1); --gm-space-2: var(--space-2);
  --gm-space-3: var(--space-3); --gm-space-4: var(--space-4);
}
```

Source references: token naming and values from `career-studio/css/global.css:1-30` (colour/neutral set), `social-studio/src/styles/content-hub-system.css:9-60` (`--text-xs..2xl`, `--space-1..6`, status colour mapping), `components/ui/GmButton.vue` style block (the `--gm-*` names it expects).

### 1.2 Font

Decision (recommended, low risk): drop the dangling `Inter` and use an explicit system stack (matches Social and the plan's "prefer system fonts initially", and avoids a Google Fonts request that Career makes at `career-studio/css/global.css:1`, which is also a hosted-runtime/privacy consideration for the anonymous `/book` page).

```css
--font-ui: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
:root { font-family: var(--font-ui); font-size: 16px; }
```

Optional later: self-host Inter/DM Sans woff2 in `public/` with `font-display: swap` (no third-party request). Do not add a remote `@import` on `/book`.

### 1.3 Type floor sweep (P0)

Mechanical, find-and-replace by value, then eyeball:

| Current | New | Where |
|---|---|---|
| 8px, 9px, 10px | `var(--text-xs)` (13px) for metadata, `var(--text-sm)` for labels/chips | `.eyebrow`, `.label`, `.field-hint`, `.chip`, `.nav-section-label`, `.workspace-card small`, `.share-card p`, `.runtime-label`, `.mobile-bottom-nav small` |
| 11px | `var(--text-xs)` | `.topbar-title small`, helper rows, ref IDs, counts |
| 12px | `var(--text-xs)` or `--text-sm` (use `--text-sm` for anything actionable or a field label) | `.field label` (12 -> 14), `.mode-banner`, `.metric-sub` |
| 13px | `var(--text-sm)` | nav links, workspace name |
| inputs | `font-size: var(--text-md)` (16px) | `.field input/textarea/select`, `.input`, search boxes (prevents iOS focus zoom) |

Eyebrow after: `font-size: var(--text-sm); letter-spacing: 0.1em; font-weight: 700;` (Career: `career-studio/css/global.css:383`, 0.875rem/700/0.12em).
Chips after: `min-height: 26px; padding: 0 10px; font-size: var(--text-sm)` plus a leading 6px dot for status (Social `.status-pill i`, `social-studio/src/styles/tokens.css:871-890`; copy the dot, NOT the 9px size).

### 1.4 Page header + card pattern

```css
.page-header { margin-bottom: var(--space-5); gap: var(--space-5); align-items: flex-end; }
h1 { font-size: var(--text-2xl); line-height: 1.2; letter-spacing: -0.03em; font-weight: 700; margin: 6px 0 8px; }
.lede { font-size: var(--text-sm); line-height: 1.6; max-width: 62ch; color: var(--muted); }
.card { padding: var(--space-5); border-radius: var(--radius); box-shadow: var(--shadow); }
a.card:hover, .card.interactive:hover { box-shadow: var(--shadow-hover); border-color: var(--line-strong); transform: translateY(-1px); transition: all var(--dur-fast) var(--ease); }
.workspace main { padding: var(--space-6) var(--space-6) 72px; max-width: 1240px; margin-inline: auto; }
```
Source: `career-studio/css/global.css:358-410` (`.workspace-content`, `.page-stack` width `min(1240px,100%)`, `.page-heading`, `.card`). Weight: Bookins h1 currently renders at regular weight and looks thin next to the 820-weight metric numbers; use 700.

Metrics (`.metric`): `font-size: 30px; font-weight: 750; font-variant-numeric: tabular-nums;`. Add `font-variant-numeric: tabular-nums` to all times, money, counts and the Insights KPIs.

### 1.5 Buttons (P0)

Keep the `.primary/.secondary/.danger/.ghost` classes (used by every page) but converge them with Career's `.btn`:
```css
.primary,.secondary,.danger,.ghost,.small-button {
  min-height: 44px; padding: 0 var(--space-4); border-radius: var(--radius-sm);
  font-size: var(--text-sm); font-weight: 700;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease),
              transform var(--dur-press) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.small-button, .primary.small, .secondary.small { min-height: 40px; padding: 0 var(--space-3); }   /* Career .btn.small = 40px, was 34/36 */
.primary { box-shadow: 0 1px 2px rgba(35,54,220,.18); }                  /* was 0 7px 15px glow */
.secondary:hover, .ghost:hover { border-color: #cfd5ff; background: var(--accent-faint); color: var(--accent); }
.primary:active, .secondary:active { transform: translateY(1px); }       /* GmButton press feel */
:is(.primary,.secondary,.danger,.ghost,.small-button):focus-visible { outline: 3px solid rgba(35,54,220,.4); outline-offset: 2px; }
:is(.primary,.secondary,.danger,.ghost):disabled { opacity: .5; transform: none; box-shadow: none; }
.is-pending { position: relative; color: transparent; pointer-events: none; }                  /* optional pending state */
.is-pending::after { content:''; position:absolute; inset:0; margin:auto; width:16px; height:16px; border-radius:50%;
  border:2px solid rgba(255,255,255,.4); border-top-color:#fff; animation: spin .8s linear infinite; }
.secondary.is-pending::after { border-color: rgba(35,54,220,.2); border-top-color: var(--accent); }
```
Sources: `career-studio/css/global.css:430-500` (btn, primary shadow `0 1px 2px`, secondary hover tint, small 40px, disabled .45) and `components/ui/GmButton.vue` (pending spinner, press -> `translateY(1px)`, focus ring). Do not migrate pages to `GmButton` in this pass (too many call sites, risk of changing click semantics); only define the tokens so a later migration is a no-op visually. Apply `.is-pending` to Save/Confirm/Cancel-booking buttons that today only change label text.

Rule to enforce: exactly one `.primary` per section; destructive actions use `.danger` (outline variant in lists, solid only inside the confirm dialog).

### 1.6 Forms

```css
.field { gap: 6px; margin-bottom: var(--space-4); }
.field label,.field-label { font-size: var(--text-sm); font-weight: 650; color: var(--ink-soft); }
.field-hint { font-size: var(--text-xs); color: var(--muted); line-height: 1.45; }
.field input,.field textarea,.input,select.input { font-size: var(--text-md); border-radius: var(--radius-sm); min-height: 44px; }
.field.invalid input,.field input[aria-invalid='true'] { border-color: var(--danger); box-shadow: 0 0 0 3px rgba(180,35,24,.1); }
.field-error { color: var(--danger); font-size: var(--text-sm); display:flex; gap:6px; }
.form-section { display:grid; gap: var(--space-4); padding: var(--space-5); border-top: 1px solid var(--line); }   /* group dense forms */
.field-row { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap: var(--space-4); }
```
Native `<select>` and `<input type=date|time>` used on Bookings/Contacts/Settings need `appearance` normalisation: `select.input{appearance:none; background:#fff url("data:image/svg+xml,...chevron...") no-repeat right 12px center; padding-right:36px}` or swap to `GmSelect` (preferred, already used in Services/Availability/Settings).

### 1.7 Chips, badges, counts

Single `.chip` API with semantic variants `success | warning | danger | info | neutral | accent` (today only confirmed/active, cancelled/paused, private exist; completed, no-show, pending, past have no style and fall back to grey). Map booking status: confirmed=success, completed=info(blue), no-show=warning, cancelled=danger, pending=warning, past=neutral. Add `--info: #245bb1; --info-soft: #eff5ff` (Career `--blue/--blue-soft`, `career-studio/css/global.css:21-22`). Tab count badges (`Upcoming 2`) use the same 20px pill as Career's nav counters (`career-studio/css/global.css:213-225`, `.workspace-nav i`).

### 1.8 Notices, banners, toasts

- Consolidate `.mode-banner` + the second "Local sample workspace" notice. Plan: one label, plus a durable help entry. Replace the amber offline strip with a compact topbar pill like Career `.preview-pill` (`career-studio/css/global.css:350-357`), text "Local preview - not saved" (honest, exact words used in `career-studio/components/AppShell.vue`), `title` attribute with the long explanation. Keep the full banner only for hosted runtime failures (`.mode-banner.error`), which must stay prominent and honest.
- `.notice` variants `.success/.warning/.error/.info` with a leading 18px icon and `role="status"|"alert"` (copy `career-studio/css/global.css:563-585`).
- Add a lightweight toast (no dependency): a `provide('toast')` helper in `App.vue` rendering a single `aria-live="polite"` region bottom-center (above mobile nav), 3.5s auto-dismiss, for "Link copied", "Saved", "Booking cancelled". Do not use toasts for errors (keep inline `role="alert"`). ~40 lines of CSS+Vue.

```css
.toast-region{position:fixed;inset:auto 0 calc(24px + env(safe-area-inset-bottom)) 0;display:grid;justify-items:center;gap:8px;pointer-events:none;z-index:90}
.toast{pointer-events:auto;padding:12px 16px;border-radius:12px;background:var(--ink);color:#fff;font-size:var(--text-sm);box-shadow:var(--shadow-lg)}
.toast-enter-active,.toast-leave-active{transition:opacity var(--dur-fast),transform var(--dur-fast)}
.toast-enter-from,.toast-leave-to{opacity:0;transform:translateY(8px)}
@media (max-width:900px){.toast-region{bottom:calc(76px + env(safe-area-inset-bottom))}}
```

### 1.9 Dialogs

Bookins has two dialog systems: `.modal-backdrop/.modal` (legacy) and `GmDialog` (radix). Unify visuals:
```css
.gm-dialog-overlay { background: rgba(16,25,40,.5); backdrop-filter: blur(3px); }
.gm-dialog-content.modal { border-radius: 16px; box-shadow: var(--shadow-lg); }
.modal-header h2 { font-size: var(--text-xl); }
.modal-footer { position: sticky; bottom: 0; display:flex; justify-content:flex-end; gap:8px; padding-top:var(--space-4); background:linear-gradient(transparent, var(--surface) 30%); }
@media (prefers-reduced-motion: no-preference) {
  .gm-dialog-content[data-state='open'] { animation: dialog-in var(--dur-panel) var(--ease); }
  @keyframes dialog-in { from { opacity:0; transform: translateY(8px) scale(.985) } to { opacity:1; transform:none } }
}
@media (max-width: 700px) {  /* bottom sheet on phones */
  .gm-dialog-overlay { place-items: end center; padding: 0; }
  .gm-dialog-content { width:100%; max-height: 92dvh; border-radius: 18px 18px 0 0; animation-name: sheet-in; }
  @keyframes sheet-in { from { transform: translateY(24px); opacity:0 } to { transform:none; opacity:1 } }
}
```
Source for timing: UI plan motion table (dialog 180-220ms); structure from `career-studio/components/ui/GmDialog.vue` (focus trap, `data-state`). Keep Bookins' radix GmDialog implementation and its busy/guardDismiss logic untouched.

### 1.10 Shell (App.vue + global.css)

- Sidebar: widen to 268px (Career/Social `--sidebar` 268px) only if it does not break `/book` (it does not use the shell). Nav items 14px, icon 20px, active state = soft fill + 1px border (`#c9b6f9` in Career becomes `#cfd5ff` for indigo) as in `career-studio/css/global.css:186-200`; keep Bookins' 3px left rail if the owner likes it, but drop the `translateX(1px)` hover jiggle.
- Group labels (`WORKSPACE`, `MANAGE`) 12px/700 uppercase with 0.12em tracking, color `--muted` (a11y: current `#98a0b3` on white is about 2.7:1 and fails 4.5:1 for small text).
- Topbar: left-align the page title (`justify-content: space-between`, title first), 14px strong + 13px subtitle, right slot for the preview pill + refresh icon (`career-studio/css/global.css:269-300`). Height 64px per plan.
- Mobile bottom nav: labels 12px (not 9px), 5 slots: Home, Services, Hours, Bookings, More (opens the existing drawer with Insights, Contacts, Settings). Add `aria-current` styling and the `max(6px, env(safe-area-inset-bottom))` padding (`career-studio/css/global.css:2783-2810`). Per Bookins' existing route list, Insights/Contacts/Settings are currently drawer-only.
- Skip link `Skip to content` (`career-studio/css/global.css:2103-2125`) if not already in `App.vue`.
- Feedback FAB: on <=900px offset `bottom: calc(80px + env(safe-area-inset-bottom))` and shrink to 44px; on desktop move to bottom-right but add `main { padding-bottom: 96px }` so it never covers the last card action. Do not remove the feedback feature.
- Sidebar booking-link card: raise text to 12-13px, Copy/Open buttons to 40px; ellipsise URL (already).
- Route transition (see 1.12).

### 1.11 Loading, empty, error states

- Keep the single `.page-skeleton`, but make it page-shaped. Add `skeleton-variants` driven by the route: `list` (3 stacked rows with 40px avatar + 2 lines + pill), `cards` (3 service cards), `kpis` (4 tiles + 2 panels), `form` (label/input pairs). Copy the shimmer from `social-studio/src/styles/page-loading.css:1-14` (gradient `100deg`, `background-size: 220% 100%`, 1.45s) instead of the white-sweep pseudo element; it is cheaper (no ::after layer) and looks smoother.
- Empty state: standardise one component `EmptyState.vue` (copy `social-studio/src/components/EmptyState.vue`, 21 lines) with icon tile 44px / 13px radius (`social-studio/src/styles/tokens.css:966-985`), 1 heading, 1 sentence of specific copy, one primary action. Copy must name the actual missing prerequisite (plan: "Keep empty-state copy specific"). Never promise automation that does not exist (see section 6).
- Error/fatal: `.state-card` should mirror Career's fatal card (`career-studio/css/global.css:527-545`): icon, h1, message, "Try again" `.primary`.
- Add inline retry to every list-level failure.

### 1.12 Motion (CSS/Vue only; remove nothing, add nothing heavy)

```css
@media (prefers-reduced-motion: no-preference) {
  .page-enter-active { transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease); }
  .page-enter-from { opacity: 0; transform: translateY(6px); }
  .stagger > * { animation: rise var(--dur-panel) var(--ease) both; }
  .stagger > *:nth-child(2){animation-delay:40ms} .stagger > *:nth-child(3){animation-delay:80ms} .stagger > *:nth-child(n+4){animation-delay:120ms}
  @keyframes rise { from { opacity:0; transform: translateY(8px) } to { opacity:1; transform:none } }
}
```
In `App.vue`: wrap the routed page in `<RouterView v-slot="{ Component }"><Transition name="page" mode="out-in"><component :is="Component" /></Transition></RouterView>` (shell stays mounted, 160ms, per plan "Page and tab navigation"). Apply `.stagger` to KPI row, service list and booking day groups only on first render. The existing global reduced-motion rule already neutralises all of this.
Remove the unused `gsap` dependency from `package.json` (smaller install, honest dependency list). That is a separate, optional commit; flag to the owner rather than silently editing lockfiles.

### 1.13 Icons

Keep `AppIcon.vue`. Standardise: 20px nav, 18px inline, 16px chips; `stroke-width: 1.8` (Career `svg` default, `career-studio/css/global.css:~70`). Icon tile for stat cards: 40px/12px radius with the existing tinted backgrounds (already good on Overview).

### 1.14 Dark mode

Neither Career nor Bookins ships dark mode; plan says "do not force". Out of scope. Do keep colors as tokens so it stays possible.

### 1.15 Responsive breakpoints

Adopt Career's (1250 content wrap, 900 nav collapse, 700 phone) plus Bookins' existing 1120/1080. Page gutters 16 phone / 24 tablet / 32 desktop (plan), currently 18px phone and 32px desktop; set `main` padding `var(--space-4)` below 700px, `var(--space-5)` below 1100px.

---------------------------------------------------------------------------

## 2. Per-page changes

Priority key: P0 = visible polish gap, low risk, do first; P1 = clear improvement; P2 = nice to have.

### 2.1 Overview (`pages/Index.vue`, 688 lines)
- P0: h1 shrink to `--text-2xl` (one line). Current copy "Run your booking day with less back-and-forth." wraps to two lines at 1440 and consumes 130px. Move "New service" `.primary` to align with the lede baseline.
- P0: KPI tiles (Active services / Upcoming / This month / Open weekdays): metrics get `tabular-nums`; label 13px; sub text 13px; tiles become links to the relevant page (cards already tinted). Add hover lift via `a.card`.
- P0: When the checklist is 100% complete, collapse it into a single success row ("You are ready to book" + `View booking link`) instead of a full card with five struck-through items; show the full checklist only while incomplete (plan: "returning user should see useful content or next action immediately; replace permanent welcome blocks"). The struck-through rows currently look broken rather than done.
- P1: "Today's bookings" and "Reminder queue" empty cards are tall for one line of text; use compact empty rows (min-height 120px) and the specific copy already present. Reminder queue copy ("Opens your own WhatsApp, SMS, or mail app. Bookins does not send.") is an honesty statement; keep verbatim.
- P1: Upcoming bookings list rows: date tile (8 OCT) + title + guest + time is good; add a `chip` for status and a chevron; keep 78px row, 14px text.
- P1: "Booking link" card: show the URL in a read-only input-style row with a copy icon button, `Copied` toast on click.
- P2: first-render stagger on KPI row.

### 2.2 Services (`pages/Services.vue`, 894 lines)
- P0: Service card actions at 36px -> 40px (`.small-button`), group as `[Edit service]` (secondary) + overflow/Delete as icon button with `aria-label="Delete service"`; currently Edit/Delete share a row with equal weight.
- P0: Chips "Active" and "Public" 10px -> 14px using new chip tokens; add dot. Duration and price row gets icons at 16px and `tabular-nums` (e.g. "NGN 25,000").
- P0: Mobile: "DIRECT LINK / Create direct link" block pushes the card to ~400px tall; collapse into a `<details>`-style row "Direct link" with a 40px button.
- P1: Grid: `grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))` on desktop (Career job-feed uses a flat list; Bookins can keep cards but should fill width evenly).
- P1: Edit dialog (GmDialog): split into sections ("Basics", "Duration and price", "Booking rules", "Visibility") with `.form-section`, sticky footer, 16px inputs. Price input prefix chip for currency.
- P1: Empty state when no services: `EmptyState` with the action "Create your first service".
- P2: skeleton variant `cards`.

### 2.3 Availability (`pages/Availability.vue`, 1003 lines, densest form)
- P0: Weekly hours editor: each day row = day name (14px/650) + switch + time range selects; move to a 2-column row layout on desktop with consistent 44px selects, and `Copy to all days` as a `.ghost.small`. Make the per-day closed state visually muted instead of just disabled controls.
- P0: Time-off section (`.off-grid`, `.off-grid.three`): use `.field-row` auto-fit and show existing time-off as a list of chips/cards with a remove icon button, 44px hit target.
- P0: Warning notes (`.warning-note`, overlapping/hidden windows, bookings outside hours) -> `.notice.warning` with icon; keep exact semantics/text.
- P1: Section cards with `h2` + one-line description + `.form-section` dividers; sticky "Save changes" bar at the bottom of the viewport when dirty (`.dirty-actions` already exists; make it sticky with shadow, 56px tall, honest "Unsaved changes" text). Mobile: full-width Save, above bottom nav (offset `76px`).
- P1: Timezone select: add a small live clock line "It is 3:42 PM in Africa/Lagos" (time-display.js already exists); clarity item named in UI plan ("Time-zone clarity").
- P2: week summary strip at top (e.g. "Mon-Fri 9:00-17:00") as read-only chips.

### 2.4 Bookings (`pages/Bookings.vue`, 2011 lines, biggest page)
- P0: Header: title + lede left; right cluster becomes `[search 280px] [Export CSV (secondary)] [New booking (primary)]` on one row >=1100px; below that, search moves to full-width row under the title (Career `.filter-bar > .search-field` full-width pattern, `career-studio/css/global.css:2726-2735`). Currently it wraps into an awkward 2-row stack.
- P0: Filters row (Service / From / To / Agenda-Week toggle): put inside one `.card.filter-bar` at 44px controls, replace native selects with `GmSelect`, normalise date inputs; keep labels visible at 13px+. Status tabs stay (they read well) but raise to 44px and 14px labels; count pills `20px`.
- P0: Booking cards: the date tile, title + status chip, time line, guest avatar + contact and "View details" are good bones. Fix: ref ID (`BK-DEMO2401`) from 10px to 13px mono (`font-variant-numeric: tabular-nums; font-family: ui-monospace`), "View details" to 40px, make the whole card a button-like target (`cursor:pointer`, hover lift) and keep the visible button for a11y.
- P0: Google Calendar "Not Connected" strip stays honest (AGENTS.md: Calendar writes unavailable) but should shrink to a single 44px row with an info icon and chip "Not connected". Do not add a "Connect" CTA.
- P1: Day group headings ("Thursday, October 8, 2026" + count) become sticky within the scroll (`position: sticky; top: 68px`) with a subtle background so long lists scan better.
- P1: Week view: day columns get a header with date number + weekday and a `+N more` overflow; on <900px it already collapses to 1 column (keep), add horizontal day pills.
- P1: Detail and cancel dialogs (two GmDialog blocks, ~350 lines): section headings (Guest, Booking, Notes, Activity), definition-list layout (`dl` grid 120px / 1fr), sticky footer, destructive confirm uses `.confirm-box` with `.danger` solid only there. Status change buttons use `.is-pending`.
- P1: Empty tabs: tab-specific copy ("No cancelled bookings yet") + clear-filters action when filters are active.
- P2: Export CSV success toast ("Exported 16 bookings").

### 2.5 Contacts (`pages/Contacts.vue`, 547 lines)
- P0: Convert rows to the Bookings guest pattern: 40px initial avatar (tinted, deterministic colour per initial), name 15px/650, email/phone 14px muted, right-aligned "N bookings" chip + last booked date; hit target 56px+.
- P0: Inline notes/save: textarea min-height 96, label 14px, `Saved.` replaced by toast + subtle check; keep `role="status"`.
- P1: Toolbar: search (44px) + sort select; sticky on scroll; count text "12 contacts" 14px.
- P1: Empty state: "No contacts yet. Guests appear here after their first booking." (accurate; verify against actual behaviour before shipping).
- P2: Letter dividers (A, B, C) for >20 contacts.

### 2.6 Insights (`pages/Insights.vue`, 441 lines)
- P0: KPI row: same tile spec as Overview (`tabular-nums`, 13px labels, delta chips only if the data exists; do not fabricate trends).
- P0: Charts/bars must have text alternatives and a visible numeric label (no hover-only values). Use the Bookins accent plus 2 tints; avoid rainbow. Min label size 13px. `.kpis` collapses to 1 column <=400px already; make it 2 columns at phone and 4 at desktop.
- P1: Date-range control as segmented buttons (7d / 30d / 90d) consistent with Agenda/Week toggle (`.view-toggle` style), 44px.
- P1: Empty/low data state: "Insights appear after your first booking." with link to share the booking link (no fake charts).
- P2: Skeleton `kpis` variant.

### 2.7 Settings (`pages/Settings.vue`, 1022 lines)
- P0: Page is one long scroll of sections; add a left in-page nav (sticky `Profile / Booking page / Messages / Reminders / Data`) on >=1050px and horizontal scroll-snap tabs on mobile (Career settings and Social settings both use sectioned pages). Anchor-only (no router changes).
- P0: Template picker (`.template-grid`, 1-col <800px): selectable cards with 2px accent border + check icon when active, 44px+ hit areas, `role="radiogroup"` semantics preserved.
- P0: Field groups use `.form-section` with titles; hints 13px; character counters where limits exist.
- P1: Sticky save bar on dirty (same as Availability), identical component.
- P1: Danger zone (if present) at bottom with `.danger` outline and confirm dialog.
- P1: Booking link card with QR (`components/QrCode.vue`): QR at 160px in a bordered tile, `Download PNG` secondary, Copy toast.
- P2: Live mini-preview of the guest page accent/logo (reuse Book.vue tokens via an iframe-less static tile; no new deps).

### 2.8 Guest page (`pages/Book.vue`, 1716 lines) - must stay lightweight
Constraints: no new dependencies, no new font download, no JS animation libs, no extra requests, keep layout isolation from the owner shell, keep bundle weight flat. All changes are CSS, markup attributes and tiny transitions.
- P0: Type floor: 42 declarations at <=12px in this file. Raise slot buttons, date labels, helper text, footer legal/“Powered by” to >=13px; inputs 16px (also prevents iOS zoom on the form step). Concretely: `.slot` text 14-15px/650, calendar weekday labels 12-13px, error text 14px.
- P0: Slot buttons and calendar day cells >=44x44px (Career `--` 44px rule, plan: "44px web touch region"); selected state = solid accent + white text + check icon (not colour alone); disabled days = muted + strikethrough number + `aria-disabled`.
- P0: Step clarity: a 3-step indicator (Service -> Time -> Details), 14px labels, `aria-current="step"`, sticky "Continue" bottom bar on mobile (`position: sticky; bottom: 0; padding-bottom: env(safe-area-inset-bottom)`), summary line ("Product consultation - Mon 12 Oct 10:00 AM - GMT+1") always visible before confirming. Plan item "Time-zone clarity": show the guest timezone prominently with a change control.
- P0: Loading: replace the plain spinner text (`.public-state`, `.slots-loading`) with 6 skeleton slot chips (CSS only, shimmer from `page-loading.css`). Error/expired grant states use the shared `.state-card` look with a single "Try again" action.
- P1: Success/outcome screen: large check (inline SVG, 56px, `stroke-dashoffset` draw animation 400ms, respects reduced motion), booking reference in 16px mono with Copy button, "Add to calendar" ONLY if implemented as a downloadable `.ics` (AGENTS.md: Calendar writes unavailable until real provider flow), otherwise omit. No email/payment claims.
- P1: Page chrome: centred 720px column, 16px gutters on phone, card radius 14px, owner logo/name header with 40px tile, Bookins mark only in a quiet footer.
- P1: Demo banner (`demoPreview`, `.demo-preview-banner`): keep visible text and icon; make it a slim 40px pill, not a full-width block.
- P2: `prefers-reduced-motion` already honoured in scroll behaviour (`Book.vue:624`); keep the same for any new transitions (`@media (prefers-reduced-motion: no-preference)` wrapper).
- Do not import anything from the owner shell (`App.vue`, `AppIcon` is fine if already used). Keep the route's bare layout.

### 2.9 Shared UI components (`components/ui/*`, `components/*`)
- P0: `GmButton`: leave file untouched; supply tokens (1.1). Optionally start using it in new code only.
- P1: `GmSelect.vue` (472 lines): trigger min-height 44px, font 16px on mobile, chevron rotates 180deg over `--dur-fast`, option rows 44px, selected option check icon; the `[data-theme='light']` bridge in global.css already maps brand colours, keep it.
- P1: `GmWalkthrough.vue` / `DemoGuide.vue`: use 14px text, 44px buttons, `max-width: min(360px, calc(100vw - 32px))`, non-obscuring bottom panel on phones (plan: "non-obscuring guide panel on small screens; keyboard reachable").
- P1: `GoalmaticFeedback.vue`: FAB positioning fix from 1.10.
- P2: `BookinsLogo.vue`: plan item "normalize the small mark's visible size, not its design": check the 32px mark's visible occupancy is 70-80% of its frame at 32/44px (current sidebar mark looks small next to the wordmark; increase mark viewBox fit, do not alter geometry).

---------------------------------------------------------------------------

## 3. Suggested delivery order

1. P0 foundation: tokens, font, type floor sweep, buttons, chips, form sizes, shell (topbar, bottom nav 12px labels + More, FAB offset). Verify all pages at 1440/1024/768/390 for overflow (plan: no whole-page horizontal overflow; check `.week-grid`, Bookings tabs, wide tables).
2. P0 per-page: Overview header + checklist collapse, Bookings header/filters, Services actions, Availability rows, Settings in-page nav, Book.vue targets/skeleton.
3. P1: toast layer, dialog polish, sticky save bar, empty/skeleton variants, route transition.
4. P2: stagger, QR tile, extras.
5. Evidence: run `yarn build`; `yarn test`; capture before/after screenshots (1440, 390) per route and the guest page in demo and not-found/expired-grant states.

## 4. Do NOT change

Functionality and data
- No change to routing, runtime/guest actions, table/resource names, manifest capabilities, or any `GoalmaticGuest`/installed runtime calls. Any new resource/capability would require updating `README.md`, `docs/ARCHITECTURE.md` and `.goalmatic/app.json` together (AGENTS.md); this spec adds none.
- Do not add a second identity, wallet, Firebase client, provider key or physical Table ID in browser code. The toast helper and skeletons are pure UI.
- `/book` stays the only anonymous route and may call only manifest-declared guest actions. Do not add fonts, analytics, CDN assets or third-party requests to it.
- Keep colour `#2336dc` / `#192bc6` / indigo soft family; do not recolor per the plan's "preserve existing App colors".
- Keep Bookins' B mark artwork; only adjust its optical size.

Honesty copy (AGENTS.md rules; keep verbatim or stronger, never softened)
- Local-preview labelling: "Local sample workspace. Changes stay in this browser and never reach your hosted App." / "Offline preview. Goalmatic account data and credits are not connected." The compact topbar pill may shorten the label but the long text must remain available (title/tooltip/help) and localhost-only; hosted builds must still show a hard, honest failure when the installed or guest runtime is unavailable.
- Payments, Calendar writes and email delivery are unavailable: keep "Not Connected", "Not available in local preview", and "Opens your own WhatsApp, SMS, or mail app. Bookins does not send." Do not add "Connect", "Pay", "Send email", "Add to Google Calendar", "Automatic reminders", or success toasts implying delivery. Price fields stay informational.
- Demo/read-only mode must remain labelled in text plus icon (plan: not colour alone); demo must never reserve real capacity.
- Do not hide or restyle the feedback entry point out of existence; only reposition it.
- Do not remove inline `role="status"/"alert"` messages when adding toasts; toasts supplement success only.
- Keep the 44px minimum tap targets (the sweep raises smaller ones; never lowers).
- Keep the global `prefers-reduced-motion` guard at the end of `css/global.css`.

Out of scope
- Dark mode, new pages, new dependencies (including any gsap/animation lib; consider removing `gsap`), moving to Tailwind-heavy markup, migrating every call site to `GmButton`, changing i18n strings/keys beyond what the type-size changes require.


---------------------------------------------------------------------------

## Foundation as implemented

Landed in `css/global.css`, `components/ui/*`, `components/AppIcon.vue`, `components/BookinsLogo.vue`, `App.vue`, `index.html`. Page files untouched. `yarn build` and `yarn test` pass. Existing class names still work. Screenshots could not be captured (preview snapshot failed); layout was checked by DOM metrics at 390 (no horizontal overflow).

### Tokens (`:root`)
- Font: `--font-ui` (system stack, no web font), `--font-mono`. Body 16px.
- Type: `--text-xs` 13px (true meta only), `--text-sm` 14px (floor for readable text, labels, chips, buttons), `--text-md` 16px (inputs/body), `--text-lg`, `--text-xl`, `--text-2xl` (page h1). Never go below 13px; 12px only in nav/group labels and count pills.
- Space `--space-1..7` (4 8 12 16 24 32 48). Radius `--radius` 14, `--radius-sm` 10, `--radius-pill`. Shadow `--shadow`, `--shadow-hover`, `--shadow-lg`.
- Motion `--dur-press` 110ms, `--dur-fast` 160ms, `--dur-panel` 200ms, `--ease`.
- Controls `--control-h` 44px, `--control-h-sm` 40px, `--focus-ring`. Layout `--page-gutter` (32/24/16 by breakpoint), `--topbar-h` 64px, `--bottom-nav-h` 68px.
- Colour: existing set plus `--info`, `--info-soft`, `--accent-line`, `--muted-soft`. `--muted` darkened to #5d6578 for contrast.
- `--gm-*` bridge defined (brand = `--accent`) so GmButton/GmDialog/GmSelect/GmWalkthrough use #2336dc.

### Classes
- Header: `.page-header` + `.page-header-actions` (wrapping right cluster; full width on phones), `.eyebrow`, `.lede`, `.section-title`. h1 is now `--text-2xl`, weight 700.
- Cards: `.card`, `.card-flat`, `a.card` / `.card.interactive` (hover lift). `.icon-tile` (+ `.success|.warning|.info`).
- Stat tiles: `<div class="stat-grid"><div class="card stat-tile"><span class="label">..</span><span class="icon-tile">..</span><p class="metric tnum">..</p><p class="metric-sub">..</p></div></div>` (4 cols, 2 below 1080, 1 at 400). Or use `a.card.stat-tile` for links.
- Buttons: `.primary .secondary .danger .ghost .small-button` (44px; `.small` modifier or `.small-button` = 40px). `.danger.solid` for confirm dialogs only. `.w-full`. Pending: add `.is-pending` plus `:disabled` (spinner, label hidden, width kept).
- Chips: `.chip` is neutral, no capitalisation. Variants `.success .warning .danger .info .neutral .accent`; status names `.confirmed .active .completed(info) .no-show .pending .cancelled .paused .past .private` map automatically and get a leading dot. `.dot` adds a dot to any chip; `.caps` opts in to capitalize. `.count-pill` for tab counts.
- Notices: `.notice` (+ `.success .warning .error .info`), flex layout: put an `<AppIcon :size="18">` first.
- Forms: `.field`, `.field-hint`, `.field-error`, `.field.invalid`, `.field-row` (auto-fit 220px), `.form-section` (with optional `<h3>`), `.input`, native `select.input` / `.field select` get chevron and 16px text. Inputs are 44px/16px.
- Toolbar: `.toolbar`, `.filter-bar` (card style), `.toolbar-spacer`, `.search-field` (`<div class="search-field"><AppIcon name="search" :size="18"/><input/></div>`), `.segmented` (buttons with `aria-pressed|aria-selected` or `.is-active`), `.tab-bar` (pill tabs, horizontally scrollable, same active hooks).
- Lists: `.list` > `.list-row` (button/a/`.interactive` get hover) with `.list-row-main` (`<strong>` + `<span>`), `.list-row-end`, `.avatar`. `.detail-list` for `<dl>` (120px/1fr, stacks on phone).
- Dialogs: `.modal`, `.modal-header`, `.modal-footer` (sticky, assumes 24px card padding; 16px on phones), `.confirm-box`. GmDialog now blurs overlay, animates (pop 200ms), and becomes a bottom sheet under 700px (forces top radii 18px).
- Save bar: `<div class="sticky-save-bar" role="status"><span>Unsaved changes</span><div class="cluster">..</div></div>` (clears the bottom nav on mobile).
- Skeletons: `.skeleton`, `.skeleton-line`, `.skeleton-block`, `.skeleton-row` (72px), `.skeleton-kpis`, `.skeleton-cards`; shimmer is a background gradient.
- Empty: `.empty` (+ `.compact` for 120px min height), `.empty-icon` 44px, `.state-card`.
- Utilities: `.tnum`, `.mono`, `.truncate`, `.cluster`, `.stack`, `.stack-sm`, `.text-xs`, `.text-sm`, `.stagger` (first-render rise, children), `.visually-hidden`.
- Toast: App.vue `provide('toast', fn)`; page usage `const toast = inject('toast', null); toast?.('Link copied')`. 3.5s, max 3 stacked, success only (keep inline role="alert" for errors).
- Shell: `.preview-pill` (+ `.demo`), skip link to `#main-content`, mobile bottom nav with 12px labels and a More sheet (Insights/Contacts/Settings), 160ms page transition `.page-*`, feedback launcher offset above the bottom nav via `[data-feedback-widget]` override.
- Collision notes for page engineers: pages that define scoped `.filter-bar`, `.field-row`, `.field-error`, `.avatar`, `.compact` keep their scoped rules but now also inherit the global ones (global `.filter-bar` adds card padding, border and background; drop the page copy).

### Deferred
- Page-shaped skeleton variants per route (App skeleton still generic, now shimmer); EmptyState component; route-specific toast usage.
- Shrinking the feedback launcher to 44px (size is fixed inside the widget's shadow DOM; only offset is changed). Desktop launcher not moved; `main` has 96px bottom padding.
- Sidebar not widened to 268px. GmWalkthrough/DemoGuide phone bottom-panel placement (DemoGuide is not in the foundation scope).
- Removing unused `gsap` dependency (flag to owner). No dark mode.
