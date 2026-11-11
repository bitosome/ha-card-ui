import { css, html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import type { Tone } from "./components.js";

/**
 * Level meter: one 0–100 % bar for battery charge, fan speed and similar levels.
 * Every card renders the same track thickness, colours and target marker; the card
 * owns spacing (via `className`) and picks the tone, e.g. with `batteryTone()`.
 */
export interface LevelMeterOptions {
  /** 0–100; missing values render an empty track announced as unavailable. */
  value: number | null | undefined;
  /** Accessible name, e.g. "Battery level" or "Fan setting". */
  label: string;
  /** Spoken value; defaults to `42%` or `Unavailable`. */
  valueText?: string;
  /** Fill colour; defaults to the accent (primary) colour. A card can instead set `--family-level-color`. */
  tone?: Tone;
  /** `progressbar` for task progress such as a print job; `meter` (default) for a measured level. */
  role?: "meter" | "progressbar";
  /** Optional 0–100 marker, e.g. a charge target; kept fully visible at 0 and 100. */
  target?: number | null;
  /**
   * Optional 0–100 range drawn hatched on the track behind the fill (1.11.0), e.g. from a
   * charge minimum to the car's own limit: the part that may still be charged. Ignored
   * when it is empty or not finite.
   */
  range?: { from: number; to: number } | null;
  className?: string;
}

/** Battery bands shared by vehicle cards: 60 % and above success, 20–59 % warning, below 20 % error. */
export const BATTERY_HIGH_FROM = 60;
export const BATTERY_LOW_BELOW = 20;

export function batteryTone(percent: number | null | undefined): Tone | undefined {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return undefined;
  if (percent >= BATTERY_HIGH_FROM) return "success";
  if (percent >= BATTERY_LOW_BELOW) return "warning";
  return "error";
}

const clampLevel = (value: number | null | undefined): number | undefined =>
  value === null || value === undefined || !Number.isFinite(value)
    ? undefined
    : Math.min(100, Math.max(0, value));

function resolve(options: LevelMeterOptions) {
  const value = clampLevel(options.value);
  const target = clampLevel(options.target);
  const from = clampLevel(options.range?.from);
  const to = clampLevel(options.range?.to);
  return {
    value,
    target,
    range: from !== undefined && to !== undefined && to > from ? { from, width: to - from } : undefined,
    tone: options.tone || "accent",
    valueText: options.valueText ?? (value === undefined ? "Unavailable" : `${Math.round(value)}%`),
  };
}

export function levelMeter(options: LevelMeterOptions) {
  const { value, target, tone, valueText, range } = resolve(options);
  return html`<div
    class="family-level-meter ${options.className || ""}"
    role=${options.role || "meter"}
    aria-label=${options.label}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow=${ifDefined(value)}
    aria-valuetext=${valueText}
  >${range === undefined
    ? nothing
    : html`<span class="family-level-range" style=${`left:${range.from}%;width:${range.width}%`}></span>`}<span class="family-level-fill" data-tone=${tone} style=${`width:${value ?? 0}%`}></span>${target === undefined
    ? nothing
    : html`<span class="family-level-target" style=${`left:clamp(1px, ${target}%, calc(100% - 1px))`}></span>`}</div>`;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** String twin of `levelMeter()` for cards that render HTML strings; text is escaped. */
export function levelMeterMarkup(options: LevelMeterOptions): string {
  const { value, target, tone, valueText, range } = resolve(options);
  const band = range === undefined ? "" : `<span class="family-level-range" style="left:${range.from}%;width:${range.width}%"></span>`;
  const now = value === undefined ? "" : ` aria-valuenow="${value}"`;
  const marker = target === undefined ? "" : `<span class="family-level-target" style="left:clamp(1px, ${target}%, calc(100% - 1px))"></span>`;
  return `<div class="family-level-meter ${escapeHtml(options.className || "")}" role="${options.role === "progressbar" ? "progressbar" : "meter"}" aria-label="${escapeHtml(options.label)}" aria-valuemin="0" aria-valuemax="100"${now} aria-valuetext="${escapeHtml(valueText)}">${band}<span class="family-level-fill" data-tone="${escapeHtml(tone)}" style="width:${value ?? 0}%"></span>${marker}</div>`;
}

/** Part of `componentStyles`, which also resolves `data-tone` to `--family-tone`. */
export const meterStyles = css`
  .family-level-meter {
    position: relative;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--primary-text-color) 12%, transparent);
    overflow: hidden;
  }
  /* Behind the fill: a level already above the range's start covers that part. */
  .family-level-range {
    position: absolute;
    top: 0;
    bottom: 0;
    background: repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--primary-text-color) 38%, transparent) 0 1.5px,
      transparent 1.5px 4.5px
    );
  }
  .family-level-fill {
    position: relative;
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--family-level-color, var(--family-tone, var(--primary-color)));
    transition: width 0.3s;
  }
  .family-level-target {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    transform: translateX(-1px);
    background: var(--primary-text-color);
    opacity: 0.6;
  }
  @media (prefers-reduced-motion: reduce) {
    .family-level-fill {
      transition: none;
    }
  }
`;
