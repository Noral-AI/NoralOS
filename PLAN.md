# PLAN — Brand alignment with noral.ai

5 phases, atomic commit per phase, each independently buildable. Branch: `feat/brand-alignment-noral-ai`.

**Stop after Phase 5.** No merging. PR opens at the end with all four docs linked + screenshots + deviations list.

---

## Phase 1 — Design tokens

**Goal:** one-shot CSS-variable swap that cascades through every shadcn primitive.

**Files touched:** `ui/src/index.css` only (plus possibly `ui/index.html` for font loading).

### 1.1 Add brand tokens

Add to `:root` block (alongside existing tokens):

```css
--brand-ink: #0A1F2E;
--brand-ink-2: #122a3c;
--brand-cream: #F5F1EA;
--brand-paper: #FAF7F1;
--brand-sand: #ECE6DA;
--brand-signal: #FF5B2E;
--brand-signal-soft: #ff8b65;
--brand-signal-quiet: #ffd4c2;
--brand-stone: #4a5560;
--brand-mist: #7d8a96;
--brand-rule: rgba(10, 31, 46, 0.10);
--brand-rule-strong: rgba(10, 31, 46, 0.20);
--brand-success: #5dd28a;
```

### 1.2 Remap shadcn tokens to brand

Light theme (`:root`):

```css
--background: var(--brand-paper);
--foreground: var(--brand-ink);
--card: var(--brand-paper);
--card-foreground: var(--brand-ink);
--popover: var(--brand-paper);
--popover-foreground: var(--brand-ink);
--primary: var(--brand-signal);
--primary-foreground: var(--brand-cream);
--secondary: var(--brand-cream);
--secondary-foreground: var(--brand-ink);
--muted: var(--brand-sand);
--muted-foreground: var(--brand-mist);
--accent: var(--brand-signal);
--accent-foreground: var(--brand-cream);
--border: var(--brand-rule);
--input: var(--brand-rule);
--ring: var(--brand-signal);
--sidebar: var(--brand-paper);
--sidebar-foreground: var(--brand-ink);
--sidebar-primary: var(--brand-signal);
--sidebar-primary-foreground: var(--brand-cream);
--sidebar-accent: var(--brand-cream);
--sidebar-accent-foreground: var(--brand-ink);
--sidebar-border: var(--brand-rule);
--sidebar-ring: var(--brand-signal);
```

Dark theme (`.dark`):

```css
--background: var(--brand-ink);
--foreground: var(--brand-cream);
--card: var(--brand-ink-2);
--card-foreground: var(--brand-cream);
--popover: var(--brand-ink-2);
--popover-foreground: var(--brand-cream);
--primary: var(--brand-signal);
--primary-foreground: var(--brand-cream);
--secondary: rgba(245,241,234,0.08);
--secondary-foreground: var(--brand-cream);
--muted: rgba(245,241,234,0.06);
--muted-foreground: rgba(245,241,234,0.78);
--accent: var(--brand-signal);
--accent-foreground: var(--brand-cream);
--border: rgba(245,241,234,0.10);
--input: rgba(245,241,234,0.10);
--ring: var(--brand-signal);
--sidebar: var(--brand-ink);
--sidebar-foreground: var(--brand-cream);
--sidebar-primary: var(--brand-signal);
--sidebar-primary-foreground: var(--brand-cream);
--sidebar-accent: rgba(245,241,234,0.08);
--sidebar-accent-foreground: var(--brand-cream);
--sidebar-border: rgba(245,241,234,0.10);
--sidebar-ring: var(--brand-signal);
```

`--destructive` left as shadcn default (brand has no error red — document in deviations). `--chart-1..5` left as shadcn default (multi-hue dataviz palette — document in deviations).

### 1.3 Radius scale

```css
--radius: 0.875rem;        /* 14px (md) */
--radius-sm: 0.625rem;     /* 10px */
--radius-md: 0.875rem;     /* 14px */
--radius-lg: 1.25rem;      /* 20px */
--radius-xl: 1.75rem;      /* 28px */
```

### 1.4 Font loading

In `ui/index.html`, inside `<head>` (before existing favicons):

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

In `ui/src/index.css` `@theme inline {}` block:

```css
--font-sans: "Inter", -apple-system, "Segoe UI", Roboto, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
--font-display: "Inter", -apple-system, "Segoe UI", Roboto, sans-serif;
```

And in the base `body` rule:

```css
body { font-family: var(--font-sans); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
```

### 1.5 Type-role utility classes

