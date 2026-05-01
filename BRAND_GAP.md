# BRAND_GAP — NoralOS vs noral.ai

For each finding in `BRAND_AUDIT.md`, this maps the corresponding location in the NoralOS codebase and notes the divergence with file path + line number. Anchors are against the `feat/brand-alignment-noral-ai` branch (off `master` @ `a09c4e4c`).

---

## 1. Colors

NoralOS currently uses the shadcn-default monochrome neutral palette in `oklch` space. **Every token needs to be remapped to the noral.ai brand.** No brand color is currently present in the codebase.

### Current state

`ui/src/index.css:42-77` (`:root`) and `ui/src/index.css:79-114` (`.dark`)

```css
:root {
  --background: oklch(1 0 0);          /* pure white */
  --foreground: oklch(0.145 0 0);      /* near-black neutral */
  --primary: oklch(0.205 0 0);         /* near-black neutral */
  --primary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);           /* identical to muted — no real accent */
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  /* ... plus card, popover, secondary, sidebar-* — all neutral grays ... */
}
```

### Mapping to brand (Phase 1)

| NoralOS token (current) | Brand token (target hex) | Why |
|---|---|---|
| `--background: oklch(1 0 0)` | `#FAF7F1` (paper) | Page bg matches noral.ai `body { background: var(--paper); }` |
| `--foreground: oklch(0.145 0 0)` | `#0A1F2E` (ink) | Primary text |
| `--card: oklch(1 0 0)` | `#FAF7F1` (paper) | Cards on cream sections; switch to `#F5F1EA` (cream) when card sits on paper |
| `--popover: oklch(1 0 0)` | `#FAF7F1` (paper) | |
| `--primary: oklch(0.205 0 0)` | `#FF5B2E` (signal) | **Critical**: primary is the brand orange, not near-black |
| `--primary-foreground: oklch(0.985 0 0)` | `#F5F1EA` (cream) | |
| `--secondary` | `#F5F1EA` (cream) | Secondary surface on paper |
| `--muted: oklch(0.97 0 0)` | `#ECE6DA` (sand) | Subtle surface |
| `--muted-foreground: oklch(0.556 0 0)` | `#7d8a96` (mist) | |
| `--accent` | `#FF5B2E` (signal) | brand has only one accent — orange |
| `--accent-foreground` | `#F5F1EA` (cream) | |
| `--border: oklch(0.922 0 0)` | `rgba(10,31,46,0.10)` (rule) | |
| `--input: oklch(0.922 0 0)` | `rgba(10,31,46,0.10)` (rule) | |
| `--ring: oklch(0.708 0 0)` | `#FF5B2E` (signal) | Focus ring is signal — verified against `input:focus { border-color: #FF5B2E !important; }` in noral.ai inline style |
| `--destructive: oklch(0.577 0.245 27.325)` | (keep) | brand has no spec'd error red; shadcn's default is fine — flag in deviations |

### New brand tokens to add

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
--brand-success: #5dd28a;   /* live-status green seen in OpsPanel */
```

### Dark theme (`.dark` block at `ui/src/index.css:79-114`)

NoralOS supports dark mode (per `<html class="dark">` default in `ui/index.html:2`). Noral.ai's "dark" sections (hero, footer, CTA strip) use **ink** as background and **cream** as foreground — not a separate dark palette. For NoralOS dark mode, the cleanest mapping is:

- `--background: #0A1F2E` (ink)
- `--foreground: #F5F1EA` (cream)
- `--card: #122a3c` (ink-2)
- `--primary: #FF5B2E` (signal — same in both modes)
- `--muted: rgba(245,241,234,0.08)`
- `--muted-foreground: rgba(245,241,234,0.78)`
- `--border: rgba(245,241,234,0.10)`
- `--ring: #FF5B2E`

### Rogue colors in NoralOS (not in brand spec)

