# BRAND_AUDIT — noral.ai

**Audited:** 2026-05-01
**Source:** https://www.noral.ai/ (production site, served from Vercel)
**Stack of source:** runtime-Babel React 18.3.1 SPA. Brand-defining CSS lives in `https://www.noral.ai/brand-tokens.css`; presentation logic lives in JSX modules served as static assets (`components/Brand.jsx`, `site/Layout.jsx`, `site/Primitives.jsx`, `site/HomePage.jsx`, `site/ContactPage.jsx`).
**Extraction method:** every value below is the literal token from those production files (curl-fetched). For dynamic/computed values that diverge from declarations, see "Limitations" at the end.

---

## 1. Colors

All values quoted from `brand-tokens.css` `:root`, with confirming usage from JSX.

| Token | Hex / value | Where it appears | Source line |
|---|---|---|---|
| `--ink` | `#0A1F2E` | Primary text, dark backgrounds (hero, footer, dark sections), wordmark "noral" | `brand-tokens.css:9` (`--ink: #0A1F2E; /* primary ink, near-black navy */`) — used as `INK` constant in `site/Layout.jsx:3` and as `background: INK` in `HomePage.jsx:7` (hero `<section data-section="hero" style={{ background: INK ...`) |
| `--ink-2` | `#122a3c` | Inverted/secondary card surface | `brand-tokens.css:10` |
| `--cream` | `#F5F1EA` | Cards on dark, text on dark, body-on-cream sections | `brand-tokens.css:11` |
| `--paper` | `#FAF7F1` | Page background (`<body>`), card-on-cream surfaces | `brand-tokens.css:12` — applied to `body { background: var(--paper); }` at `brand-tokens.css:35` |
| `--sand` | `#ECE6DA` | Subtle surface (declared, light usage in repo) | `brand-tokens.css:13` |
| `--signal` | `#FF5B2E` | **Primary accent** — CTAs, the "AI" in wordmark, focus rings, active nav underline, all `<Wordmark>` accents | `brand-tokens.css:14` (`--signal: #FF5B2E; /* primary accent — voice/signal orange */`) — confirmed by `<Button variant="primary" style={{ background: SIGNAL ... }}>` in `Primitives.jsx:9` |
| `--signal-soft` | `#ff8b65` | Hover/secondary signal | `brand-tokens.css:15` |
| `--signal-quiet` | `#ffd4c2` | Backgrounds tinted with signal | `brand-tokens.css:16` |
| `--stone` | `#4a5560` | Body text on cream | `brand-tokens.css:17` (`--stone: #4a5560; /* body text on cream */`) |
| `--mist` | `#7d8a96` | Muted meta text, eyebrow color, field labels | `brand-tokens.css:18` (`--mist: #7d8a96; /* muted meta */`) |
| `--rule` | `rgba(10, 31, 46, 0.10)` | Hairlines on cream | `brand-tokens.css:20` |
| `--rule-strong` | `rgba(10, 31, 46, 0.20)` | Stronger hairlines | `brand-tokens.css:21` |

### Auxiliary colors (not in brand-tokens.css but used in production HomePage)

| Hex | Where | Source |
|---|---|---|
| `#5dd28a` | "Live" indicator dot in `OpsPanel`, green CRM-sync status | `HomePage.jsx:251` (`background: "#5dd28a"`), `:264` |
| `rgba(245,241,234,0.78)` | "Cream-78" — eyebrow on dark, footer body, mono meta on dark | repeated literal in `Layout.jsx`, `HomePage.jsx` |
| `rgba(245,241,234,0.10)` ↔ `0.25` | Borders / hairlines on dark sections | `Layout.jsx:36`, `Primitives.jsx:13` (ghost button border) |
| `${INK}11` (`rgba(10,31,46,0.067)`) | Card borders on cream | `HomePage.jsx:62`, `:130`, etc. |
| `${INK}19` (`rgba(10,31,46,0.098)`) | Stat-card top border, form input border | `Primitives.jsx:23`, `ContactPage.jsx (Field.inputStyle)` |
| `${INK}33` (`rgba(10,31,46,0.20)`) | Secondary button border | `Primitives.jsx:11` |
| `${INK}44` (`rgba(10,31,46,0.27)`) | "From" line-through decoration on shift cards | `HomePage.jsx:130` |

