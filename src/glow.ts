import { css, html, nothing, type TemplateResult } from "lit";

/** Space Hub's two-layer under-tile glow. Domain code supplies activation/color. */
export interface PulseColors {
  weak: string;
  strong: string;
}
export type GlowMode = "static" | "pulse" | "none";
export interface GlowState {
  style: string;
  overlay: TemplateResult | typeof nothing;
}
export function buildGlow(
  pulse: PulseColors | undefined,
  mode: GlowMode = "static",
  active = false,
): GlowState {
  if (!pulse || mode === "none" || !active)
    return { style: "", overlay: nothing };
  const vars = `--pulse-weak: ${pulse.weak}; --pulse-strong: ${pulse.strong};`;
  const box = `box-shadow: 0 18px 40px var(--pulse-strong, ${pulse.strong}), 0 6px 18px var(--pulse-weak, ${pulse.weak});`;
  const animation =
    mode === "pulse" ? "animation: glowPulse 2.4s ease-in-out infinite;" : "";
  return {
    style: `${vars} ${animation} ${box}`,
    overlay: html`<div class="glow-overlay" aria-hidden="true"></div>`,
  };
}

/** Isolate the common ancestor of every adjacent surface, not nested tile subgroups. */
export const glowStyles = css`
  .family-tile-group {
    isolation: isolate;
  }
  .tile-wrap,
  .family-tile-wrap {
    position: relative;
  }
  .tile-wrap .glow-under,
  .family-tile-wrap .glow-under {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    display: block;
    border-radius: var(--tile-border-radius, 12px);
  }
  .glow-under .glow-overlay {
    position: absolute;
    inset: -10px -14px -18px -14px;
    border-radius: inherit;
    pointer-events: none;
    mix-blend-mode: screen;
    opacity: 0.9;
    -webkit-mask-image: linear-gradient(
      180deg,
      rgba(0, 0, 0, 0) 0%,
      rgba(0, 0, 0, 0.25) 18px,
      rgba(0, 0, 0, 0.9) 44px,
      rgba(0, 0, 0, 1) 100%
    );
    mask-image: linear-gradient(
      180deg,
      rgba(0, 0, 0, 0) 0%,
      rgba(0, 0, 0, 0.25) 18px,
      rgba(0, 0, 0, 0.9) 44px,
      rgba(0, 0, 0, 1) 100%
    );
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
  }
  .family-tile-face {
    position: relative;
    z-index: 1;
  }
  @keyframes glowPulse {
    0%,
    100% {
      box-shadow: 0 10px 20px var(--pulse-weak);
    }
    50% {
      box-shadow: 0 28px 56px var(--pulse-strong);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .glow-under,
    .glow-overlay {
      animation: none !important;
      transition: none !important;
    }
  }
`;

export function tileGlow(glow: GlowState): TemplateResult {
  return html`<div class="glow-under" style=${glow.style} aria-hidden="true">
    ${glow.overlay}
  </div>`;
}
