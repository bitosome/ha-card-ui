import { css, html, nothing, type TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { UI_ICONS } from "./primitives.js";
import { meterStyles } from "./meter.js";

export type Tone =
  | "neutral"
  | "accent"
  | "success"
  | "caution"
  | "warning"
  | "error"
  | "unavailable";
/** Primary is filled, secondary is subdued, quiet is transparent for tools, destructive is error-tinted. */
export type ActionEmphasis = "primary" | "secondary" | "quiet" | "destructive";
/** Severity icons used by `notice()` when the caller does not pass its own. */
export const TONE_ICONS: Partial<Record<Tone, string>> = {
  accent: "mdi:information-outline",
  success: "mdi:check-circle-outline",
  caution: "mdi:alert-outline",
  warning: "mdi:alert-outline",
  error: "mdi:alert-circle-outline",
  unavailable: "mdi:help-circle-outline",
};
const icon = (name?: string) =>
  name ? html`<ha-icon .icon=${name} aria-hidden="true"></ha-icon>` : nothing;
/** Decorative busy marker; the owning control supplies its pending label and aria-busy. */
export function pendingIndicator() {
  return html`<span class="family-pending-indicator" aria-hidden="true"></span>`;
}

export interface ActionPillOptions {
  label: string;
  icon?: string;
  onClick: () => unknown;
  /** Shorthand for `emphasis: "primary"`. */
  primary?: boolean;
  /** Shorthand for `emphasis: "destructive"`. */
  destructive?: boolean;
  emphasis?: ActionEmphasis;
  disabled?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  title?: string;
  /** Accessible name when the visible label lacks context, e.g. the target. */
  ariaLabel?: string;
  /** Receives focus when the shared dialog opens, e.g. Cancel in a destructive confirmation. */
  initialFocus?: boolean;
  hasPopup?: "dialog" | "menu" | "listbox";
  className?: string;
}

function emphasisOf(options: Pick<ActionPillOptions, "emphasis" | "primary" | "destructive">): string {
  if (options.emphasis && options.emphasis !== "secondary") return options.emphasis;
  return [options.primary ? "primary" : "", options.destructive ? "destructive" : ""]
    .filter(Boolean)
    .join(" ");
}

export function actionPill(options: ActionPillOptions) {
  return html`<button
    type="button"
    class="family-action ${emphasisOf(options)} ${options.className || ""}"
    title=${options.title || options.label}
    aria-label=${ifDefined(options.ariaLabel)}
    aria-haspopup=${ifDefined(options.hasPopup)}
    ?data-family-initial-focus=${!!options.initialFocus}
    ?disabled=${options.disabled || options.pending}
    aria-busy=${options.pending ? "true" : "false"}
    @click=${options.onClick}
  >
    ${options.pending ? pendingIndicator() : icon(options.icon)}${options.pending
      ? options.pendingLabel || "Saving…"
      : options.label}
  </button>`;
}
/**
 * Toggle pill: an enabled/selected state inside one pill. It keeps the caller's
 * icon and shows a trailing check when pressed, so selection never relies on colour alone.
 */
export function togglePill(options: {
  label: string;
  pressed: boolean;
  onClick: () => unknown;
  icon?: string;
  disabled?: boolean;
  pending?: boolean;
  title?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const leading = options.pending ? pendingIndicator() : icon(options.icon);
  return html`<button
    type="button"
    class="family-action family-toggle ${options.className || ""}"
    aria-pressed=${options.pressed ? "true" : "false"}
    title=${options.title || options.label}
    aria-label=${ifDefined(options.ariaLabel)}
    ?disabled=${options.disabled || options.pending}
    aria-busy=${options.pending ? "true" : "false"}
    @click=${options.onClick}
  >
    ${leading}<span>${options.label}</span><ha-icon
      class="family-toggle-check"
      .icon=${UI_ICONS.check}
      aria-hidden="true"
    ></ha-icon>
  </button>`;
}

export function stateChip(options: {
  label: string;
  icon?: string;
  tone?: Tone;
  onClick?: () => unknown;
  title?: string;
  /** Accessible name when the visible label is abbreviated, e.g. "Front left door open". */
  ariaLabel?: string;
  /** Second, quieter line such as a time or constraint. */
  secondary?: string;
  hasPopup?: "dialog" | "menu" | "listbox";
  className?: string;
}) {
  const spoken = options.ariaLabel
    ? [options.ariaLabel, options.secondary].filter(Boolean).join(", ")
    : undefined;
  const contents = html`${icon(options.icon)}<span
      class="family-chip-text"
      aria-hidden=${ifDefined(spoken ? "true" : undefined)}
      ><span>${options.label}</span>${options.secondary
        ? html`<span class="family-chip-secondary">${options.secondary}</span>`
        : nothing}</span
    >${spoken && !options.onClick
      ? html`<span class="family-visually-hidden">${spoken}</span>`
      : nothing}`;
  const classes = `family-chip ${options.className || ""}`;
  return options.onClick
    ? html`<button
        type="button"
        class=${classes}
        data-tone=${options.tone || "neutral"}
        title=${options.title || options.label}
        aria-label=${ifDefined(spoken)}
        aria-haspopup=${ifDefined(options.hasPopup)}
        @click=${options.onClick}
      >
        ${contents}
      </button>`
    : html`<span
        class=${classes}
        data-tone=${options.tone || "neutral"}
        title=${options.title || options.label}
        >${contents}</span
      >`;
}
export function metricTile(options: {
  label: string;
  value: string;
  unit?: string;
  icon?: string;
  available?: boolean;
  tone?: Tone;
  status?: string;
  onClick?: () => unknown;
}) {
  const content = html`<span class="family-metric-top"
      >${icon(options.icon)}${options.status
        ? html`<span
            class="family-metric-trailing"
            data-tone=${options.tone || "neutral"}
            title=${options.status}
            aria-label=${options.status}
            >●</span
          >`
        : nothing}
      <span class="family-metric-label">${options.label}</span></span
    ><span
      class="family-metric-value ${options.available === false
        ? "missing"
        : ""}"
      >${options.available === false
        ? "Unavailable"
        : options.value}${options.unit && options.available !== false
        ? html`<small>${options.unit}</small>`
        : nothing}</span
    >`;
  return options.onClick
    ? html`<button
        type="button"
        class="family-metric family-surface"
        @click=${options.onClick}
      >
        ${content}
      </button>`
    : html`<div class="family-metric family-surface">${content}</div>`;
}
type NoticeAction = Omit<ActionPillOptions, "label" | "onClick"> & {
  label: string;
  onClick: () => unknown;
};

export function notice(options: {
  message: string;
  tone?: Tone;
  /** Short bold reason shown before the message. */
  title?: string;
  /** Severity icon; defaults to the tone's icon. Pass `false` to omit it. */
  icon?: string | false;
  /** Extra content below the message, such as a list of affected items. */
  body?: unknown;
  action?: NoticeAction;
  /** Additional recovery actions after `action`. */
  actions?: NoticeAction[];
  /** Polite updates use status; timely failures use alert. Defaults by tone. */
  role?: "status" | "alert";
  className?: string;
}) {
  const tone = options.tone || "neutral";
  const iconName = options.icon === false ? undefined : options.icon || TONE_ICONS[tone];
  const actions = [...(options.action ? [options.action] : []), ...(options.actions || [])];
  return html`<div
    class="family-notice ${options.className || ""}"
    data-tone=${tone}
    role=${options.role || (tone === "error" ? "alert" : "status")}
  >
    ${iconName
      ? html`<ha-icon class="family-notice-icon" .icon=${iconName} aria-hidden="true"></ha-icon>`
      : nothing}<div class="family-notice-content">
      ${options.title
        ? html`<strong class="family-notice-title">${options.title}</strong>`
        : nothing}<span class="family-notice-message">${options.message}</span>${options.body
        ? html`<div class="family-notice-body">${options.body}</div>`
        : nothing}
    </div>${actions.length
      ? html`<div class="family-notice-actions">${actions.map((action) => actionPill(action))}</div>`
      : nothing}
  </div>`;
}

/**
 * Loading, empty and failed states for history or other asynchronous data.
 * `No activity yet` and `Could not load activity` stay distinct; failures offer one retry label.
 */
export function asyncState(options: {
  state: "loading" | "empty" | "error";
  message?: string;
  onRetry?: () => unknown;
  retryLabel?: string;
  retrying?: boolean;
}): TemplateResult {
  if (options.state === "loading") {
    return html`<div class="family-async-state" role="status">
      ${pendingIndicator()}<span>${options.message || "Loading…"}</span>
    </div>`;
  }
  if (options.state === "empty") {
    return html`<div class="family-async-state" role="status">
      <span>${options.message || "Nothing to show yet"}</span>
    </div>`;
  }
  return notice({
    tone: "error",
    message: options.message || "Could not load data",
    action: options.onRetry
      ? {
          label: options.retryLabel || "Try again",
          icon: "mdi:refresh",
          onClick: options.onRetry,
          pending: options.retrying,
          pendingLabel: "Retrying…",
        }
      : undefined,
  });
}
export function disclosure(options: {
  label: string;
  expanded: boolean;
  onToggle: () => unknown;
  content: unknown;
  summary?: unknown;
}) {
  return html`<section class="family-disclosure">
    <button
      class="family-disclosure-toggle"
      type="button"
      aria-expanded=${String(options.expanded)}
      @click=${options.onToggle}
    >
      <span>${options.label}</span>${options.summary ?? nothing}${icon(
        options.expanded ? "mdi:chevron-up" : "mdi:chevron-down",
      )}</button
    >${options.expanded ? html`<div>${options.content}</div>` : nothing}
  </section>`;
}
export const componentStyles = css`
  ${meterStyles}
  .family-pending-indicator {
    display: inline-block;
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    box-sizing: border-box;
    border: 2px solid color-mix(in srgb, currentColor 24%, transparent);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: family-pending-spin 800ms linear infinite;
  }
  @keyframes family-pending-spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .family-pending-indicator {
      animation: none;
    }
  }

  .family-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .family-action.destructive {
    color: var(--family-error, var(--error-color, var(--status-alert-color, #e53935)));
    background: color-mix(in srgb, var(--family-error, var(--error-color, var(--status-alert-color, #e53935))) 10%, transparent);
  }
  .family-action.quiet {
    background: transparent;
    color: color-mix(in srgb, var(--primary-color) 70%, var(--primary-text-color));
  }
  @media (hover: hover) {
    .family-action.quiet:not(:disabled):hover {
      background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
    }
  }
  .family-toggle[aria-pressed="true"] {
    background: color-mix(in srgb, var(--primary-color) 14%, var(--family-surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-color) 40%, transparent);
  }
  .family-toggle[aria-pressed="true"] ha-icon {
    color: var(--primary-color);
  }
  /*
   * Unpressed, the check keeps its slot (so selecting never changes the pill's width,
   * whatever padding a card sets) and the label is shifted by half that slot
   * (22px icon + 8px gap) so it reads centred. translate does not affect layout.
   * Low specificity: a left-aligned option list can reset it with "translate: none".
   */
  .family-toggle[aria-pressed="false"] .family-toggle-check {
    visibility: hidden;
  }
  .family-toggle:where([aria-pressed="false"]:has(> .family-toggle-check)) > :where(:not(.family-toggle-check)) {
    translate: 15px 0;
  }
  .family-chip .family-visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .family-chip-text {
    display: inline-flex;
    flex-direction: column;
    min-width: 0;
  }
  .family-chip-secondary {
    color: color-mix(in srgb, var(--secondary-text-color) 70%, var(--primary-text-color));
    font-size: 12px;
    font-weight: 400;
  }
  .family-unavailable {
    color: var(--family-unavailable, var(--secondary-text-color));
  }
  .family-chip {
    border: 0;
    color: var(--primary-text-color);
  }
  .family-chip ha-icon {
    width: 18px;
    height: 18px;
    --mdc-icon-size: 18px;
    flex: 0 0 18px;
  }
  /* One resolution order for every tone: the family --family-* aliases from familyStyles. */
  [data-tone="accent"] {
    --family-tone: var(--primary-color);
  }
  [data-tone="success"] {
    --family-tone: var(--family-success, var(--success-color, var(--status-success-color, #66bb6a)));
  }
  [data-tone="caution"] {
    --family-tone: var(--family-caution, var(--status-caution-color, #ffca28));
  }
  [data-tone="warning"] {
    --family-tone: var(--family-warning, var(--warning-color, var(--status-warn-color, #ff9800)));
  }
  [data-tone="error"] {
    --family-tone: var(--family-error, var(--error-color, var(--status-alert-color, #e53935)));
  }
  [data-tone="unavailable"] {
    --family-tone: var(--family-unavailable, var(--secondary-text-color));
  }
  .family-chip[data-tone]:not([data-tone="neutral"]):not([data-tone="unavailable"]) {
    color: var(--primary-text-color);
    background: color-mix(
      in srgb,
      var(--family-tone) 14%,
      var(--family-surface)
    );
  }
  .family-chip[data-tone="unavailable"] {
    color: var(--family-unavailable, var(--secondary-text-color));
    background: transparent;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--secondary-text-color) 40%, transparent);
  }
  .family-metric-trailing[data-tone] {
    color: var(--family-tone, var(--secondary-text-color));
  }
  button.family-metric {
    font: inherit;
    color: inherit;
    border: 0;
    cursor: pointer;
  }
  button.family-metric:focus-visible {
    outline: 3px solid var(--primary-color);
    outline-offset: 3px;
  }
  .family-notice {
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border-radius: var(--tile-border-radius, 12px);
    font-size: 13px;
    line-height: 1.5;
    background: color-mix(
      in srgb,
      var(--family-tone, var(--primary-text-color)) 8%,
      var(--family-surface)
    );
  }
  .family-notice-icon {
    width: 22px;
    height: 22px;
    --mdc-icon-size: 22px;
    flex: 0 0 22px;
    align-self: flex-start;
    color: var(--family-tone, var(--secondary-text-color));
  }
  .family-notice-content {
    display: grid;
    gap: 2px;
    flex: 1 1 180px;
    min-width: 0;
  }
  .family-notice-title {
    font-weight: 600;
  }
  .family-notice-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .family-async-state {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    color: var(--secondary-text-color);
    font-size: 13px;
    line-height: 1.5;
  }
  .family-disclosure-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    width: 100%;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: start;
    font: inherit;
    cursor: pointer;
  }
  .family-disclosure-toggle > span:first-child {
    flex: 1;
  }
  .family-disclosure-toggle ha-icon {
    width: 22px;
    height: 22px;
    --mdc-icon-size: 22px;
  }
  .family-dialog-header h2 {
    flex: 1;
  }
  .family-dialog [hidden] {
    display: none !important;
  }
`;

/** Native entity UI remains owned by HA; callers close any custom top-layer flow first. */
export function showEntityMoreInfo(
  target: EventTarget,
  entityId: string,
): void {
  target.dispatchEvent(
    new CustomEvent("hass-more-info", {
      detail: { entityId },
      bubbles: true,
      composed: true,
    }),
  );
}
