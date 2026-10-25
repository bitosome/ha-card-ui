import { css, html, nothing } from "lit";

export type Tone = "neutral" | "accent" | "success" | "warning" | "error";
const icon = (name?: string) =>
  name ? html`<ha-icon .icon=${name} aria-hidden="true"></ha-icon>` : nothing;
export function actionPill(options: {
  label: string;
  icon?: string;
  onClick: () => unknown;
  primary?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  title?: string;
}) {
  return html`<button
    type="button"
    class="family-action ${options.primary
      ? "primary"
      : ""} ${options.destructive ? "destructive" : ""}"
    title=${options.title || options.label}
    ?disabled=${options.disabled || options.pending}
    aria-busy=${options.pending ? "true" : "false"}
    @click=${options.onClick}
  >
    ${icon(options.icon)}${options.pending
      ? options.pendingLabel || "Saving…"
      : options.label}
  </button>`;
}
export function stateChip(options: {
  label: string;
  icon?: string;
  tone?: Tone;
  onClick?: () => unknown;
  title?: string;
}) {
  const contents = html`${icon(options.icon)}<span>${options.label}</span>`;
  return options.onClick
    ? html`<button
        type="button"
        class="family-chip"
        data-tone=${options.tone || "neutral"}
        title=${options.title || options.label}
        @click=${options.onClick}
      >
        ${contents}
      </button>`
    : html`<span
        class="family-chip"
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
export function notice(options: {
  message: string;
  tone?: Tone;
  action?: { label: string; onClick: () => unknown };
}) {
  return html`<div
    class="family-notice"
    data-tone=${options.tone || "neutral"}
    role=${options.tone === "error" ? "alert" : "status"}
  >
    <span>${options.message}</span>${options.action
      ? actionPill(options.action)
      : nothing}
  </div>`;
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
  .family-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .family-action.destructive {
    color: var(--error-color, var(--status-alert-color, #b3261e));
    background: color-mix(
      in srgb,
      var(--error-color, #b3261e) 10%,
      transparent
    );
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
  [data-tone="accent"] {
    --family-tone: var(--primary-color);
  }
  [data-tone="success"] {
    --family-tone: var(--success-color, var(--status-success-color, #3b8b42));
  }
  [data-tone="warning"] {
    --family-tone: var(--warning-color, var(--status-warn-color, #a86600));
  }
  [data-tone="error"] {
    --family-tone: var(--error-color, var(--status-alert-color, #b3261e));
  }
  .family-chip[data-tone]:not([data-tone="neutral"]) {
    color: var(--primary-text-color);
    background: color-mix(
      in srgb,
      var(--family-tone) 14%,
      var(--family-surface)
    );
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
