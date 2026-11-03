import {
  css,
  html,
  nothing,
  svg,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from "lit";
import { ref } from "lit/directives/ref.js";
import { asyncState } from "./components.js";
import type { FormatHass } from "./format.js";
import {
  chartDefId,
  chartHeight,
  chartSeriesColor,
  defaultChartTimeLabel,
  indexAtTime,
  keyboardIndex,
  layoutTimeSeriesChart,
  nearestIndex,
  type ChartModel,
  type ChartPoint,
  type ChartSeries,
  type TimeSeriesChartOptions,
} from "./chart-geometry.js";

/**
 * Shared time-series chart: one look and one interaction model for the weather,
 * electricity price and printer power charts. Not a custom element: a card owns a
 * `FamilyChartController` and places the returned templates in its own shadow root.
 * The SVG is a slider: scrub with the pointer or keyboard; the head readout shows
 * the selected time and values, so nothing floats over the data or needs hover.
 */

export interface ChartView<T> {
  model: ChartModel<T>;
  /** The measured `.family-chart-body` with the SVG (or the empty state); pass it as `chartFrame({body})`. */
  svg: TemplateResult;
  readout: TemplateResult | typeof nothing;
  legend: TemplateResult;
}

const FALLBACK_WIDTH = 360;
const CLOCK_MS = 30_000;

const NO_DATA = "No data";

/** "3 Nov, 14:35 · Power 312 W · Current No data"; a single series omits its label. */
function selectionText<T>(model: ChartModel<T>, timeLabel: (t: number) => string): string {
  const selection = model.selection;
  if (!selection) return "";
  const named = selection.values.length > 1;
  return [
    timeLabel(selection.t),
    ...selection.values.map(({ series, point }) => {
      const text = point ? series.format(point.v as number) : NO_DATA;
      return named ? `${series.label} ${text}` : text;
    }),
  ].join(" · ");
}

export class FamilyChartController implements ReactiveController {
  private widths = new Map<string, number>();
  private selections = new Map<string, number>();
  /** Mouse hover previews per group: they win over `selections` and end on pointerleave. */
  private previews = new Map<string, number>();
  private dragging = new Set<string>();
  private bodies = new Map<string, Element>();
  private bodyIds = new WeakMap<Element, string>();
  private refs = new Map<string, (element?: Element) => void>();
  private observer?: ResizeObserver;
  private clock?: ReturnType<typeof setInterval>;
  private clockWanted = false;
  private connected = false;
  private fallbackWidth: number;
  private clockMs: number;

  constructor(
    private host: ReactiveControllerHost & HTMLElement,
    options: { fallbackWidth?: number; clockMs?: number } = {},
  ) {
    this.fallbackWidth = options.fallbackWidth ?? FALLBACK_WIDTH;
    this.clockMs = options.clockMs ?? CLOCK_MS;
    host.addController(this);
  }

  width(id: string): number {
    return this.widths.get(id) ?? this.fallbackWidth;
  }

  /** For tests and environments without ResizeObserver. */
  setWidth(id: string, px: number): void {
    const width = Math.round(px);
    if (!(width > 0) || this.widths.get(id) === width) return;
    this.widths.set(id, width);
    this.host.requestUpdate();
  }

  /** Selected time of a group (a mouse hover preview first); undefined follows now. */
  selected(group: string): number | undefined {
    return this.previews.get(group) ?? this.selections.get(group);
  }

  /** Pins the selected time of a group (undefined follows now) and ends any hover preview. */
  select(group: string, t: number | undefined): void {
    const previewed = this.previews.delete(group);
    if (!previewed && this.selections.get(group) === t) return;
    if (t === undefined) this.selections.delete(group);
    else this.selections.set(group, t);
    this.host.requestUpdate();
  }

  /** A transient mouse hover selection; undefined returns to the pinned selection (or now). */
  private preview(group: string, t: number | undefined): void {
    if (this.previews.get(group) === t) return;
    if (t === undefined) this.previews.delete(group);
    else this.previews.set(group, t);
    this.host.requestUpdate();
  }

  hostConnected(): void {
    this.connected = true;
    // Lit does not update on reconnect (HA re-attaches cards on view switches): ask for
    // one so the now marker catches up and hostUpdated restarts the clock.
    if (this.clockWanted) this.host.requestUpdate();
    if (!this.observer && typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const id = this.bodyIds.get(entry.target);
          if (id) this.setWidth(id, entry.contentRect.width);
        }
      });
      this.bodies.forEach((body) => this.observer?.observe(body));
    }
  }

  hostUpdate(): void {
    this.clockWanted = false;
  }

  hostUpdated(): void {
    // The clock only runs while a chart depends on now (see render); an update that
    // lands after disconnection must not restart it.
    if (this.clockWanted && this.connected && this.clock === undefined) {
      this.clock = setInterval(() => this.host.requestUpdate(), this.clockMs);
    } else if ((!this.clockWanted || !this.connected) && this.clock !== undefined) {
      clearInterval(this.clock);
      this.clock = undefined;
    }
  }

  hostDisconnected(): void {
    this.connected = false;
    this.observer?.disconnect();
    this.observer = undefined;
    if (this.clock !== undefined) clearInterval(this.clock);
    this.clock = undefined;
    this.dragging.clear();
    // A pointer that leaves while the host is detached never sends pointerleave.
    this.previews.clear();
  }

  private bodyRef(id: string): (element?: Element) => void {
    let callback = this.refs.get(id);
    if (!callback) {
      callback = (element?: Element) => {
        const previous = this.bodies.get(id);
        if (previous === element) return;
        if (previous) this.observer?.unobserve(previous);
        if (!element) {
          this.bodies.delete(id);
          return;
        }
        this.bodies.set(id, element);
        this.bodyIds.set(element, id);
        this.observer?.observe(element);
      };
      this.refs.set(id, callback);
    }
    return callback;
  }

  /** Lays out and renders one chart; observes its body width via the `ref` directive. */
  render<T>(options: TimeSeriesChartOptions<T>): ChartView<T> {
    const id = options.id;
    const group = options.selectionGroup ?? id;
    const timeLabel = options.timeLabel ?? defaultChartTimeLabel(options.hass);
    const now = options.now ?? Date.now();
    const model = layoutTimeSeriesChart(options, {
      width: this.width(id),
      selectedT: this.selected(group),
      now,
    });
    // Re-render every 30 s while the chart depends on now: a now marker, or a selection that
    // follows now inside the window (the cursor, the readout and colours derived from now).
    const [start, end] = model.x.domain;
    if (model.now || (!model.empty && model.selection?.followsNow && now >= start && now <= end)) {
      this.clockWanted = true;
    }
    const readout = chartReadout(model, { timeLabel });
    const legend = chartLegend(options.series);
    if (model.empty) {
      return {
        model,
        readout,
        legend,
        svg: stateBody(
          model.height,
          { state: "empty", message: options.emptyMessage || "No data for this period" },
          this.bodyRef(id),
        ),
      };
    }
    return { model, readout, legend, svg: this.renderSvg(options, model, group, timeLabel) };
  }

  private renderSvg<T>(
    options: TimeSeriesChartOptions<T>,
    model: ChartModel<T>,
    group: string,
    timeLabel: (t: number) => string,
  ): TemplateResult {
    const { id } = options;
    const { plot, width, height } = model;
    const selection = model.selection;
    const { selectable, intervalSelection } = model;
    const text = selectionText(model, timeLabel);
    const idFor = (series: ChartSeries<T>, part: "stroke" | "area" | "fade") => chartDefId(id, series.id, part);

    /** Pins the point under the pointer, or only previews it for a mouse hover. */
    const pick = (event: PointerEvent, hover = false): void => {
      const rect = (event.currentTarget as Element).getBoundingClientRect();
      if (!rect.width || !selectable.length) return;
      const px = ((event.clientX - rect.left) / rect.width) * width;
      const t = model.x.invert(Math.min(plot.right, Math.max(plot.left, px)));
      const index = intervalSelection ? indexAtTime(selectable, t) : nearestIndex(selectable, t);
      if (index < 0) return;
      if (hover) this.preview(group, selectable[index].t);
      else this.select(group, selectable[index].t);
    };
    const onPointerDown = (event: PointerEvent): void => {
      // A parent tile action (Space Hub) must not fire from a scrub.
      event.stopPropagation();
      this.dragging.add(id);
      try {
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort in embedded WebViews.
      }
      // Touch keeps its default so a vertical swipe still scrolls (touch-action: pan-y).
      if (event.pointerType !== "touch") event.preventDefault();
      pick(event);
    };
    const onPointerMove = (event: PointerEvent): void => {
      const dragging = this.dragging.has(id);
      const hover = event.pointerType === "mouse" && options.selectOn !== "press";
      if (!hover && !dragging) return;
      if (event.pointerType !== "touch") event.preventDefault();
      pick(event, !dragging);
    };
    const onPointerEnd = (event: PointerEvent): void => {
      this.dragging.delete(id);
      try {
        const target = event.currentTarget as Element;
        if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
      } catch {
        // Some WebViews throw if capture has already been released.
      }
    };
    // A mouse hover was only a preview: leaving returns to the pinned selection or to now.
    // Presses, drags, touch, pen and keyboard selections persist.
    const onPointerLeave = (event: PointerEvent): void => {
      onPointerEnd(event);
      if (event.pointerType === "mouse") this.preview(group, undefined);
    };
    // Enter and Space mean nothing to a slider; a parent tile action (Space Hub fires
    // tap on keyup) must not see them either.
    const stopActivation = (event: KeyboardEvent): void => {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      stopActivation(event);
      if (!selection) return;
      const next = keyboardIndex(event.key, selection.index, selectable.length);
      if (next === undefined) return;
      // Escape while already following now belongs to the surrounding dialog.
      if (next === "now" && selection.followsNow) return;
      event.preventDefault();
      this.select(group, next === "now" ? undefined : selectable[next].t);
    };

    const defs = model.series.map(({ series, stops, segments }) => {
      if (!segments.some((segment) => segment.area) && !stops) return nothing;
      return svg`
        ${stops
          ? svg`<linearGradient id=${idFor(series, "stroke")} gradientUnits="userSpaceOnUse"
              x1=${plot.left} x2=${plot.right} y1="0" y2="0">
              ${stops.map((stop) => svg`<stop offset=${`${(stop.offset * 100).toFixed(2)}%`} stop-color=${stop.color}></stop>`)}
            </linearGradient>`
          : nothing}
        ${segments.some((segment) => segment.area)
          ? svg`<linearGradient id=${idFor(series, "area")} gradientUnits="userSpaceOnUse"
              x1="0" x2="0" y1=${plot.top} y2=${plot.bottom}>
              <stop offset="0%" stop-color="white" stop-opacity="0.28"></stop>
              <stop offset="100%" stop-color="white" stop-opacity="0.04"></stop>
            </linearGradient>
            <mask id=${idFor(series, "fade")} maskUnits="userSpaceOnUse" x="0" y="0" width=${width} height=${height}>
              <rect x="0" y="0" width=${width} height=${height} fill=${`url(#${idFor(series, "area")})`}></rect>
            </mask>`
          : nothing}
      `;
    });
    const paint = (series: ChartSeries<T>, stops?: unknown[]) =>
      stops ? `url(#${idFor(series, "stroke")})` : chartSeriesColor(series);

    const selectedPoints = new Set(selection?.values.map((value) => value.point).filter(Boolean));
    const marks = model.series.map(({ series, segments, bars, stops }) => {
      if (bars) {
        return bars.map(
          (bar) => svg`<rect class=${`family-chart-bar${selectedPoints.has(bar.point) ? " selected" : ""}`}
            data-series=${series.id} x=${bar.x} y=${bar.y} width=${bar.width} height=${bar.height} rx="2.5"
            style=${`fill:${bar.fill}`}></rect>`,
        );
      }
      const emphasis = series.emphasis === "secondary" ? "secondary" : "primary";
      const stroke = paint(series, stops);
      return svg`
        ${segments.map((segment) =>
          segment.area
            ? svg`<path class="family-chart-area" data-series=${series.id} d=${segment.area}
                mask=${`url(#${idFor(series, "fade")})`}
                style=${`fill:${series.areaColor || stroke}`}></path>`
            : nothing,
        )}
        ${emphasis === "primary"
          ? segments.map((segment) => svg`<path class="family-chart-shadow" d=${segment.line}></path>`)
          : nothing}
        ${segments.map(
          (segment) => svg`<path class="family-chart-line" data-series=${series.id} data-emphasis=${emphasis}
            d=${segment.line} style=${`stroke:${stroke}`}></path>`,
        )}
      `;
    });

    // Left labels take the axis colour, else the colour of the first series drawn on that axis.
    // A slider needs aria-valuenow: on a synced time without a value here it is the nearest
    // point's index (where the arrow keys continue from) and aria-valuetext reads "No data".
    const secondarySeries = model.series.find(({ series }) => series.axis === "secondary")?.series;
    const secondaryColor = options.axes.secondary?.color ?? (secondarySeries ? chartSeriesColor(secondarySeries) : undefined);
    return html`<div class="family-chart-body" ${ref(this.bodyRef(id))}>
      <svg
        class="family-chart"
        data-chart-id=${id}
        viewBox=${`0 0 ${width} ${height}`}
        role="slider"
        tabindex="0"
        aria-label=${options.label}
        aria-valuemin="0"
        aria-valuemax=${Math.max(0, selectable.length - 1)}
        aria-valuenow=${selection?.index ?? 0}
        aria-valuetext=${selection && options.valueText ? options.valueText(selection) : text}
        @keydown=${onKeyDown}
        @keyup=${stopActivation}
        @pointerdown=${onPointerDown}
        @pointermove=${onPointerMove}
        @pointerup=${onPointerEnd}
        @pointercancel=${onPointerEnd}
        @pointerleave=${onPointerLeave}
        @click=${(event: Event) => event.stopPropagation()}
      >
        <title>${text}</title>
        <desc>${options.description
          ?? `${selectable.length} points from ${timeLabel(model.x.domain[0])} to ${timeLabel(model.x.domain[1])}.`}</desc>
        <defs>${defs}</defs>
        ${model.gridY.map(
          (y) => svg`<line class="family-chart-grid" x1=${plot.left} x2=${plot.right} y1=${y} y2=${y}></line>`,
        )}
        ${model.ticks.map(
          (tick) => svg`<line class="family-chart-time-line" x1=${tick.x} x2=${tick.x} y1=${plot.top} y2=${plot.bottom}></line>`,
        )}
        ${marks}
        ${model.now
          ? svg`<line class="family-chart-now" x1=${model.now.x} x2=${model.now.x} y1=${plot.top} y2=${plot.bottom}></line>`
          : nothing}
        ${model.extremes.map(
          (mark) => svg`<text class="family-chart-extreme" x=${mark.x} y=${mark.y}>${mark.text}</text>`,
        )}
        ${selection
          ? svg`<line class="family-chart-cursor" x1=${selection.x} x2=${selection.x} y1=${plot.top} y2=${plot.bottom}></line>
            ${selection.values.map((value) =>
              value.y === undefined
                ? nothing
                : svg`<g class="family-chart-dot" data-series=${value.series.id} transform=${`translate(${selection.x.toFixed(2)} ${value.y.toFixed(2)})`}>
                    <circle class="family-chart-dot-halo" r="8.5"></circle>
                    <circle class="family-chart-dot-ring" r="7"></circle>
                    <circle class="family-chart-dot-core" r="3.5"></circle>
                  </g>`,
            )}`
          : nothing}
        ${model.axisLabels.primary.map(
          (label) => svg`<text class="family-chart-axis" x=${width - 2} y=${label.y}
            style=${options.axes.primary.color ? `fill:${options.axes.primary.color}` : nothing}>${label.text}</text>`,
        )}
        ${(model.axisLabels.secondary ?? []).map(
          (label) => svg`<text class="family-chart-axis family-chart-axis-left" x="2" y=${label.y}
            style=${secondaryColor ? `fill:${secondaryColor}` : nothing}>${label.text}</text>`,
        )}
        ${model.ticks.map(
          (tick) => svg`<text class=${`family-chart-time${tick.anchor === "start" ? " family-chart-time-start" : tick.anchor === "end" ? " family-chart-time-end" : ""}`}
            x=${tick.x} y=${height - 6}>${tick.text}</text>`,
        )}
      </svg>
    </div>`;
  }
}

