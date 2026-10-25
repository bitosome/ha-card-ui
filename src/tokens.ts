import { css, CSSResultGroup, unsafeCSS } from "lit";

/**
 * Canonical design tokens for the bitosome Home Assistant card family.
 *
 * Extracted from Space Hub Card. @bitosome/ha-card-ui is the canonical source.
 * Consume the pinned package; do not copy these values between repositories.
 *
 * It is intentionally framework-agnostic: `DESIGN_TOKENS_CSS` is a plain CSS
 * string (usable by vanilla `customElements` cards that build a <style> tag),
 * and `designTokens` wraps it for LitElement `static styles` composition.
 *
 * Do NOT hardcode colors/spacing in component code — reference these variables
 * so every card stays visually consistent.
 */
export const DESIGN_TOKENS_CSS = `
  :host {
    display: block;
    /* Chip styling variables */
    --chip-padding: 2px 2px;
    --chip-text-font-weight: 700;
    --chip-text-font-size: var(--chip-font-size, 12px);
    --chip-background-color: rgba(0,0,0,0.06);
    --chip-border-radius: var(--ha-badge-border-radius, 999px);
    --chip-gap: 6px;
    --main-light-on-bg: linear-gradient(135deg,#ffcf57,#ffb200);
    --main-light-off-bg: rgba(0,0,0,0.06);
    --main-light-icon-on-color: #ffffff;
    --main-light-icon-off-color: var(--secondary-text-color);
    --switch-on-color: var(--switch-on-yellow, #ffc107);
    --switch-smart-on-color: var(--switch-on-green, #00c853);
    --switch-lock-unlocked-color: var(--switch-unlocked-red, #e53935);
    --lock-spinner-color: var(--primary-text-color, #ffffff);
    --switch-chip-bg: var(--chip-background-color, rgba(0,0,0,0.06));
    --switch-icon-size: 28px;
    --ac-chip-bg-off: rgba(158,158,158,0.95);
    --ac-chip-bg-cool: #00aaff;
    --ac-chip-bg-heat: #ff7043;
    --ac-chip-bg-dry: #ffca28;
    --ac-chip-bg-fan: #66bb6a;
    --ac-chip-bg-auto: #26c6da;
    --ac-chip-bg-default: rgba(0,0,0,0.06);
    --ac-chip-icon-color: #ffffff;
    --ac-chip-icon-off-color: #ffffff;
    --ac-fan-color-off: gray;
    --ac-fan-color-cool: #00aaff;
    --ac-fan-color-heat: #ff7043;
    --ac-fan-color-dry: #ffca28;
    --ac-fan-color-fan: #66bb6a;
    --ac-fan-color-auto: #26c6da;
    --ac-fan-color-default: var(--paper-item-icon-color);
    --thermostat-heating-color: #ff7043;
    --thermostat-idle-color: #66bb6a;
    --thermostat-off-color: gray;
    --thermostat-pill-heating-bg: var(--state-climate-heat-color, #ff7043);
    --thermostat-pill-heating-fg: var(--primary-background-color, #fff);
    --thermostat-pill-idle-bg: var(--chip-background-color, rgba(0,0,0,0.06));
    --thermostat-pill-idle-fg: var(--secondary-text-color);

    /* Shared semantic status palette (single source of truth across cards) */
    --status-on-color: #ffc107;
    --status-active-color: #42a5f5;
    --status-success-color: #66bb6a;
    --status-alert-color: #e53935;
    --status-warn-color: #ff9800;
    --status-cool-color: #00aaff;
    --status-heat-color: #ff7043;
    --status-dry-color: #ffca28;
    --status-fan-color: #66bb6a;
    --status-auto-color: #26c6da;
    --status-smartplug-on-color: #ff9800;
    --status-presence-color: #42a5f5;
    --status-icon-on-color: #ffffff;

    /* Positioning variables */
    --tile-padding: 8px;
    --tile-padding-large: 12px;
    --chip-z-index: 3;
    --tile-z-index: 2;
    --glow-z-index: 1;

    /* Tile shape control */
    --tile-border-radius: var(--ha-card-border-radius, 12px);

    /* Common gaps and spacing */
    --small-gap: 2px;
    --medium-gap: 6px;
    --large-gap: 12px;

    /* Shadow variables */
    --tile-shadow-default: 0 6px 18px rgba(0,0,0,0.10);
    --tile-shadow-hover: 0 12px 24px rgba(0,0,0,0.16);
    --tile-shadow-active: 0 18px 40px var(--pulse-strong, rgba(0,0,0,0.18)), 0 6px 18px var(--pulse-weak, rgba(0,0,0,0.10));
  }
`;

/** LitElement-ready design tokens for `static styles` composition. */
export const designTokens: CSSResultGroup = css`
  ${unsafeCSS(DESIGN_TOKENS_CSS)}
`;
