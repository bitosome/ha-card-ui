import { css, html, nothing, type TemplateResult } from "lit";
import { pendingIndicator } from "./components.js";
import { formatHassNumber, type FormatHass } from "./format.js";

/**
 * Overlay controls for live media, taken 1:1 from Camera Card's compact layout:
 * a top-right row of 44px rounded buttons 8px apart and 8px from the edges,
 * side navigation arrows, a zoom reset and centred messages. Fullscreen keeps
 * the same row and spacing; only the insets grow to clear notches and the home
 * indicator. Put the controls inside the element that goes fullscreen.
 */
export interface MediaButtonOptions {
  icon: string;
  /** Icon while `active`, e.g. `mdi:fullscreen-exit`. */
  activeIcon?: string;
  /** Names the action the button performs next. */
  label: string;
  onClick: (event: Event) => unknown;
  /** Primary fill for an on state (HD, recordings, fullscreen). */
  active?: boolean;
  /** Only for selectable items such as presets; view controls name their next action instead. */
  pressed?: boolean;
  pending?: boolean;
  disabled?: boolean;
  className?: string;
}

export function mediaButton(options: MediaButtonOptions): TemplateResult {
  const icon = options.active && options.activeIcon ? options.activeIcon : options.icon;
  return html`<button
    type="button"
    class="family-media-button ${options.active ? "active" : ""} ${options.className || ""}"
    title=${options.label}
    aria-label=${options.label}
    aria-pressed=${options.pressed === undefined ? nothing : String(options.pressed)}
    aria-busy=${options.pending ? "true" : nothing}
    ?disabled=${options.disabled}
    data-media-control
    @click=${options.onClick}
  >
    ${options.pending
      ? pendingIndicator()
      : html`<ha-icon .icon=${icon} aria-hidden="true"></ha-icon>`}
  </button>`;
}

/** The top-right control row. Pass `mediaButton()` results in reading order. */
export function mediaControls(
  buttons: unknown[],
  options: { className?: string; label?: string } = {},
): TemplateResult {
  return html`<div
    class="family-media-controls ${options.className || ""}"
    role="toolbar"
    aria-label=${options.label || "Camera controls"}
  >
    ${buttons}
  </div>`;
}

/** Shown while zoomed in; resets local magnification only. */
export function mediaZoomReset(options: {
  hass?: FormatHass;
  scale: number;
  onClick: (event: Event) => unknown;
}): TemplateResult | typeof nothing {
  if (!(options.scale > 1)) return nothing;
  return html`<button
    type="button"
    class="family-media-zoom-reset"
    aria-label="Reset zoom"
    data-media-control
    @click=${options.onClick}
  >
    ${formatHassNumber(options.hass, options.scale, { digits: 1 })}×
    <ha-icon .icon=${"mdi:magnify-minus-outline"} aria-hidden="true"></ha-icon>
  </button>`;
}

/** Previous/next arrows for switching between several cameras. */
export function mediaNavigation(options: {
  onPrevious: (event: Event) => unknown;
  onNext: (event: Event) => unknown;
  previousLabel?: string;
  nextLabel?: string;
}): TemplateResult {
  const previous = options.previousLabel || "Previous camera";
  const next = options.nextLabel || "Next camera";
  return html`<button
      type="button"
      class="family-media-nav previous"
      title=${previous}
      aria-label=${previous}
      data-media-control
      @click=${options.onPrevious}
    >
      <ha-icon .icon=${"mdi:chevron-left"} aria-hidden="true"></ha-icon></button
    ><button
      type="button"
      class="family-media-nav next"
      title=${next}
      aria-label=${next}
      data-media-control
      @click=${options.onNext}
    >
      <ha-icon .icon=${"mdi:chevron-right"} aria-hidden="true"></ha-icon>
    </button>`;
}

/** Centred status text over the media, e.g. "Loading camera…". */
export function mediaMessage(
  text: string,
  options: { icon?: string; className?: string; role?: "status" | "alert" } = {},
): TemplateResult {
  return html`<div class="family-media-message ${options.className || ""}" role=${options.role || "status"}>
    ${options.icon
      ? html`<ha-icon .icon=${options.icon} aria-hidden="true"></ha-icon>`
      : nothing}<span>${text}</span>
  </div>`;
}