```css
.brand-display { font-family: var(--font-display); font-weight: 800; font-size: 4.5rem; line-height: 0.98; letter-spacing: -0.045em; }
.brand-h2      { font-family: var(--font-display); font-weight: 800; font-size: 3rem;   line-height: 1.05; letter-spacing: -0.04em; }
.brand-lede    { font-family: var(--font-sans);    font-weight: 400; font-size: 1.125rem; line-height: 1.55; }
.brand-eyebrow { font-family: var(--font-mono);    font-weight: 500; font-size: 0.6875rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--brand-mist); }
```

### Phase 1 build verify

```
pnpm typecheck
pnpm --filter @noralos/ui build
```

Visual sanity: open the dev server, click through dashboard / settings / login. Expect everything to **shift in color** — paper bg, ink text, orange CTAs — but not break layout. If anything looks wrong, fix tokens before committing.

**Commit:** `style(brand): phase 1 — design tokens (colors, fonts, radii, type roles) → noral.ai`

---

## Phase 2 — Asset import + favicon regen

**Files touched:** `ui/public/` and `ui/index.html` head meta tags.

### 2.1 Copy logo files

```sh
mkdir -p ui/public/brand
cp "/Users/quentin/Documents/NORALAI/NoralAI Website/assets/noralai-logo-primary.svg" ui/public/brand/
cp "/Users/quentin/Documents/NORALAI/NoralAI Website/assets/noralai-logo-primary.png" ui/public/brand/
cp "/Users/quentin/Documents/NORALAI/NoralAI Website/assets/noralai-logo-stacked.svg" ui/public/brand/
cp "/Users/quentin/Documents/NORALAI/NoralAI Website/assets/noralai-logo-stacked.png" ui/public/brand/
cp "/Users/quentin/Documents/NORALAI/NoralAI Website/assets/noralai-logo-symbol.svg"  ui/public/brand/
cp "/Users/quentin/Documents/NORALAI/NoralAI Website/assets/noralai-logo-symbol.png"  ui/public/brand/
cp "/Users/quentin/Documents/NORALAI/NoralAI Website/assets/og-default.svg"           ui/public/og-default.svg
cp "/Users/quentin/Documents/NORALAI/NoralAI Website/assets/og-default.png"           ui/public/og.png
```

### 2.2 Generate favicon raster sizes from `noralai-logo-symbol.svg`

Use whichever rasterizer is available. Preferred order:
1. `rsvg-convert` (librsvg) — best fidelity
2. `inkscape` CLI
3. `npx -y sharp-cli` (sharp via Node, falls back if other tools missing)

Output (replace existing files in `ui/public/`):

| File | Size | Purpose |
|---|---|---|
| `ui/public/favicon.svg` | (raw SVG) | modern browser tab favicon |
| `ui/public/favicon-16x16.png` | 16×16 | tab favicon raster |
| `ui/public/favicon-32x32.png` | 32×32 | tab favicon raster (HiDPI) |
| `ui/public/apple-touch-icon.png` | 180×180 | iOS home screen |
| `ui/public/android-chrome-192x192.png` | 192×192 | PWA / Android |
| `ui/public/android-chrome-512x512.png` | 512×512 | PWA splash |
| `ui/public/favicon.ico` | 16+32 multi | legacy IE/Edge fallback |

The symbol mark already includes the rounded-square ground (radius 17%) — favicon ground stays ink, mark stays signal. No re-coloring needed.

### 2.3 OG meta tags + minor head cleanup

In `ui/index.html` `<head>` (after `<title>`):

```html
<meta name="description" content="NoralOS — agent management OS for autonomous AI companies." />
<meta property="og:title" content="NoralOS" />
<meta property="og:description" content="Agent management OS for autonomous AI companies." />
<meta property="og:type" content="website" />
<meta property="og:image" content="/og.png" />
<meta property="og:url" content="https://agent.noral.ai/" />
<meta name="twitter:card" content="summary_large_image" />
```

(Final copy in description tags will be tightened in Phase 5 if needed.)

### Phase 2 build verify

- `pnpm --filter @noralos/ui build`
- `pnpm --filter @noralos/ui dev` → open in browser → check Network tab for any 404 on `/brand/*` or `/og.png`
- View page source → confirm OG tags present
- Check tab favicon visually

**Commit:** `style(brand): phase 2 — import noral.ai logo assets, regenerate favicons, add OG meta`

---

## Phase 3 — Shared components

**Files touched:** `ui/src/components/ui/*.tsx` (button, input, card, etc.) + `ui/src/components/Sidebar.tsx`, `ui/src/components/SidebarAccountMenu.tsx`, plus a new `ui/src/components/brand/NoralLogo.tsx`.