| Where | Hex / token | Status |
|---|---|---|
| `ui/src/index.css:64-68` `--chart-1..5` (oklch greens/oranges/blues) | shadcn defaults | Off-brand — used for charts. Either remap to brand-derived tints (signal-soft, mist, stone, ink-2, cream) or document as deviation. |
| `ui/src/components/AsciiArtAnimation.tsx` (PaperclipSprite-related, post-rebrand) | font-family `monospace` literal | Should use `var(--font-mono)` once mono token exists. |
| `server/src/startup-banner.ts:43-48` ANSI palette (cyan/green/yellow/magenta/blue) | terminal output, not the web app | Out of scope for brand-fidelity (terminal uses ANSI codes, not CSS). |

---

## 2. Typography

### Fonts: not loaded

`ui/index.html` (current head) declares `<title>NoralOS</title>` but **does NOT load Inter or JetBrains Mono**. The CSS falls through to system sans / system mono.

**Gap:** add the same `<link>` noral.ai uses, verbatim:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

### Font-family tokens

NoralOS has no `--font-*` tokens. Tailwind v4's `@theme` block at `ui/src/index.css:6-46` is colors + radii only. Need to add:

```css
@theme inline {
  --font-sans: "Inter", -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  --font-display: "Inter", -apple-system, "Segoe UI", Roboto, sans-serif;
  /* (Fraunces declared in brand-tokens.css but not loaded — skip unless used) */
}
```

Then add base style:

```css
body { font-family: var(--font-sans); }
code, pre, .font-mono { font-family: var(--font-mono); }
```

### Type-role utilities

NoralOS doesn't have `display`, `h2`, `lede`, `eyebrow` style utilities; everything uses ad-hoc Tailwind classes. To match noral.ai cleanly, add semantic type classes in `ui/src/index.css`:

```css
.brand-display { font: 800 72px/0.98 var(--font-display); letter-spacing: -0.045em; }
.brand-h2      { font: 800 48px/1.05 var(--font-display); letter-spacing: -0.04em; }
.brand-lede    { font: 400 18px/1.55 var(--font-sans); }
.brand-eyebrow { font: 500 11px/1 var(--font-mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--brand-mist); }
```

### Current rogue font usages

| Where | What | Fix |
|---|---|---|
| `ui/src/components/AsciiArtAnimation.tsx:49,344` | `font-family: monospace` literal | Use `var(--font-mono)` |
| `ui/src/components/MarkdownBody.tsx:279` | `fontFamily: "inherit"` | Fine — let parent cascade dictate |

---

## 3. Radii

### Current state (`ui/src/index.css:43-46`)

```css
--radius-sm: 0.375rem;   /* ≈ 6px */
--radius-md: 0.5rem;     /* ≈ 8px */
--radius-lg: 0px;        /* SHADCN DEFAULT, but visually flat */
--radius-xl: 0px;        /* SHADCN DEFAULT, also 0 */
--radius:    0;          /* on :root */
```

### Brand spec (verbatim from `brand-tokens.css:30-34`)

```
--r-sm:  10px
--r-md:  14px
--r-lg:  20px
--r-xl:  28px
--r-tile: 17%   /* logo symbol mark only */
```

### Mapping

| NoralOS token | Current | Brand value (target) |
|---|---|---|
| `--radius-sm` | `0.375rem` | `0.625rem` (10px) |
| `--radius-md` | `0.5rem` | `0.875rem` (14px) |
| `--radius-lg` | `0px` | `1.25rem` (20px) |
| `--radius-xl` | `0px` | `1.75rem` (28px) |
| `--radius` (root) | `0` | `0.875rem` (14px) — most cards default to md |

This change cascades through every shadcn primitive (Button, Card, Dialog, Input, etc.) — that's the desired one-shot effect. **Risk: forms / popovers will visibly soften.** Verify each interactive surface.

---

## 4. Shadows / borders

### Shadows
NoralOS uses Tailwind's default shadow utilities (`shadow`, `shadow-sm`, etc.) freely — search hits in components: `ui/src/components/SidebarAccountMenu.tsx:163` (`shadow-2xl`), and similar in Popover/Dialog primitives.

**Brand has no shadow tokens.** noral.ai is flat-on-paper, contrast via borders + cream/paper fills.

**Decision (proposed deviation):** keep shadcn shadow utilities in NoralOS for usability — popovers and dialogs need elevation cues to read as floating. The brand pattern of "no shadow" suits a marketing site with sparse UI; an operations control plane with overlapping surfaces benefits from soft shadows. Document as a deviation in PR.