---

## 2. Typography

### Font stack

Quoted from `brand-tokens.css:24-27`:

```
--font-display: "Inter", -apple-system, "Segoe UI", Roboto, sans-serif;
--font-body:    "Inter", -apple-system, "Segoe UI", Roboto, sans-serif;
--font-mono:    "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
--font-serif:   "Fraunces", ui-serif, Georgia, serif;
```

### Loaded fonts

From the live `<head>` (homepage.html):

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

- **Inter** weights loaded: 400, 500, 600, 700, 800
- **JetBrains Mono** weights loaded: 400, 500, 600
- **Fraunces** is **declared but NOT loaded** on the homepage. Treat as a future/optional serif.

### Type roles (extracted from `Primitives.jsx`, `Layout.jsx`)

| Role | Font | Weight | Size | Line-height | Letter-spacing | Source |
|---|---|---|---|---|---|---|
| Display (h1) | Inter | 800 | 72 default · 108 hero · clamp(40,9vw,64) ≤768 | 0.98 (1.05 mobile) | -0.045em | `Primitives.jsx (Display)` + `brand-tokens.css:73` |
| Hero display | Inter | 800 | 108 | 0.98 | -0.045em | `HomePage.jsx:14` (`<Display size={108}`) |
| H2 | Inter | 800 | 48 · clamp(28,6vw,40) ≤768 | 1.05 | -0.04em | `Primitives.jsx (H2)` + `brand-tokens.css:74` |
| Lede | Inter | 400 | 18 · 17 ≤768 (line-h 1.5 mobile) | 1.55 | (none) | `Primitives.jsx (Lede)` + `brand-tokens.css:75` |
| Body | Inter | 400 | 14–15 (per surface) | 1.5–1.6 | -0.005em on muted body | `Layout.jsx`, `HomePage.jsx` |
| Pull-quote (footer & section headlines mid-body) | Inter | 700 | 22–26 | 1.15–1.2 | -0.025em | `Layout.jsx:128`, `HomePage.jsx (SystemCard.title)` |
| Stat value | Inter | 800 | 56 (24 in MiniStat) | 1 (1.1 MiniStat) | -0.045em (-0.035em MiniStat) | `Primitives.jsx (StatCard)`, `HomePage.jsx (MiniStat)` |
| Wordmark inline | Inter | 800 | inherit | 1 | -0.045em | `Primitives.jsx (Wordmark)` |
| Eyebrow (mono) | JetBrains Mono | 500–600 | 11 (10 minor, 9 micro) | (default) | 0.16em (0.18em hero/microvariant; 0.14em differentiation cards) | `brand-tokens.css:39-46`, `Layout.jsx:184`, `HomePage.jsx:177` |
| Field label (mono) | JetBrains Mono | 600 | 10 | (default) | 0.16em uppercase | `ContactPage.jsx (Field.label)` |
| Mono meta on dark | JetBrains Mono | 500 | 11 | (default) | 0.16em uppercase | `Layout.jsx:153` |

> **Sentence-case rule** (verbatim from observed copy): headlines are sentence case with periods. Only `data-type` mono labels use `text-transform: uppercase`.

---

## 3. Spacing scale

There is no published spacing-scale token file. Spacing is applied via inline `style={{ padding, gap, marginTop }}` numbers. Sampled values (every value in this list is a literal taken from a JSX file):

| Use | Value (px) | 5 sampled call-sites |
|---|---|---|
| Section vertical padding (desktop) | **96** (default `paddingY`) · **120** (most sections) · **100** (final CTAs) | `Layout.jsx:194` (default), `HomePage.jsx:39, 75, 119, 167, 200` |
| Section horizontal padding (desktop) | **32** | `Layout.jsx:194` (`padding: \`${paddingY}px 32px\``); also `HomePage.jsx:7` |
| Mobile section padding | **64 / 56 / 20** (hero / section / horizontal) | `brand-tokens.css:80-82` |
| Container max-width | **1200** | `Layout.jsx:38, 124, 196` (every `<div style={{ maxWidth: 1200 ... }}>`) |
| Card padding | **22** (shift card) · **28** (system card, ops panel) · **32** (differentiation card) | `HomePage.jsx:62, 138, 220, 184` |
| Grid gap (multi-col) | **12 / 14 / 16 / 32 / 48 / 80** | `HomePage.jsx:42 (gap: 80)`, `:75 (gap: 16)`, `:119 (gap: 14)`, `:152 (gap: 16)`, `Layout.jsx:122 (gap: 48)` |
| Inline button gap (cluster) | **12** | `HomePage.jsx:18, 145, 209` |
| Label/title vertical spacing (eyebrow → headline) | **14 / 16 / 24** | `HomePage.jsx:46, 78, 118, 138, 175` |
| Mobile grid gap override | **32** | `brand-tokens.css:65` (`gap: 32px !important;`) |