### 3.1 New `<NoralLogo />` component

Port `components/Brand.jsx`'s `<NoralMark>`, `<NoralSymbol>`, `<NoralWordmark>`, `<NoralPrimary>`, `<NoralStacked>` into a single TS file at `ui/src/components/brand/NoralLogo.tsx`. Same SVG geometry. Color props default to brand tokens via `currentColor`/`color={var(--brand-signal)}`. No external dependency.

API:
```ts
export function NoralMark(props: { size?: number; color?: string }): JSX.Element;
export function NoralSymbol(props: { size?: number; ground?: string; color?: string }): JSX.Element;
export function NoralWordmark(props: { size?: number; inkColor?: string; aiColor?: string }): JSX.Element;
export function NoralPrimary(props: { size?: number; inkColor?: string; accent?: string; gap?: number }): JSX.Element;
export function NoralStacked(props: { size?: number; inkColor?: string; accent?: string }): JSX.Element;
```

### 3.2 shadcn primitive overrides

#### Button (`ui/src/components/ui/button.tsx`)

- Bump base `font-medium` → `font-semibold` (matches brand 600).
- Bump `letterSpacing` to `-0.01em` via class or inline.
- Override default radius: change `rounded-md` → `rounded-sm` for `default`/`secondary`/`outline` sizes (matches brand 10px).
- Add new variant `ghost-inverted` for use on dark sections (cream text, white-25 border).

#### Card (`ui/src/components/ui/card.tsx`)

- Bump default `rounded-md` → `rounded-xl` (16px, matches noral.ai system/diff cards).
- Default padding stays — surface-specific cards override.

#### Input (`ui/src/components/ui/input.tsx`)

- Confirm focus state uses `--ring` (already does via `focus-visible:ring-ring`). After Phase 1, ring is signal. ✓
- Bump radius `rounded-md` → `rounded-sm` (10).
- No other change needed.

#### Sidebar (`ui/src/components/Sidebar.tsx`)

- Replace any text-only "NoralOS" header with `<NoralPrimary size={28}>`.
- If sidebar is dark, pass `inkColor={var(--brand-cream)}` (or pass cream).
- Active-link affordance: keep current bg-fill but tint with `--brand-signal` at low opacity, OR swap to a 2px left border in `--brand-signal` (visual A/B during Phase 3).

#### SidebarAccountMenu (`ui/src/components/SidebarAccountMenu.tsx:183`)

- Replace plain `"NoralOS v{version}"` line with `<NoralWordmark size={11}>` followed by version in `font-mono` 11px.

### 3.3 Eyebrow / display utilities

Where the existing UI uses small uppercase labels (e.g. `CompanySettingsSidebar`, section headers in Settings), audit and switch the rendering classes to `brand-eyebrow` (added in Phase 1).

### Phase 3 build verify

- `pnpm typecheck`
- `pnpm --filter @noralos/ui build`
- Visual: dev server, walk through each shadcn-using surface (dialogs, popovers, toasts, dropdowns, sidebar, account menu)
- Verify primary button = signal-orange + cream + radius 10 + weight 600
- Verify focus ring on inputs = signal-orange

**Commit:** `style(brand): phase 3 — Brand logo component + shadcn primitive overrides (Button, Card, Input, Sidebar)`

---

## Phase 4 — Page-level layouts

**Files touched:** `ui/src/pages/Auth.tsx`, login flow, splash/empty-state surfaces.

### 4.1 Auth / Login screen (`ui/src/pages/Auth.tsx`, `ui/src/pages/CliAuth.tsx`)

- Replace plain "NoralOS" text with `<NoralStacked size={120} accent={var(--brand-signal)} />`.
- Background = `var(--background)` (paper in light, ink in dark).
- Headline above sign-in form: brand-h2 weight, no shadow, generous spacing.
- "Talk to us" / "Continue" CTA = primary button.

### 4.2 Empty states / 404 / no-data

Anywhere the app shows an empty illustration or text, prefer terse declarative copy in brand voice. Optional: add `<NoralMark size={48} opacity={0.08}>` decorative.

### 4.3 Splash / boot

If there is a loading state during initial app boot (check `ui/src/main.tsx` and `App.tsx`), show `<NoralSymbol size={96}>` centered on `--background`.

### 4.4 Dashboard / settings — surface tokens

Audit each top-level page to ensure:
- Page bg = paper
- Section dividers use `--brand-rule` (1px)
- Active nav state uses `--brand-signal` accent
- Stat displays (cost / token usage / agent counts) use Inter 800 large numerals