/**
 * Frame: head (title + readout), optional legend, optional `above` strip (e.g. weather icons),
 * then the body. The title may be text or interactive content such as a launcher button: it
 * wraps instead of truncating, and on a narrow card the readout moves to its own row.
 */
export function chartFrame(options: {
  body: unknown;
  title?: unknown;
  readout?: unknown;
  legend?: unknown;
  above?: unknown;
  className?: string;
}): TemplateResult {
  const hasTitle = options.title != null && options.title !== nothing && options.title !== "";
  const hasReadout = options.readout != null && options.readout !== nothing;
  return html`<div class="family-chart-frame ${options.className || ""}">
    ${hasTitle || hasReadout
      ? html`<div class="family-chart-head">
          ${hasTitle ? html`<div class="family-chart-title">${options.title}</div>` : nothing}
          ${hasReadout ? options.readout : nothing}
        </div>`
      : nothing}
    ${options.legend ?? nothing}
    ${options.above ?? nothing}
    ${options.body}
  </div>`;
}

/**
 * Default readout: time span + one strong per series value; `extra` appends e.g. a weather icon.
 * A series without a value at the selected time reads "–" (accessible name "No data").
 */
export function chartReadout<T>(
  model: ChartModel<T>,
  options: { hass?: FormatHass; timeLabel?: (t: number) => string; extra?: unknown } = {},
): TemplateResult | typeof nothing {
  const selection = model.selection;
  if (model.empty || !selection) return nothing;
  const timeLabel = options.timeLabel ?? defaultChartTimeLabel(options.hass);
  return html`<div class="family-chart-readout">
    <span>${timeLabel(selection.t)}</span>
    ${selection.values.map(({ series, point }) => {
      if (!point) {
        // `strong` cannot carry a name (ARIA 1.2): as an image it reads "No data" instead of the dash.
        return html`<strong class="family-chart-no-value" data-series=${series.id} role="img" aria-label=${NO_DATA}>–</strong>`;
      }
      // Secondary series (by emphasis or axis) take their colour; primary values read in the primary text colour.
      const secondary = series.emphasis === "secondary" || series.axis === "secondary";
      const color = secondary && !series.colorAt ? chartSeriesColor(series) : undefined;
      return html`<strong data-series=${series.id} style=${color ? `color:${color}` : nothing}>${series.format(point.v as number)}</strong>`;
    })}
    ${options.extra ?? nothing}
  </div>`;
}