The pattern: a 4 / 8 / 12 / 14 / 16 / 20 / 22 / 24 / 28 / 32 / 40 / 48 / 56 / 64 / 80 / 96 / 100 / 120 sequence — **not a strict 4-based scale**, but heavily clustered around 8s and 4s. Most cards padding 22–32, most section paddings 96–120.

---

## 4. Radii, borders, shadows

### Radii (`brand-tokens.css:30-34`)

```
--r-sm:  10px
--r-md:  14px
--r-lg:  20px
--r-xl:  28px
--r-tile: 17%   /* matches symbol mark — 40/240 ≈ 17% */
```

Confirmed usages: buttons / nav CTAs use 10. Form inputs use 10 (`ContactPage.jsx Field.inputStyle`). Shift cards use 14. System cards / ops panel border-radius 16–20. Differentiation cards 16. Symbol-mark tile uses 17%.

### Borders

- **Card on cream**: `1px solid ${INK}11` (i.e. `rgba(10,31,46,0.067)`). Five sampled occurrences: `HomePage.jsx:62, 130, 178, 220` and `OpsPanel` separator at `:262`.
- **Card on dark**: `1px solid rgba(245,241,234,0.12)` to `0.15`.
- **Button "secondary"**: `1px solid ${INK}33`.
- **Button "ghost"** (on dark): `1px solid rgba(245,241,234,0.25)`.
- **Form input**: `1px solid ${INK}19`.
- **Active nav-link underline**: `2px solid ${SIGNAL}`, otherwise transparent (no shift on hover; opacity 0.85 on `<a:hover>` per inline style block in homepage.html).

### Shadows

**No `box-shadow` is declared anywhere in `brand-tokens.css` or sampled JSX.** The brand uses borders + ground-color contrast, not shadow elevation. This is a deliberate signature (flat-on-paper).

---

## 5. Buttons

From `Primitives.jsx`:

```js
const variants = {
  primary:   { background: SIGNAL, color: CREAM, border: "none" },
  secondary: { background: "transparent", color: INK,   border: `1px solid ${INK}33` },
  ghost:     { background: "transparent", color: CREAM, border: `1px solid rgba(245,241,234,0.25)` },
  inverted:  { background: CREAM,  color: INK,   border: "none" },
};
const sizes = {
  sm: { padding: "8px 14px",  fontSize: 12 },
  md: { padding: "12px 20px", fontSize: 14 },
  lg: { padding: "16px 26px", fontSize: 15 },
};
// shared: fontFamily Inter, fontWeight 600, letterSpacing -0.01em, borderRadius 10,
//         display inline-flex, alignItems center, gap 8, textDecoration none.
```

**States** (from inline `<style>` in `homepage.html`):
- Hover: `button:hover { opacity: 0.92; }` and `a:hover { opacity: 0.85; }` — opacity-only, no color/background shift.
- No `:focus-visible` rule shipped (gap, see Limitations).

---

## 6. Components — verbatim HTML / JSX

### 6.1 Nav (`Layout.jsx`)

```jsx
<nav style={{
  position: "sticky", top: 0, zIndex: 50,
  background: inverted ? INK : `${PAPER}ee`,
  backdropFilter: "saturate(140%) blur(8px)",
  borderBottom: `1px solid ${inverted ? "rgba(245,241,234,0.10)" : `${INK}11`}`,
}}>
  <div style={{
    maxWidth: 1200, margin: "0 auto", padding: "18px 24px",
    display: "flex", alignItems: "center", justifyContent: "space-between",
  }}>
    <a href="index.html"><NoralPrimary size={28} inkColor={ink} accent={SIGNAL} /></a>

    <div className="nora-nav-desktop" style={{ gap: 32, alignItems: "center" }}>
      {/* nav links: Inter 500/14, letter-spacing -0.01em, active link gets 2px solid SIGNAL underline + 4px paddingBottom */}
      <a href="contact.html" style={{
        fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 13,
        color: CREAM, background: SIGNAL,
        padding: "10px 16px", borderRadius: 10, letterSpacing: "-0.01em",
      }}>Talk to us</a>
    </div>
    {/* mobile burger: 24px icon, 8px padding, 3-line ↔ X */}
  </div>
</nav>
```