### Phase 4 build verify

- `pnpm typecheck`
- Visual walk-through: login → first-run wizard → dashboard → company settings → routine detail → agent detail
- Capture screenshots for VERIFY (handled in Phase 5 / verify step)

**Commit:** `style(brand): phase 4 — page-level layouts (login, splash, empty states, dashboard surfaces)`

---

## Phase 5 — Copy + final polish

**Files touched:** assorted UI string locations (small, surgical edits).

### 5.1 Wordmark accents

Locations to inject `<NoralWordmark>` (signal-orange "AI") instead of plain text "NoralOS":
- Auth screen welcome line: "Welcome to **noralAI**" instead of "NoralOS"
- About/version line in Account menu (already in Phase 3)
- Onboarding "claim CEO" header (if exists)
- Any "Powered by NoralOS" footer-like string

### 5.2 Marketing-y string tightening

A small grep over UI strings looking for hedging language ("might", "could", "may want to"), passive voice, or marketing hyperbole — replace with declarative sentence-fragment style. Conservative: only touch user-visible product copy, never error messages from `services/errors.ts`.

### 5.3 README and on-disk docs (nice-to-have, not blocking PR)

The README's tagline is currently "Noral-AI's agent management OS — orchestration for autonomous AI companies." That's already in brand voice. Consider tightening to match the noral.ai homepage hero phrasing, but only if it improves the tagline. Skip if unsure.

### Phase 5 build verify

Same as previous phases plus run the full lint:

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm --filter @noralos/ui build
pnpm --filter @noralos/ui exec eslint .   # if eslint configured
```

**Commit:** `style(brand): phase 5 — copy polish + wordmark accents`

---

## After Phase 5: BRAND_VERIFY.md + PR

(Not a phase — wrap-up.)

1. Spin up dev server, capture screenshots at 1440px desktop and 390px mobile for: home/dashboard, login, settings, agent detail (the closest equivalents to home/login/dashboard/settings on noral.ai). Capture matching pages on noral.ai (just home + contact since that's what the brand site has).
2. Side-by-side in `BRAND_VERIFY.md`.
3. Run accessibility check: contrast ratios on every brand color pair (signal-on-ink, ink-on-paper, mist-on-paper, cream-on-ink). Document focus-state visibility, ARIA labels on logo + icon-only buttons.
4. Confirm zero 404s for logos / fonts / OG via Network tab.
5. Push branch.
6. Open PR with:
   - Summary
   - Links to BRAND_AUDIT.md, BRAND_GAP.md, PLAN.md, BRAND_VERIFY.md
   - Screenshot grid
   - **Deviations list** (running):
     - `--destructive` kept as shadcn default (brand has no error red)
     - `--chart-1..5` kept as shadcn defaults (multi-hue dataviz palette; brand has none)
     - shadcn Dialog/Popover shadows kept (product UX needs elevation; brand site is shadow-free by design)
     - Top-nav structure: NoralOS uses left sidebar (product density), noral.ai uses horizontal sticky nav (marketing). Logo lockup applied to both contexts.
     - Marketing footer not added (app shells don't have one)
   - Accessibility check result
   - Build/test status

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Phase 1 token remap breaks visual layouts (e.g. shadcn `accent` was identical to muted, now jumps to signal-orange — could surface unintended orange backgrounds in muted-rendered surfaces) | Visual walk-through after Phase 1 commit, before Phase 2. Adjust per-component if needed. |
| `--radius` jump from 0 to 14px softens every card edge — may feel "too round" in dense data tables | If so, swap data-table cards to `rounded-sm` (10px) explicitly. Document in deviations. |
| Inter 800 doesn't load on first paint, FOUT shifts layout | `display=swap` is in the Google Fonts URL (already). For zero-flash, would need to self-host — out of scope. |
| Favicon raster generation differs in fidelity per tool | Document chosen tool in commit; manually inspect each output before committing. |
| Auth screen brand placement competes with form chrome | Kept simple: stacked logo above form, no decorations. |

---

## Total scope

- ~5 files touched in Phase 1
- ~14 files added (`ui/public/brand/*` + favicons + `og.png`) + 1 file edited in Phase 2
- ~8 files touched in Phase 3
- ~4–6 files touched in Phase 4
- ~10 files touched in Phase 5

Total: roughly 30–40 file edits across 5 commits.

---

**Awaiting approval. Reply with `proceed` (or with specific feedback) to start Phase 1.**