const SAFE_INSETS = css`
  --family-media-inset-top: max(8px, var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 0px));
  --family-media-inset-right: max(8px, var(--safe-area-inset-right, 0px), env(safe-area-inset-right, 0px));
  --family-media-inset-bottom: max(8px, var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px));
  --family-media-inset-left: max(8px, var(--safe-area-inset-left, 0px), env(safe-area-inset-left, 0px));
`;

/**
 * Compose after familyStyles/componentStyles. Size the button with
 * `--family-media-button-size` (default 44px) and `--family-media-icon-size` (24px).
 */
export const mediaControlStyles = css`
  .family-media-controls {
    position: absolute;
    top: var(--family-media-inset-top, 8px);
    right: var(--family-media-inset-right, 8px);
    left: var(--family-media-inset-left, 8px);
    z-index: 3;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    pointer-events: none;
  }
  .family-media-controls > * {
    pointer-events: auto;
  }
  .family-media-button,
  .family-media-zoom-reset,
  .family-media-nav {
    box-sizing: border-box;
    border: 0;
    color: white;
    font: inherit;
    cursor: pointer;
    touch-action: manipulation;
  }
  .family-media-button {
    position: relative;
    z-index: 3;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: var(--family-media-button-size, 44px);
    height: var(--family-media-button-size, 44px);
    padding: 0;
    border-radius: var(--tile-border-radius, 12px);
    background: rgba(0, 0, 0, 0.42);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  .family-media-button ha-icon {
    --mdc-icon-size: var(--family-media-icon-size, 24px);
  }
  .family-media-button.active {
    background: var(--primary-color, #03a9f4);
  }
  .family-media-button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  /* The selected item also gets a ring, so it is not shown by colour alone. */
  .family-media-button[aria-pressed="true"] {
    box-shadow:
      inset 0 0 0 2px var(--text-primary-color, white),
      0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .family-media-button[aria-pressed="true"]:focus-visible {
    box-shadow:
      inset 0 0 0 3px var(--text-primary-color, white),
      inset 0 0 0 6px rgba(0, 0, 0, 0.6),
      0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .family-media-button:focus-visible,
  .family-media-zoom-reset:focus-visible,
  .family-media-nav:focus-visible {
    outline: 3px solid var(--primary-color);
    outline-offset: -3px;
  }
  /* The primary fill means "on"; keep the focus ring visible against it. */
  .family-media-button.active:focus-visible {
    outline-color: var(--text-primary-color, white);
  }
  .family-media-zoom-reset {
    position: absolute;
    top: var(--family-media-inset-top, 8px);
    left: var(--family-media-inset-left, 8px);
    z-index: 4;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    padding: 0 10px;
    border-radius: var(--tile-border-radius, 12px);
    background: rgba(0, 0, 0, 0.65);
  }
  .family-media-zoom-reset ha-icon {
    --mdc-icon-size: 20px;
  }
  .family-media-nav {
    position: absolute;
    top: 50%;
    z-index: 2;
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    padding: 0;
    transform: translateY(-50%);
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.25);
  }
  .family-media-nav.previous {
    left: var(--family-media-inset-left, 8px);
  }
  .family-media-nav.next {
    right: var(--family-media-inset-right, 8px);
  }
  .family-media-nav ha-icon {
    --mdc-icon-size: 32px;
  }
  .family-media-nav:focus-visible {
    background: rgba(0, 0, 0, 0.55);
  }
  /* Touch devices keep :hover after a tap; a distinct darker scrim keeps a
     switched-off control from looking on. */
  @media (hover: hover) {
    .family-media-button:not(.active):not(:disabled):hover {
      background: rgba(0, 0, 0, 0.62);
    }
    .family-media-nav:hover {
      background: rgba(0, 0, 0, 0.55);
    }
  }
  .family-media-message {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    padding: 24px;
    color: var(--secondary-text-color, #bdbdbd);
    text-align: center;
  }
  .family-media-message ha-icon {
    --mdc-icon-size: 32px;
  }
  /* Fullscreen keeps the row and spacing; the insets only grow for notches. */
  .family-media-fullscreen,
  [data-media-fullscreen] {
    ${SAFE_INSETS}
  }
  :fullscreen {
    ${SAFE_INSETS}
  }
  :-webkit-full-screen {
    ${SAFE_INSETS}
  }
`;