Logo lockup at 28px size; CTA "Talk to us" pinned right.

### 6.2 Footer (`Layout.jsx`)

- Background `INK` (`#0A1F2E`), text `CREAM`.
- 4-column grid (`2fr 1fr 1fr 1fr`), gap 48, padding `64px 32px 32px`, `marginTop 80`.
- Pull quote: Inter 700/22, line-height 1.2, max-width 360.
- Section titles: JetBrains Mono 11/0.16em uppercase, weight 600.
- Bottom row: `© 2026 NoralAI · All rights reserved` (mono 11, uppercase, 0.16em). Matched by domain `noralai.com` on right.
- Mailto: `hello@noralai.com`.

### 6.3 Hero (`HomePage.jsx`)

```jsx
<section data-section="hero" style={{ background: INK, color: CREAM, padding: "120px 32px 100px", position: "relative", overflow: "hidden" }}>
  {/* subtle 32px dotted radial overlay at 0.05 opacity */}
  <div aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: 0.05, backgroundImage: `radial-gradient(${CREAM} 1px, transparent 1px)`, backgroundSize: "32px 32px" }} />
  {/* large NoralMark at 0.08 opacity, off-canvas right */}
  <div data-decorative="true" aria-hidden="true" style={{ position: "absolute", right: -100, top: 40, opacity: 0.08 }}>
    <NoralMark size={720} color={SIGNAL} />
  </div>
  <Eyebrow color="rgba(245,241,234,0.78)">Managed AI infrastructure & services</Eyebrow>
  <Display size={108} color={CREAM} style={{ marginTop: 28, maxWidth: 1080 }}>
    We don't sell software.<br />
    We deploy <span style={{ color: SIGNAL }}>AI workers.</span>
  </Display>
  <Lede color="rgba(245,241,234,0.78)" style={{ marginTop: 32, fontSize: 20, maxWidth: 720 }}>
    NoralAI builds and operates intelligent digital workforces — managed AI systems that take work from conversation through coordination to completion. Voice is often the entry point. The value is everything that happens after.
  </Lede>
  <div style={{ display: "flex", gap: 12, marginTop: 40 }}>
    <Button href="contact.html" variant="primary" size="lg">Talk to us →</Button>
    <Button href="platform.html" variant="ghost" size="lg">See what AI runs</Button>
  </div>
</section>
```

### 6.4 Card variants

- **System card** (`HomePage.jsx`): radius 16, padding 28, min-height 220, dark variant flips bg to ink + cream text. Top row: signal-orange "01"–"05" mono number. Bottom slab: signal arrow + outcome line in mono uppercase, separated by `borderTop`.
- **Differentiation card**: paper bg, ink/11 border, radius 16, padding 32. Header reads `Not <X> → <IS>` with line-through on the "Not" half (mono 11/0.14em). Title is Inter 700/26/-0.025em. Body is 15/stone/1.6.
- **Shift row**: cream bg, ink/11 border, radius 14, padding 22. Two halves separated by signal arrow `→`. Mono left (line-through), Inter 700 right.
- **OpsPanel**: ink bg, radius 20, padding 28. Live dot `#5dd28a` with pulsing 1.5px outline. 3-up MiniStats. Activity log uses `[time mono] [colored dot] [text]`. Bottom mono pill chips at 9px with 0.16em tracking.

### 6.5 Form input (`ContactPage.jsx`)

```jsx
const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: PAPER, border: `1px solid ${INK}19`, borderRadius: 10,
  padding: "12px 14px", fontFamily: "'Inter', sans-serif", fontSize: 14, color: INK,
  outline: "none",
};
// Label above field: mono 10, 0.16em, uppercase, color MIST, weight 600, marginBottom 8.
// Focus state from inline style: input:focus, textarea:focus { border-color: #FF5B2E !important; }
```