### Borders
NoralOS uses `border-border` (Tailwind utility → `var(--border)`). Once `--border` is remapped to `rgba(10,31,46,0.10)`, every existing `border-border` hits the brand value automatically.

---

## 5. Buttons

### Current state

NoralOS uses shadcn `Button` from `ui/src/components/ui/button.tsx` with variants `default`, `secondary`, `ghost`, `outline`, `destructive`, `link` and sizes `sm`, `default`, `lg`, `icon`.

After Phase 1 token swap, `default` (which uses `bg-primary text-primary-foreground`) will automatically render as **signal-orange + cream text** — that's the brand "primary" button. ✓

### Specific gaps

| Brand variant | shadcn variant | Status |
|---|---|---|
| `primary` (signal bg, cream text, weight 600, radius 10) | `default` | Match after Phase 1 token swap. Verify font weight (shadcn default `font-medium = 500`; brand wants 600). |
| `secondary` (transparent bg, ink text, ink/33 border) | `outline` | Close. shadcn `outline` uses `border-input bg-background hover:bg-accent` — replace with `border-primary/20 bg-transparent text-foreground` (Phase 3). |
| `ghost` (transparent bg, cream text, white-25 border, on dark) | `ghost` | shadcn `ghost` is `hover:bg-accent` — needs a "ghost-on-dark" variant. Add as new variant `ghost-inverted` in Phase 3. |
| `inverted` (cream bg, ink text) | `secondary` | Match if we map secondary to cream. |

### Button font-weight

shadcn default at `ui/src/components/ui/button.tsx`: `font-medium` (500). Brand: 600. Either bump shadcn's base to `font-semibold` (Phase 3) or accept the deviation.

### Button radius

After Phase 1 (`--radius` → 14px), shadcn's `rounded-md` resolves to 14px. Brand button radius is `10px` (`--r-sm`). Need to override shadcn `Button` to use `rounded-sm` instead of `rounded-md` (Phase 3).

---

## 6. Components

### Nav

NoralOS's app nav lives in `ui/src/components/Sidebar.tsx` (sidebar-driven nav, not a horizontal sticky nav). **This is a structural difference from noral.ai's marketing nav.** The control plane uses a left sidebar; the brand site uses a top horizontal nav.

