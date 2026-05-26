/**
 * NoralAI brand mark / lockup components.
 *
 * Geometry sourced verbatim from the noral.ai production site at
 * `https://www.noral.ai/components/Brand.jsx`. Same SVG construction:
 * filled dot + 3 concentric arcs (signal waves), opacity stepping down.
 *
 * All color defaults pull from CSS variables added in Phase 1 of the
 * brand alignment (`--brand-ink`, `--brand-cream`, `--brand-signal`).
 */

import { type CSSProperties } from "react";

const BRAND_INK = "var(--brand-ink, #0A1F2E)";
const BRAND_CREAM = "var(--brand-cream, #F5F1EA)";
const BRAND_SIGNAL = "var(--brand-signal, #FF5B2E)";

type MarkProps = {
  /** Total size (px) of the SVG bounding box. */
  size?: number;
  /** Stroke + dot color. Defaults to brand signal orange. */
  color?: string;
  /** Optional class name */
  className?: string;
  /** Optional style overrides */
  style?: CSSProperties;
  /** Override aria-label. Defaults to aria-hidden when used decoratively. */
  "aria-label"?: string;
};

/**
 * NoralMark — the signal-wave glyph (no ground). Used as a decorative
 * icon, large background overlay, or inside a colored Symbol container.
 *
 * viewBox 240×240, mark offset to (95, 120). Dot r=18, arcs at radii
 * 44/70/96, stroke 6, opacities 1.0 / 0.55 / 0.25.
 */
export function NoralMark({
  size = 120,
  color = BRAND_SIGNAL,
  className,
  style,
  "aria-label": ariaLabel,
}: MarkProps) {
  const labelled = Boolean(ariaLabel);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={labelled ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={labelled ? undefined : true}
      className={className}
      style={style}
    >
      <g transform="translate(95 120)">
        <circle cx="0" cy="0" r="18" fill={color} />
        <path
          d="M 30 -30 A 44 44 0 0 1 30 30"
          stroke={color}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 52 -46 A 70 70 0 0 1 52 46"
          stroke={color}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          opacity="0.55"
        />
        <path
          d="M 74 -62 A 96 96 0 0 1 74 62"
          stroke={color}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          opacity="0.25"
        />
      </g>
    </svg>
  );
}

type SymbolProps = MarkProps & {
  /** Background color of the rounded square. Defaults to brand ink. */
  ground?: string;
  /** Border-radius in px. Defaults to size * 0.17 (matches --r-tile). */
  radius?: number;
};

/**
 * NoralSymbol — the mark on a rounded-square ink ground. Used as a
 * favicon, app icon, splash glyph, or PFP/avatar in product chrome.
 */
export function NoralSymbol({
  size = 120,
  ground = BRAND_INK,
  color = BRAND_SIGNAL,
  radius,
  className,
  style,
  "aria-label": ariaLabel = "NoralAI",
}: SymbolProps) {
  const r = radius ?? size * 0.17;
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        background: ground,
        borderRadius: r,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
      role="img"
      aria-label={ariaLabel}
    >
      <NoralMark size={size} color={color} />
    </div>
  );
}

type WordmarkProps = {
  /** Font-size of the wordmark in px. */
  size?: number;
  /** Color of the "noral" portion. Defaults to brand ink. */
  inkColor?: string;
  /** Color of the "AI" portion. Defaults to brand signal orange. */
  aiColor?: string;
  /** Optional class name */
  className?: string;
  /** Optional style overrides */
  style?: CSSProperties;
};

/**
 * NoralWordmark — Inter 800, tight tracking, "noral" + signal-orange "AI".
 * Designed to scale by parent font-size when `size` is omitted.
 */
export function NoralWordmark({
  size,
  inkColor = "currentColor",
  aiColor = BRAND_SIGNAL,
  className,
  style,
}: WordmarkProps) {
  return (
    <span
      className={className}
      style={{
        fontFamily: "var(--font-display, 'Inter', sans-serif)",
        fontWeight: 800,
        fontSize: size,
        letterSpacing: "-0.045em",
        color: inkColor,
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      noral<span style={{ color: aiColor }}>AI</span>
    </span>
  );
}

type LockupProps = {
  /** Wordmark font-size in px. Mark scales relative to this. */
  size?: number;
  /** Color of the "noral" portion. */
  inkColor?: string;
  /** Color of mark + "AI". Defaults to brand signal. */
  accent?: string;
  /** Gap (px) between mark and wordmark. Defaults to size * 0.25. */
  gap?: number;
  className?: string;
  style?: CSSProperties;
};

/**
 * NoralPrimary — primary horizontal lockup: mark to the left of wordmark.
 * Used in app navigation, headers, and external page footers.
 */
export function NoralPrimary({
  size = 28,
  inkColor = "currentColor",
  accent = BRAND_SIGNAL,
  gap,
  className,
  style,
}: LockupProps) {
  const _gap = gap ?? size * 0.25;
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: _gap,
        ...style,
      }}
      role="img"
      aria-label="NoralAI"
    >
      <NoralMark size={size * 1.5} color={accent} />
      <NoralWordmark size={size} inkColor={inkColor} aiColor={accent} />
    </span>
  );
}

/**
 * NoralStacked — mark above wordmark. Used on login screens, splash,
 * and other vertical-real-estate surfaces.
 */
export function NoralStacked({
  size = 80,
  inkColor = "currentColor",
  accent = BRAND_SIGNAL,
  className,
  style,
}: LockupProps) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: size * 0.2,
        ...style,
      }}
      role="img"
      aria-label="NoralAI"
    >
      <NoralMark size={size * 2} color={accent} />
      <NoralWordmark size={size} inkColor={inkColor} aiColor={accent} />
    </span>
  );
}