Submit button: full-width, signal bg, cream text, Inter 600/15.

---

## 7. Imagery

- **Logo system** (`components/Brand.jsx`): mark = filled dot + 3 concentric arcs at radii 44/70/96 (in 240vb), opacities 1.0 / 0.55 / 0.25. Symbol = mark on `INK` ground with rounded square radius `size * 0.17`. Wordmark = `noral` in ink + `AI` in signal, Inter 800, `-0.045em`. Primary lockup = mark `1.5×` text-size to the left of wordmark, gap `0.25×`. Stacked = mark `2×` above wordmark.
- **Decorative**: dotted radial overlays at 0.04–0.05 opacity (`32px` and `20px` grids) are the only background pattern. Used in hero and `OpsPanel`.
- **Photography**: none on the homepage. Brand is illustration-free + diagram-driven.
- **Gradients**: none in declared CSS. The signal accent is a flat color.

---

## 8. Animation

Declared properties (sampled across all JSX):

- Hover: `opacity 0.85` (links), `opacity 0.92` (buttons). No transition declaration — uses CSS default (i.e. instant). Browser default for `opacity` is 0s.
- "Live" dot pulse: a `position: absolute` 1.5px ring at opacity 0.4 around the green dot. **No keyframe animation** — the "pulse" is static visually, the appearance comes from the layered ring. (Production may have keyframes injected by JS that the static fetch missed; flag for runtime verification.)
- No declared `@keyframes`, no `transition`, no `transform` animation in `brand-tokens.css` or any sampled JSX.

This is consistent with the rest of the brand: minimal, no-flash.

---

## 9. Voice — verbatim samples

### Headlines (h1 / h2)

1. "We don't sell software. We deploy **AI workers**." — hero, `HomePage.jsx:14-17`
2. "Traditional systems stop at communication." / "Managed AI keeps going." — `HomePage.jsx:45-48`
3. "Most software helps people do their jobs." / "**noralAI** changes how work gets done." — `HomePage.jsx:121-127`
4. "Persistent. Task-oriented. Designed to do the work." — `HomePage.jsx:172`
5. "A digital workforce, deployed in weeks." — `HomePage.jsx:206`

**Pattern:** short declarative sentences. Period-driven. Hard claim followed by hard claim. Comma fragments allowed. The wordmark "noralAI" appears mid-headline as inline text, with "AI" colored signal-orange.

### Lede / body

1. "NoralAI builds and operates intelligent digital workforces — managed AI systems that take work from conversation through coordination to completion. **Voice is often the entry point. The value is everything that happens after.**" — hero lede
2. "An agent doesn't just answer the call. It captures and structures the information, triggers workflows across systems, assigns work, follows up, and moves the process forward — without human intervention." — `HomePage.jsx:50`
3. "Voice is the channel most people relate to. The full system manages everything that flows out of the conversation." — `HomePage.jsx:81`
4. "Not chatbots. Not scripted responders. Each agent is a configured role — receptionist, scheduler, dispatcher, intake coordinator, pipeline manager — handling communication, scheduling, data, and workflow execution with speed and consistency." — `HomePage.jsx:175`
5. "We design, deploy, and operate the system end to end. You don't hire an internal AI team." — differentiation card 1, `HomePage.jsx:155`

**Pattern:** prose uses em-dashes liberally. "Not X. Not Y." sentence-fragment opener. "The X is the Y" structures. First-person plural ("We") in voice statements; third-person agent ("It", "Each agent") in capability descriptions.

### CTAs

1. "Talk to us →" (primary, repeats across pages)
2. "See what AI runs"
3. "Explore the platform →"
4. "See industries"
5. "How it works"

**Pattern:** verb-led, sentence case, 2–4 words. Primary CTAs end with `→` (literal Unicode arrow, not an icon). Secondary CTAs do not.

### Eyebrows (mono uppercase)

1. "Managed AI infrastructure & services"
2. "From conversation to execution"
3. "Beyond voice · what managed AI runs"
4. "The shift"
5. "Differentiation"

**Pattern:** sentence case (rendered uppercase by CSS), middle-dot `·` (U+00B7) as separator, ampersand `&` for conjunction.

### Stat labels (mono uppercase)