**Decision:** keep the sidebar pattern (it's product-density-justified). Apply brand colors and logo lockup.
- `ui/src/components/Sidebar.tsx:?` — replace generic logo with `<img src="/noralai-logo-stacked.svg" />` or inline `<NoralPrimary>` SVG component (Phase 3).
- Active-link affordance: noral.ai uses 2px signal underline. NoralOS sidebar already has bg-fill on active; combine: signal-tinted bg or 2px left border in signal.
- Header strip on top of dashboard pages (`ui/src/components/CompanyRail.tsx`, `ui/src/components/SidebarAccountMenu.tsx`) needs the brand lockup.

### Footer

NoralOS has no marketing footer in the app shell. Brand footer lives only on noral.ai. **Skip.** (Document as deviation: app shells don't have marketing footers.)

### Cards

NoralOS uses shadcn `Card` from `ui/src/components/ui/card.tsx`. Brand cards (system, differentiation, shift) all use:
- radius 16
- padding 28–32
- 1px ink/11 border on cream variant
- ink bg + cream text on dark variant

After Phase 1 (border + radius mapping), shadcn `Card` will be close. May need to bump `Card` `rounded-` to `rounded-xl` (16) for visual match. Phase 3 polish.

### Form input

NoralOS uses shadcn `Input` from `ui/src/components/ui/input.tsx`. Brand input:
- bg = paper
- border = ink/19
- radius 10
- padding 12/14
- focus border-color = signal (`#FF5B2E`)

After Phase 1, `bg-input` and `border-input` map. Focus ring needs `--ring: #FF5B2E` (Phase 1 covers this). Padding/radius minor tune in Phase 3.

### CTAs

NoralOS Button + Phase 1 token swap = brand primary. But `font-weight 500 → 600` and `rounded-md → rounded-sm` need explicit override (Phase 3).

---

## 7. Imagery / Logo

### Current state

`ui/public/` contains generic favicons (`favicon.svg`, `favicon-16x16.png`, `favicon-32x32.png`, `favicon.ico`, `apple-touch-icon.png`, `android-chrome-192x192.png`, `android-chrome-512x512.png`, `site.webmanifest`). No noral.ai logo file is present. Inside JSX components, no Brand component, no logo SVG inline.

### Required imports (Phase 2)

Copy from `/Users/quentin/Documents/NORALAI/NoralAI Website/assets/`:

| Source file | Destination in repo | Purpose |
|---|---|---|
| `noralai-logo-primary.svg` | `ui/public/brand/noralai-logo-primary.svg` | Header lockup (used in Sidebar, app chrome) |
| `noralai-logo-primary.png` | `ui/public/brand/noralai-logo-primary.png` | PNG fallback for Open Graph etc. |
| `noralai-logo-stacked.svg` | `ui/public/brand/noralai-logo-stacked.svg` | Login screen, empty states |
| `noralai-logo-stacked.png` | `ui/public/brand/noralai-logo-stacked.png` | PNG fallback |
| `noralai-logo-symbol.svg` | `ui/public/brand/noralai-logo-symbol.svg` | Favicon source, splash |
| `noralai-logo-symbol.png` | `ui/public/brand/noralai-logo-symbol.png` | App-icon raster fallback |
| `og-default.svg` | `ui/public/og-default.svg` | OG image source |
| `og-default.png` | `ui/public/og.png` | OG image (referenced as `<meta property="og:image">`) |

### Favicon raster generation (Phase 2)

Generate from `noralai-logo-symbol.svg`:
- `ui/public/favicon-16x16.png` (replaces existing)
- `ui/public/favicon-32x32.png` (replaces existing)
- `ui/public/apple-touch-icon.png` (180×180, replaces existing)
- `ui/public/android-chrome-192x192.png` (replaces existing)
- `ui/public/android-chrome-512x512.png` (replaces existing)
- `ui/public/favicon.svg` (replace generic with the symbol mark)
- `ui/public/favicon.ico` — optional regeneration; noral.ai didn't use one (it does, fallback for old browsers)

Tool options: `sharp`, `inkscape`, `rsvg-convert`. Will use whichever is available locally; document choice in commit.

### Open Graph

`ui/index.html` currently has **zero** `<meta property="og:*">` tags. Add:

```html
<meta property="og:title" content="NoralOS" />
<meta property="og:description" content="..." />   <!-- TBD copy in Phase 5 -->
<meta property="og:image" content="/og.png" />
<meta property="og:url" content="https://agent.noral.ai/" />
<meta name="twitter:card" content="summary_large_image" />
```

### Inline brand SVG component

Recommended: port `Brand.jsx`'s `<NoralMark>` and `<NoralPrimary>` into a single TS component at `ui/src/components/brand/NoralLogo.tsx`. SVG-based, theme-aware (`color` prop), reusable across Sidebar / Login / Splash. Phase 3.

---

## 8. Animation

NoralOS uses shadcn primitives that include `tailwindcss-animate` (Phase 0 should verify). Brand has effectively no animation.

**Deviation (proposed):** keep shadcn motion (Dialog open/close, Popover fade, Toast slide). The brand site's flatness suits a marketing context; product UX expects motion cues. Document.

---

## 9. Voice

NoralOS is an internal control plane, not a marketing surface. Most copy is functional ("Save", "Cancel", "Open menu"). Heavily product-specific UI strings already match noral.ai voice (after Phase 1 of the recent rebrand merge: e.g. "NoralOS keeps the workspace record and issue history", "Required by NoralOS").

### Gap-worthy strings to align with brand voice (Phase 5)

Sample audit of UI copy that diverges from the noral.ai pattern:

| File | Current | Suggested |
|---|---|---|
| `ui/src/pages/CliAuth.tsx:79,123,125` | "The NoralOS CLI can now finish authentication on the requesting machine." | Already concise. Pattern OK. |
| `ui/src/pages/RoutineDetail.tsx:770` | "Save this now. NoralOS will not show the secret value again." | Strong. Period-driven. ✓ |
| `ui/src/pages/CompanyEnvironments.tsx:515` | "Runs on this NoralOS host." | ✓ |
| `ui/src/pages/Auth.tsx:82` | `<span>NoralOS</span>` in a sign-in card | OK; could add the inline "AI" wordmark accent |
| `ui/src/components/SidebarAccountMenu.tsx:183` | "NoralOS v{version}" | OK (mono treatment would match brand: render in `--font-mono`) |
| Empty states throughout | "No issues found." / "No agents yet." | Already terse. Pattern OK. |
| Error messages in `services/errors.ts` | "Company not found", "unprocessable" | Functional. Brand uses period-driven declarative — these match. |

**Bottom line on voice:** the previous rebrand work already aligned the prose to the noral.ai pattern (terse, declarative, period-driven). Phase 5 will be a light pass to add wordmark accents in select brand locations (Auth screen, Account menu, About / version display) and tighten any remaining marketing-style strings.

---

## 10. Logo placements (gap → assignment)

| Surface | Current state | Brand placement (Phase 3) |
|---|---|---|
| Browser tab favicon | Generic `favicon.svg`, `favicon-{16,32}.png` | Replace with files generated from `noralai-logo-symbol.svg` |
| iOS apple-touch-icon | Generic | Replace with 180×180 from symbol |
| Android chrome icons | Generic | Replace with 192×192 + 512×512 from symbol |
| Sidebar app logo | (no logo, just text "NoralOS") | `<NoralPrimary size={28}>` inline SVG (Phase 3) |
| Login screen | (no logo) | `<NoralStacked size={120}>` (Phase 3) |
| Account menu version line | Plain text "NoralOS v…" | Inline wordmark with signal "AI", mono version | (Phase 3) |
| Loading splash | (no splash) | Symbol mark on ink ground, `radius 17%` | (Phase 3, optional) |
| OG share card | No `<meta og:image>` | `/og.png` from `og-default.png` (Phase 2) |

---

## 11. Off-brand / rogue items not in noral.ai

| Where | What | Action |
|---|---|---|
| `ui/src/index.css:64-68` `--chart-1..5` | shadcn default oklch palette for charts | Either: (a) keep (dataviz often needs a multi-hue palette), document as deviation; or (b) remap to brand-derived: `--brand-signal`, `--brand-signal-soft`, `--brand-stone`, `--brand-mist`, `--brand-ink-2`. |
| `ui/src/index.css:98-103` `.dark` `--chart-1..5` | brighter shadcn defaults | Same as above |
| `ui/src/index.css:108-114` `.dark` `--sidebar-*` | shadcn defaults | Remap to brand dark equivalents |
| `cli/` (terminal output) ANSI cyan/green/yellow art | terminal banner uses ANSI codes | Out of scope (not CSS) |
| `ui/src/components/AsciiArtAnimation.tsx` `#PALETTE_*` | ASCII-art animation constants (probably kept the brand fidelity to the in-product easter-egg) | Audit-then-decide in Phase 4 |

---

## Summary table

| Audit area | Gap size | Phase |
|---|---|---|
| Color tokens (root + dark) | 100% remap | 1 |
| Font loading | Missing entirely | 1 |
| Font-family tokens | Missing entirely | 1 |
| Radii scale | All 4 values off | 1 |
| Type-role utilities | Don't exist | 1 (added) |
| Logo assets | None present | 2 |
| Favicon raster sizes | Generic, need regen | 2 |
| OG image + meta tags | Missing | 2 |
| Buttons (variant tweaks) | Font weight + radius override needed | 3 |
| Cards (radius bump) | shadcn default → 16 | 3 |
| Inline brand SVG component | Doesn't exist | 3 |
| Sidebar logo | Replace generic | 3 |
| Login / Auth visual | Add stacked logo | 4 |
| Account menu version | Add wordmark accent | 4 |
| Splash / loading | Optional addition | 4 |
| Voice polish | Light pass | 5 |
| Wordmark accents in select strings | A few locations | 5 |