const LEGEND_GRADIENT_STOPS = 6;

/**
 * Legend swatch paint (a CSS background) for a series: its colour, or for `colorAt` series a
 * gradient of the colours it uses, from its lowest to its highest value (at most six stops).
 */
export function chartLegendSwatch<T>(series: ChartSeries<T>): string {
  if (!series.colorAt) return chartSeriesColor(series);
  const colors: string[] = [];
  const finite = series.points.filter(
    (point): point is ChartPoint<T> & { v: number } => typeof point.v === "number" && Number.isFinite(point.v),
  );
  for (const point of finite.sort((a, b) => a.v - b.v)) {
    const color = series.colorAt(point);
    if (color && !colors.includes(color)) colors.push(color);
  }
  if (colors.length < 2) return colors[0] || chartSeriesColor(series);
  const stops = colors.length <= LEGEND_GRADIENT_STOPS
    ? colors
    : Array.from(
        { length: LEGEND_GRADIENT_STOPS },
        (_, index) => colors[Math.round((index * (colors.length - 1)) / (LEGEND_GRADIENT_STOPS - 1))],
      );
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/**
 * Legend swatches (`chartLegendSwatch`; `swatches[series.id]` overrides one with any CSS
 * background); `gapNote` (e.g. "Gaps mean missing data") shows unless `show` is false, e.g. `show: model.hasGaps`.
 */
export function chartLegend<T>(
  series: ChartSeries<T>[],
  options: { gapNote?: string; show?: boolean; swatches?: Record<string, string> } = {},
): TemplateResult {
  return html`<div class="family-chart-legend">
    ${series.map(
      (entry) => html`<span data-series=${entry.id}><i style=${`background:${options.swatches?.[entry.id] || chartLegendSwatch(entry)}`}></i>${entry.label}</span>`,
    )}
    ${options.gapNote && options.show !== false
      ? html`<span class="family-chart-gap-note">${options.gapNote}</span>`
      : nothing}
  </div>`;
}

/** Loading placeholder at the chart's drawn height (`chartHeight`); static under reduced motion. */
export function chartSkeleton(options: { height: number; label: string }): TemplateResult {
  return html`<div
    class="family-chart-skeleton"
    role="status"
    aria-label=${options.label}
    style=${`height:${chartHeight(options.height)}px`}
  ></div>`;
}

/**
 * Empty, error or loading message as a chart body, at least the chart's drawn height, so the
 * frame does not jump between states: `chartFrame({title, body: chartState({height, state:
 * "error", message, onRetry})})`. The controller renders empty data the same way.
 */
export function chartState(options: Parameters<typeof asyncState>[0] & {
  /** The chart's configured height; clamped like the chart (82–360 px). */
  height: number;
}): TemplateResult {
  const { height, ...state } = options;
  return stateBody(height, state);
}

function stateBody(
  height: number,
  state: Parameters<typeof asyncState>[0],
  bodyRef?: (element?: Element) => void,
): TemplateResult {
  return html`<div
    class="family-chart-body family-chart-empty"
    style=${`min-height:${chartHeight(height)}px`}
    ${bodyRef ? ref(bodyRef) : nothing}
  >
    ${asyncState(state)}
  </div>`;
}

/**
 * Compose after familyStyles/componentStyles (asyncState). Not part of componentStyles,
 * so cards without charts do not carry it. Override colours on the card host with
 * `--family-chart-background`, `-grid`, `-text`, `-now`, `-shadow`, `-series-1` and `-series-2`,
 * and the frame corners with `--family-chart-radius` (default `--tile-border-radius`, 12px).
 */
export const chartStyles = css`
  .family-chart-frame {
    position: relative;
    display: grid;
    gap: 5px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 7px 8px 6px;
    border-radius: var(--family-chart-radius, var(--tile-border-radius, 12px));
    background: var(
      --family-chart-background,
      color-mix(in srgb, var(--family-surface, var(--card-background-color, #fff)) 94%, var(--primary-color, #03a9f4))
    );
    color: var(--secondary-text-color);
    overflow: hidden;
  }
  /* On a narrow card the readout moves to its own row instead of squeezing the title. */
  .family-chart-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: start;
    gap: 4px 8px;
    min-width: 0;
    min-height: 18px;
  }
  /* The title may hold a launcher button: it wraps rather than truncating, and nothing
     clips a focus ring. */
  .family-chart-title {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
    color: var(--primary-text-color);
    font-size: 12px;
    font-weight: 700;
    line-height: 1.2;
  }
  .family-chart-readout {
    flex: 0 1 auto;
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: flex-end;
    gap: 4px 8px;
    max-width: 100%;
    min-width: 0;
    margin-inline-start: auto;
    color: var(--secondary-text-color);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.4;
    text-align: right;
  }
  .family-chart-readout span {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .family-chart-readout strong {
    flex-shrink: 0;
    color: var(--primary-text-color);
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .family-chart-readout .family-chart-no-value {
    color: var(--secondary-text-color);
  }
  .family-chart-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    color: var(--secondary-text-color);
    font-size: 11px;
    line-height: 1.4;
  }
  .family-chart-legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .family-chart-legend i {
    display: inline-block;
    width: 14px;
    height: 3px;
    border-radius: 999px;
  }
  .family-chart-legend .family-chart-gap-note {
    margin-inline-start: auto;
    opacity: 0.75;
  }
  .family-chart-body {
    position: relative;
    width: 100%;
    min-width: 0;
  }
  .family-chart-empty {
    display: grid;
    align-content: center;
  }
  .family-chart {
    display: block;
    width: 100%;
    height: auto;
    min-width: 0;
    /* Marks are pinned inside the plot by the layout; this only lets the selection dot's
       halo pass the 8px edge margin. */
    overflow: visible;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  @media (hover: hover) {
    .family-chart {
      cursor: pointer;
    }
  }
  .family-chart:focus {
    outline: none;
  }
  .family-chart:focus-visible {
    outline: 3px solid var(--primary-color);
    outline-offset: -3px;
    border-radius: 8px;
  }
  .family-chart text {
    fill: var(--family-chart-text, var(--secondary-text-color));
    font-family: var(--family-font);
    font-size: 11px;
    font-weight: 600;
    text-anchor: middle;
    dominant-baseline: middle;
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .family-chart .family-chart-axis {
    text-anchor: end;
  }
  .family-chart .family-chart-axis-left {
    text-anchor: start;
    opacity: 0.9;
  }
  .family-chart .family-chart-time-start {
    text-anchor: start;
  }
  .family-chart .family-chart-time-end {
    text-anchor: end;
  }
  .family-chart .family-chart-extreme {
    fill: var(--primary-text-color);
    font-weight: 700;
  }
  .family-chart-grid,
  .family-chart-time-line {
    stroke: var(--family-chart-grid, color-mix(in srgb, var(--primary-text-color) 13%, transparent));
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .family-chart-time-line {
    stroke-dasharray: 3 3;
  }
  .family-chart-area {
    stroke: none;
  }
  .family-chart-shadow,
  .family-chart-line {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .family-chart-shadow {
    stroke: var(--family-chart-shadow, rgba(0, 0, 0, 0.24));
    stroke-width: 7;
  }
  .family-chart-line {
    stroke-width: 4;
  }
  .family-chart-line[data-emphasis="secondary"] {
    stroke-width: 2;
    opacity: 0.9;
  }
  .family-chart-bar {
    opacity: 0.95;
    transition: opacity 120ms ease;
  }
  .family-chart-bar.selected {
    opacity: 1;
    stroke: color-mix(in srgb, var(--primary-text-color) 72%, transparent);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .family-chart-now {
    stroke: var(--family-chart-now, var(--family-active, var(--primary-color)));
    stroke-width: 1.5;
    opacity: 0.62;
    vector-effect: non-scaling-stroke;
  }
  .family-chart-cursor {
    stroke: color-mix(in srgb, var(--primary-text-color) 36%, transparent);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .family-chart-dot {
    pointer-events: none;
  }
  .family-chart-dot-halo {
    fill: none;
    stroke: color-mix(in srgb, var(--primary-text-color) 18%, transparent);
    stroke-width: 2;
  }
  .family-chart-dot-ring {
    fill: color-mix(in srgb, var(--family-surface, var(--card-background-color, #000)) 60%, transparent);
    stroke: color-mix(in srgb, var(--primary-text-color) 54%, transparent);
    stroke-width: 1;
  }
  .family-chart-dot-core {
    fill: var(--primary-text-color);
    stroke: color-mix(in srgb, var(--family-surface, var(--card-background-color, #000)) 40%, transparent);
    stroke-width: 1;
  }
  .family-chart-skeleton {
    border-radius: 10px;
    background: linear-gradient(
      100deg,
      color-mix(in srgb, var(--primary-text-color) 4%, transparent) 30%,
      color-mix(in srgb, var(--primary-text-color) 8%, transparent) 50%,
      color-mix(in srgb, var(--primary-text-color) 4%, transparent) 70%
    );
    background-size: 200% 100%;
    animation: family-chart-shimmer 1.6s ease-in-out infinite;
  }
  @keyframes family-chart-shimmer {
    0% {
      background-position: 130% 0;
    }
    100% {
      background-position: -30% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .family-chart-bar {
      transition: none;
    }
    .family-chart-skeleton {
      animation: none;
      background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
    }
  }
`;