1. "Coverage · always on"
2. "Rings · avg pickup"
3. "From first touch to outcome"
4. "Managed · we run it"
5. "Calls handled" / "Jobs scheduled" / "Pipeline moved"

**Pattern:** terse noun phrases. The middle-dot separates a category from a qualifier. Lowercase rendered uppercase by CSS.

### Form copy

- Form intro headline: "Tell us where you'd like to start." (Inter 700/24, ink)
- Eyebrow on form card: "Intro conversation · 45 minutes"
- Field labels: "Name", "Company", "Work email", "Phone", "Industry", "Role", "What's the bottleneck?"
- Placeholder voice: "Riley Chen", "ColeLand HVAC", "riley@company.com", "+1 (555) 123-4567", "Home Services · Healthcare · Government · …", "Missed calls. Manual scheduling. After-hours coverage. …"

**Pattern:** placeholders are real-feeling examples (a human name, a real-sounding company, a real-format phone), separated by middle-dot when listing alternatives, ending in `…` for open-ended fields.

### Error states

Not present in the fetched static SPA shell. The contact form `onSubmit` is `setSubmitted(true)` with no validation feedback. **Flag for runtime verification or new copy on agent.noral.ai.**

---

## 10. Logo usage map

Source files (read-only at `/Users/quentin/Documents/NORALAI/NoralAI Website/assets`):

| File | Bytes | Use case (inferred from `Brand.jsx` lockups + brand convention) |
|---|---|---|
| `noralai-logo-primary.svg` (963) / `.png` (25,429) | Horizontal lockup (mark + wordmark) | Default header lockup. Used at small sizes (28–80px) on light or dark grounds. Production renders at `<NoralPrimary size={28}>` in nav, `<NoralPrimary size={26}>` in footer. |
| `noralai-logo-stacked.svg` (992) / `.png` (46,238) | Mark above wordmark | Profile / avatar / vertical real-estate. Larger surfaces. |
| `noralai-logo-symbol.svg` (704) / `.png` (25,759) | Mark on dark rounded-square ground | Favicon, app icon, OG image standalone, social avatars. **17% radius is intentional** (matches `--r-tile`). |
| `og-default.svg` (1,985) / `.png` (64,197) | Open Graph 1200×630 share card | `og:image` and `twitter:card` `summary_large_image` source. Set in `<head>` `<meta property="og:image" content="...og-default.png">`. |

### Recommended in-product logo placements

- **App nav (left)**: `noralai-logo-primary.svg` at 28–32px height. Cream-on-dark or ink-on-paper depending on theme.
- **Login screen / empty states**: `noralai-logo-stacked.svg` at 80–120px.
- **Favicons** (browser tab + iOS): generated raster sizes from `noralai-logo-symbol.svg` at 16, 32, 180, 192, 512.
- **OG / social**: `og-default.png` direct copy as `/og.png`.
- **Loading splash / boot banner**: `noralai-logo-symbol.svg` at 96–144px on ink ground.

---

## 11. Limitations of this audit

This audit is **declared values only** — extracted from production source files (`brand-tokens.css`, JSX modules) via curl. The Chrome MCP and tier-read browser blocking prevented inspecting **computed** styles in DevTools.

For the brand-token CSS variables and JSX inline styles, declared = computed (no cascade overrides observed in the source). For the following, declared values may diverge from computed:

1. **Animations / transitions**: I saw zero declared. Production may inject keyframes via JS. Re-verify the "live" dot pulse and any micro-animations once Chrome MCP is back.
2. **`:focus-visible` outlines**: not declared in brand-tokens.css beyond the inline `input:focus` border-color rule. Browser default focus ring may apply elsewhere — flag for accessibility check in BRAND_VERIFY.md.
3. **Web font fallback substitution**: if Inter fails to load, system fallback `-apple-system, "Segoe UI", Roboto` will produce different metrics. Verify visually post-merge.
4. **Computed line-heights at clamp() boundaries**: mobile clamps in `brand-tokens.css:73-75` use `clamp(40px, 9vw, 64px)` etc. Actual rendered size depends on viewport.
5. **Error states in forms**: not present in the production static HTML for `contact.html`. Either validation is browser-default or the live SPA renders it after submit. NoralOS app should design its own error state on top of the brand tokens.

If exact match on computed styles is required, re-run with Chrome MCP / DevTools when available.
