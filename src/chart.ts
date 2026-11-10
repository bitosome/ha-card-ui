import {
  css,
  html,
  nothing,
  svg,
  unsafeCSS,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from "lit";
import { ref } from "lit/directives/ref.js";
import { asyncState } from "./components.js";
import type { FormatHass } from "./format.js";
import {
  CHART_LANE_PX,
  CHART_PERIOD_ACTIVE_PX,
  chartDefId,
  chartPeriodColor,
  chartPeriodText,
  chartPeriodTone,
  chartSafeColor,
  chartSeriesColor,
  chartTotalHeight,
  defaultChartTimeLabel,
  extremes,
  indexAtTime,
  keyboardIndex,
  layoutTimeSeriesChart,
  nearestIndex,
  type ChartBand,
  type ChartModel,
  type ChartPeriodTone,
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
  /**
   * The period line of a chart with lanes (`chartPeriodLine`), `nothing` without lanes: pass it
   * as `chartFrame({below})`. It is one line of fixed height, so the frame keeps its height
   * while the selection moves over periods.
   */
  periods: TemplateResult | typeof nothing;
}

const FALLBACK_WIDTH = 360;
const CLOCK_MS = 30_000;

const NO_DATA = "No data";

interface LaneText {
  laneId: string;
  kind: "period" | "marker";
  tone?: ChartPeriodTone;
  color?: string;
  text: string;
}

/**
 * What the lanes say at the selection, lane by lane: the period there ("XC40 Charging", see
 * `chartPeriodText`), then the lane's marker when the selection covers its time ("XC40 Ready by 07:00").
 */
function laneTexts<T>(model: ChartModel<T>): LaneText[] {
  const selection = model.selection;
  if (!selection) return [];
  const range = selection.range ?? { start: selection.t, end: selection.t };
  return selection.periods.flatMap(({ lane, period }) => {
    const texts: LaneText[] = [];
    if (period) {
      texts.push({
        laneId: lane.id,
        kind: "period",
        tone: chartPeriodTone(lane, period),
        // A paused lane is grey everywhere: its swatch does not keep the period's own colour.
        color: lane.muted ? undefined : period.color,
        text: chartPeriodText(lane, period),
      });
    }
    const marker = lane.marker;
    if (marker?.label && (range.end > range.start ? marker.t >= range.start && marker.t < range.end : marker.t === range.start)) {
      texts.push({ laneId: lane.id, kind: "marker", text: `${lane.label} ${marker.label}`.trim() });
    }
    return texts;
  });
}

/** Labels of the bands the selection is in (an interval is in a band it overlaps). */
function bandTexts<T>(model: ChartModel<T>): string[] {
  const selection = model.selection;
  if (!selection) return [];
  const range = selection.range ?? { start: selection.t, end: selection.t };
  const inside = (band: ChartBand): boolean =>
    range.end > range.start
      ? Math.min(band.end, range.end) > Math.max(band.start, range.start)
      : range.start >= band.start && range.start < band.end;
  return model.bands.flatMap(({ band }) => (band.label && inside(band) ? [band.label] : []));
}

/**
 * "3 Nov, 14:35 · Power 312 W · Current No data"; a single series omits its label.
 * Then what the lanes show at that time and the bands it is in: "… · XC40 Charging · no price yet".
 */
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
    ...laneTexts(model).map((entry) => entry.text),
    ...bandTexts(model),
  ].join(" · ");
}

const HATCH = "var(--family-chart-period-hatch, color-mix(in srgb, var(--primary-text-color) 50%, transparent))";
const BAND = "var(--family-chart-band, color-mix(in srgb, var(--primary-text-color) 14%, transparent))";
// Neutral, so a marker is never mistaken for the now marker (which takes the active colour).
const MARKER = "var(--family-chart-marker, color-mix(in srgb, var(--primary-text-color) 55%, transparent))";
const OUTLINE = "var(--family-chart-period-outline, color-mix(in srgb, var(--primary-text-color) 60%, transparent))";

/**
 * Swatch paint (a CSS background) for a period tone, for legends and readouts: the tone colour
 * (`chartPeriodColor`), with the diagonal hatch over it for `extra` so it reads without colour.
 */
export function chartPeriodSwatch(tone: ChartPeriodTone, color?: string): string {
  const paint = chartPeriodColor(tone, color);
  if (tone === "extra") return `repeating-linear-gradient(135deg, ${HATCH} 0 1px, transparent 1px 4px), ${paint}`;
  // Upright bars for `warning`: a second pattern, clearly not the diagonal hatch of `extra`.
  if (tone === "warning") return `repeating-linear-gradient(90deg, ${HATCH} 0 1.5px, transparent 1.5px 4px), ${paint}`;
  return paint;
}

/** Swatch paint (a CSS background) for a band in a legend: its diagonal lines, or the flat tint. */
export function chartBandSwatch(pattern: ChartBand["pattern"] = "hatched", color?: string): string {
  const paint = chartSafeColor(color) || BAND;
  return pattern === "tint"
    ? `color-mix(in srgb, ${paint} 55%, transparent)`
    : `repeating-linear-gradient(135deg, ${paint} 0 1.5px, transparent 1.5px 4px)`;
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
  private descriptions = new Map<string, { key: string; text: string }>();
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
    this.fitLaneLabels();
  }

  /**
   * Lane labels get room by an estimate of their width. Where the real text is wider (an unusual
   * font, a row of wide glyphs), it is squeezed into its room instead of being cut by the frame.
   * Measured once per label text and room; charts without lanes have no such labels.
   */
  private fitLaneLabels(): void {
    for (const body of this.bodies.values()) {
      for (const label of body.querySelectorAll<SVGTextElement>("text.family-chart-lane-label")) {
        const key = `${label.dataset.room}|${label.textContent}`;
        if (label.dataset.fit === key || typeof label.getComputedTextLength !== "function") continue;
        label.dataset.fit = key;
        label.removeAttribute("textLength");
        label.removeAttribute("lengthAdjust");
        const room = Number(label.dataset.room);
        if (room > 0 && label.getComputedTextLength() > room) {
          label.setAttribute("textLength", String(room));
          label.setAttribute("lengthAdjust", "spacingAndGlyphs");
        }
      }
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

  /**
   * The default `<desc>`: the 1.7.0 sentence, then what the lanes, markers and bands show, with
   * times, since none of it can be read off the series values and a period after the last value
   * has no bar to stand on. Formatting a time is slow (an `Intl` call each), and a plan has two
   * per period, so the text is kept per chart until what it describes changes; the selection
   * does not change it.
   */
  private describe<T>(id: string, model: ChartModel<T>, timeLabel: (t: number) => string): string {
    const [domainStart, domainEnd] = model.x.domain;
    const head = `${model.selectable.length} points from ${timeLabel(domainStart)} to ${timeLabel(domainEnd)}.`;
    if (!model.lanes.length && !model.markers.length && !model.bands.length) return head;
    const key = JSON.stringify([
      head,
      model.lanes.map(({ lane, periods, marker }) => [
        lane.label, lane.muted, lane.mutedLabel, marker ? [lane.marker?.t, lane.marker?.label] : 0,
        periods.map(({ period }) => [period.start, period.end, period.label, period.tone]),
      ]),
      model.markers.map(({ marker }) => [marker.t, marker.label]),
      model.bands.map(({ band }) => [band.start, band.end, band.label]),
    ]);
    const known = this.descriptions.get(id);
    if (known?.key === key) return known.text;
    const span = (start: number, end: number): string =>
      `${timeLabel(Math.max(start, domainStart))}–${timeLabel(Math.min(end, domainEnd))}`;
    const text = [
      head,
      ...model.lanes.map(({ lane, periods, marker }) => {
        const parts = periods.map(({ period }) => `${chartPeriodText({ ...lane, label: "" }, period)} ${span(period.start, period.end)}`);
        if (marker && lane.marker) parts.push(lane.marker.label ? `${lane.marker.label} (${timeLabel(lane.marker.t)})` : `marker at ${timeLabel(lane.marker.t)}`);
        return `${lane.label}: ${parts.join(", ") || "no periods"}.`;
      }),
      ...model.markers.flatMap(({ marker }) => (marker.label ? [`${marker.label}: ${timeLabel(marker.t)}.`] : [])),
      ...model.bands.map(({ band }) => `${band.label || "Shaded"}: ${span(band.start, band.end)}.`),
    ].join(" ");
    this.descriptions.set(id, { key, text });
    return text;
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
    // Also for an empty chart, so the frame keeps its height when the data arrives.
    const periods = options.lanes?.length ? chartPeriodLine(model) : nothing;
    if (model.empty) {
      return {
        model,
        readout,
        legend,
        periods,
        svg: stateBody(
          model.totalHeight,
          { state: "empty", message: options.emptyMessage || "No data for this period" },
          this.bodyRef(id),
        ),
      };
    }
    return { model, readout, legend, periods, svg: this.renderSvg(options, model, group, timeLabel) };
  }

  private renderSvg<T>(
    options: TimeSeriesChartOptions<T>,
    model: ChartModel<T>,
    group: string,
    timeLabel: (t: number) => string,
  ): TemplateResult {
    const { id } = options;
    const { plot, width, height, totalHeight } = model;
    const selection = model.selection;
    const { selectable, intervalSelection } = model;
    // With lanes the slider walks times across the whole domain (`model.steps`), not series points.
    const sliderStops: { t: number }[] = model.steps ? model.steps.map((t) => ({ t })) : selectable;
    const text = selectionText(model, timeLabel);
    const idFor = (series: ChartSeries<T>, part: "stroke" | "area" | "fade") => chartDefId(id, series.id, part);

    /** Pins the point under the pointer, or only previews it for a mouse hover. */
    const pick = (event: PointerEvent, hover = false): void => {
      const rect = (event.currentTarget as Element).getBoundingClientRect();
      if (!rect.width || !sliderStops.length) return;
      const px = ((event.clientX - rect.left) / rect.width) * width;
      const t = model.x.invert(Math.min(plot.right, Math.max(plot.left, px)));
      const index = intervalSelection ? indexAtTime(sliderStops, t) : nearestIndex(sliderStops, t);
      if (index < 0) return;
      if (hover) this.preview(group, sliderStops[index].t);
      else this.select(group, sliderStops[index].t);
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
      const next = keyboardIndex(event.key, selection.index, sliderStops.length);
      if (next === undefined) return;
      // Escape while already following now belongs to the surrounding dialog.
      if (next === "now" && selection.followsNow) return;
      event.preventDefault();
      this.select(group, next === "now" ? undefined : sliderStops[next].t);
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

    // Bands, markers and lanes go into the holes the 1.7.0 template already has (as extra array
    // items), so a chart without them renders exactly the nodes it rendered before.
    const bandId = (index: number) => chartDefId(id, String(index), "band");
    const patternId = (laneId: string, tone: ChartPeriodTone) => chartDefId(id, laneId, tone === "warning" ? "bars" : "hatch");
    const patterned = (tone: ChartPeriodTone): boolean => tone === "extra" || tone === "warning";
    const patternDefs = [
      ...model.bands.map(({ band }, index) => {
        const color = chartSafeColor(band.color);
        return band.pattern === "tint"
          ? nothing
          : svg`<pattern id=${bandId(index)} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line class="family-chart-band-line" x1="3" x2="3" y1="0" y2="6"
                style=${color ? `stroke:${color}` : nothing}></line>
            </pattern>`;
      }),
      // `extra` is hatched diagonally and `warning` barred upright, so neither depends on colour.
      ...model.lanes.flatMap(({ lane, periods }) => [
        periods.some((period) => period.tone === "extra")
          ? svg`<pattern id=${patternId(lane.id, "extra")} patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
              <line class="family-chart-period-hatch-line" x1="2" x2="2" y1="0" y2="4"></line>
            </pattern>`
          : nothing,
        periods.some((period) => period.tone === "warning")
          ? svg`<pattern id=${patternId(lane.id, "warning")} patternUnits="userSpaceOnUse" width="5" height="5">
              <line class="family-chart-period-hatch-line family-chart-period-bars-line" x1="2.5" x2="2.5" y1="0" y2="5"></line>
            </pattern>`
          : nothing,
      ]),
    ];
    const bandMarks = model.bands.map(({ band, x, width: bandWidth, label }, index) => {
      const tint = band.pattern === "tint";
      const color = chartSafeColor(band.color);
      return svg`<rect class="family-chart-band" data-pattern=${tint ? "tint" : "hatched"}
          x=${x} y=${plot.top} width=${bandWidth} height=${plot.bottom - plot.top}
          style=${tint ? (color ? `fill:${color}` : nothing) : `fill:url(#${bandId(index)})`}></rect>
        ${label
          ? svg`<text class="family-chart-band-label" x=${label.x} y=${label.y}>${label.text}</text>`
          : nothing}`;
    });
    const lanesTop = model.lanes.length ? model.lanes[0].y : totalHeight;
    const lanesBottom = model.lanes.length ? model.lanes[model.lanes.length - 1].y + CHART_LANE_PX : totalHeight;
    /** The part of a vertical time line that crosses the lanes; the time labels between plot and lanes stay clear. */
    const throughLanes = (className: string, x: number, style?: string) =>
      model.lanes.length
        ? svg`<line class=${className} data-part="lanes" x1=${x} x2=${x} y1=${lanesTop} y2=${lanesBottom}
            style=${style ?? nothing}></line>`
        : nothing;
    const markerClass = (dash?: boolean) => `family-chart-marker${dash ? " family-chart-marker-dash" : ""}`;
    const markerStyle = (color?: string) => {
      const safe = chartSafeColor(color);
      return safe ? `stroke:${safe}` : undefined;
    };
    const markerMarks = model.markers.map(
      ({ marker, x, label }) => svg`<line class=${markerClass(marker.dash)} x1=${x} x2=${x} y1=${label ? 1 : plot.top} y2=${plot.bottom}
          style=${markerStyle(marker.color) ?? nothing}></line>
        ${label
          ? svg`<text class=${`family-chart-marker-label${label.anchor === "end" ? " family-chart-marker-label-end" : ""}`}
              x=${label.x} y=${label.y}>${label.text}</text>`
          : nothing}`,
    );
    // Drawn after the lanes, so a marker crosses the periods like it crosses the bars.
    const markerLaneLines = model.lanes.length
      ? model.markers.map(({ marker, x }) => throughLanes(markerClass(marker.dash), x, markerStyle(marker.color)))
      : [];
    const laneMarks = model.lanes.map(
      ({ lane, y, track, label, periods, marker }) => svg`<g class="family-chart-lane" data-lane=${lane.id} ?data-muted=${!!lane.muted}>
        <title>${lane.label}</title>
        <rect class="family-chart-lane-track" x=${track.x} y=${track.y} width=${track.width} height=${track.height}
          rx=${track.height / 2}></rect>
        ${periods.map(({ period, tone, x, width: periodWidth }) => {
          // `active` is 2 px taller than the track: it differs without colour or motion.
          const periodHeight = tone === "active" ? CHART_PERIOD_ACTIVE_PX : track.height;
          const periodY = track.y - (periodHeight - track.height) / 2;
          const rx = Math.min(periodHeight, periodWidth) / 2;
          const color = tone === "muted" ? undefined : chartSafeColor(period.color);
          return svg`<rect class="family-chart-period" data-tone=${tone} x=${x} y=${periodY} width=${periodWidth}
              height=${periodHeight} rx=${rx}
              style=${color ? `fill:${color}` : nothing}></rect>
            ${patterned(tone)
              ? svg`<rect class="family-chart-period-hatch" data-pattern=${tone === "warning" ? "bars" : "hatch"}
                  x=${x} y=${periodY} width=${periodWidth} height=${periodHeight} rx=${rx}
                  style=${`fill:url(#${patternId(lane.id, tone)})`}></rect>`
              : nothing}`;
        })}
        ${marker
          ? svg`<line class="family-chart-lane-marker" x1=${marker.x} x2=${marker.x} y1=${y + 2} y2=${y + CHART_LANE_PX - 2}>${lane.marker?.label
              ? svg`<title>${lane.marker.label}</title>`
              : nothing}</line>`
          : nothing}
        <text class="family-chart-lane-label" x=${label.x} y=${label.y} data-room=${label.room.toFixed(1)}>${label.text}</text>
      </g>`,
    );
    const laneLines = model.lanes.length
      ? [
          model.now ? throughLanes("family-chart-now", model.now.x) : nothing,
          selection ? throughLanes("family-chart-cursor", selection.x) : nothing,
        ]
      : [];
    const description = options.description ?? this.describe(id, model, timeLabel);

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
        viewBox=${`0 0 ${width} ${totalHeight}`}
        role="slider"
        tabindex="0"
        aria-label=${options.label}
        aria-valuemin="0"
        aria-valuemax=${Math.max(0, sliderStops.length - 1)}
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
        <desc>${description}</desc>
        <defs>${[...defs, ...patternDefs]}</defs>
        ${[
          ...bandMarks,
          ...model.gridY.map(
            (y) => svg`<line class="family-chart-grid" x1=${plot.left} x2=${plot.right} y1=${y} y2=${y}></line>`,
          ),
        ]}
        ${model.ticks.map(
          (tick) => svg`<line class="family-chart-time-line" x1=${tick.x} x2=${tick.x} y1=${plot.top} y2=${plot.bottom}></line>`,
        )}
        ${[...marks, ...markerMarks, ...laneMarks, ...markerLaneLines, ...laneLines]}
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
 * then the body and an optional `below` row (the period line of a chart with lanes). The title may be text or interactive content such as a launcher button: it
 * wraps instead of truncating, and on a narrow card the readout moves to its own row.
 */
export function chartFrame(options: {
  body: unknown;
  title?: unknown;
  readout?: unknown;
  legend?: unknown;
  above?: unknown;
  /** Directly under the body, e.g. `view.periods` (the period line of a chart with lanes). */
  below?: unknown;
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
    ${options.below == null || options.below === nothing ? options.body : [options.body, options.below]}
  </div>`;
}

/** The longer of a series' formatted lowest and highest value: the room its readout value needs. */
function widestValue<T>(series: ChartSeries<T>): string {
  const { min, max } = extremes(series.points);
  const texts = [min, max].map((point) => (point ? series.format(point.v as number) : ""));
  return texts[0].length > texts[1].length ? texts[0] : texts[1];
}

/** One lane item of the period line or the readout: a swatch in the period colour (a tick for a lane marker) and its text. */
function laneItem(entry: LaneText): TemplateResult {
  return html`<span class="family-chart-readout-period" data-lane=${entry.laneId} data-kind=${entry.kind} data-tone=${entry.tone ?? nothing}><i
    class=${entry.kind === "marker" ? "family-chart-lane-marker-swatch" : "family-chart-period-swatch"}
    style=${entry.kind === "marker" ? nothing : `background:${chartPeriodSwatch(entry.tone as ChartPeriodTone, entry.color)}`}></i>${entry.text}</span>`;
}

/**
 * Default readout: time span + one strong per series value; `extra` appends e.g. a weather icon.
 * A series without a value at the selected time reads "–" (accessible name "No data").
 * What the lanes show at the selected time belongs in the period line (`chartPeriodLine`,
 * `view.periods`), which never changes the frame height. `periods: true` appends those items
 * here instead, after the values, for a card whose head has room for a readout that grows.
 */
export function chartReadout<T>(
  model: ChartModel<T>,
  options: { hass?: FormatHass; timeLabel?: (t: number) => string; extra?: unknown; periods?: boolean } = {},
): TemplateResult | typeof nothing {
  const selection = model.selection;
  if (model.empty || !selection) return nothing;
  const timeLabel = options.timeLabel ?? defaultChartTimeLabel(options.hass);
  return html`<div class="family-chart-readout">
    <span>${timeLabel(selection.t)}</span>
    ${[...selection.values.map(({ series, point }) => {
      if (!point) {
        // On a chart with lanes the cursor often stands on a time without a value. The dash
        // then takes the width of the series' widest value, so the head wraps the same way
        // with and without a value and the frame keeps its height while scrubbing.
        const widest = model.steps ? widestValue(series) : "";
        // `strong` cannot carry a name (ARIA 1.2): as an image it reads "No data" instead of the dash.
        return widest
          ? html`<strong class="family-chart-no-value family-chart-no-value-sized" data-series=${series.id} role="img" aria-label=${NO_DATA}><b>–</b><i
              class="family-chart-value-sizer" aria-hidden="true">${widest}</i></strong>`
          : html`<strong class="family-chart-no-value" data-series=${series.id} role="img" aria-label=${NO_DATA}>–</strong>`;
      }
      // Secondary series (by emphasis or axis) take their colour; primary values read in the primary text colour.
      const secondary = series.emphasis === "secondary" || series.axis === "secondary";
      const color = secondary && !series.colorAt ? chartSeriesColor(series) : undefined;
      return html`<strong data-series=${series.id} style=${color ? `color:${color}` : nothing}>${series.format(point.v as number)}</strong>`;
    }), ...(options.periods ? laneTexts(model).map(laneItem) : [])]}
    ${options.extra ?? nothing}
  </div>`;
}

/**
 * The period line of a chart with lanes: what each lane shows at the selected time, e.g.
 * "XC40 Charging · EX30 Planned", each behind a swatch in its period colour. One line of fixed
 * height (18 px; `CHART_PERIOD_LINE_PX` with the frame gap) that is there even when no lane has
 * a period at that time or the chart is empty, so the frame never changes height while the
 * selection moves; text that does not fit ends in an ellipsis. Place it under the chart:
 * `chartFrame({body: view.svg, below: view.periods})`.
 */
export function chartPeriodLine<T>(model: ChartModel<T>): TemplateResult {
  return html`<div class="family-chart-periods">${laneTexts(model).map(laneItem)}</div>`;
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
 * background); `periods` adds one entry per period tone after the series (`chartPeriodSwatch`) and `bands` one per band (`chartBandSwatch`); `gapNote` (e.g. "Gaps mean missing data") shows unless `show` is false, e.g. `show: model.hasGaps`.
 */
export function chartLegend<T>(
  series: ChartSeries<T>[],
  options: {
    gapNote?: string;
    show?: boolean;
    swatches?: Record<string, string>;
    /** Period tones to explain after the series, e.g. `{tone: "extra", label: "Extra while cheap"}`. */
    periods?: { tone: ChartPeriodTone; label: string; color?: string }[];
    /** Bands to explain after the periods, e.g. `{label: "No price yet"}`: a band too narrow for its label has no other legend. */
    bands?: { label: string; pattern?: "hatched" | "tint"; color?: string }[];
  } = {},
): TemplateResult {
  return html`<div class="family-chart-legend">
    ${[
      ...series.map(
        (entry) => html`<span data-series=${entry.id}><i style=${`background:${options.swatches?.[entry.id] || chartLegendSwatch(entry)}`}></i>${entry.label}</span>`,
      ),
      ...(options.periods ?? []).map(
        (entry) => html`<span data-period=${entry.tone}><i class="family-chart-period-swatch"
          style=${`background:${chartPeriodSwatch(entry.tone, entry.color)}`}></i>${entry.label}</span>`,
      ),
      ...(options.bands ?? []).map(
        (entry) => html`<span data-band=${entry.pattern === "tint" ? "tint" : "hatched"}><i class="family-chart-band-swatch"
          style=${`background:${chartBandSwatch(entry.pattern, entry.color)}`}></i>${entry.label}</span>`,
      ),
    ]}
    ${options.gapNote && options.show !== false
      ? html`<span class="family-chart-gap-note">${options.gapNote}</span>`
      : nothing}
  </div>`;
}

/**
 * Loading placeholder at the chart's drawn height (`chartTotalHeight`: `chartHeight` plus the
 * rows of `lanes`, if the chart will have any); static under reduced motion.
 */
export function chartSkeleton(options: { height: number; label: string; lanes?: number }): TemplateResult {
  return html`<div
    class="family-chart-skeleton"
    role="status"
    aria-label=${options.label}
    style=${`height:${chartTotalHeight(options.height, options.lanes)}px`}
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
  /** Number of lanes the chart has; their rows are added to the height. */
  lanes?: number;
}): TemplateResult {
  const { height, lanes, ...state } = options;
  return stateBody(chartTotalHeight(height, lanes), state);
}

/** `heightPx` is the drawn height (`chartTotalHeight`), not the configured one. */
function stateBody(
  heightPx: number,
  state: Parameters<typeof asyncState>[0],
  bodyRef?: (element?: Element) => void,
): TemplateResult {
  return html`<div
    class="family-chart-body family-chart-empty"
    style=${`min-height:${heightPx}px`}
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
 * Periods, bands and markers: `--family-chart-period-planned`, `-active`, `-extra`, `-warning`,
 * `-muted`, `-outline`, `-hatch` and `-active-duration` (the pulse, 2.4s), `--family-chart-band`,
 * `--family-chart-marker` and `--family-chart-lane-marker`.
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
  .family-chart-legend i.family-chart-period-swatch,
  .family-chart-legend i.family-chart-band-swatch,
  .family-chart-readout-period .family-chart-period-swatch {
    flex: none;
    display: inline-block;
    box-sizing: border-box;
    width: 12px;
    height: 8px;
    border-radius: 4px;
    border: 1px solid ${unsafeCSS(OUTLINE)};
  }
  .family-chart-legend i.family-chart-band-swatch {
    border-radius: 2px;
    border-color: var(--family-chart-grid, color-mix(in srgb, var(--primary-text-color) 13%, transparent));
  }
  .family-chart-readout-period .family-chart-lane-marker-swatch {
    flex: none;
    display: inline-block;
    width: 2px;
    height: 10px;
    border-radius: 1px;
    background: var(--family-chart-lane-marker, var(--primary-text-color));
  }
  /* Swatches carry the meaning of a tone: keep their paint in forced colours and in print. */
  .family-chart-legend i,
  .family-chart-period-swatch,
  .family-chart-band-swatch,
  .family-chart-lane-marker-swatch {
    forced-color-adjust: none;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .family-chart-readout .family-chart-readout-period {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  /* A missing value that keeps the width of a value (charts with lanes): the hidden text under
     the dash sizes it, and the dash comes first so the baseline is its own. */
  .family-chart-readout .family-chart-no-value-sized {
    display: inline-grid;
    justify-items: end;
  }
  .family-chart-value-sizer {
    display: block;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    font-style: normal;
  }
  .family-chart-no-value-sized b {
    font-weight: inherit;
  }
  /* The period line under a chart with lanes: always one line of the same height, so the
     frame does not move while the selection passes over periods. */
  .family-chart-periods {
    box-sizing: border-box;
    height: 18px;
    min-width: 0;
    overflow: hidden;
    color: var(--secondary-text-color);
    font-size: 12px;
    font-weight: 500;
    line-height: 18px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .family-chart-periods .family-chart-readout-period + .family-chart-readout-period::before {
    content: "·";
    margin: 0 6px;
  }
  .family-chart-periods .family-chart-period-swatch,
  .family-chart-periods .family-chart-lane-marker-swatch {
    margin-inline-end: 5px;
    vertical-align: -0.5px;
  }
  .family-chart-periods .family-chart-lane-marker-swatch {
    vertical-align: -1.5px;
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
  /* Bands: time ranges without data yet. Hatched by default so they do not read as a value. */
  .family-chart-band {
    stroke: none;
    pointer-events: none;
  }
  .family-chart-band[data-pattern="tint"] {
    fill: ${unsafeCSS(BAND)};
    opacity: 0.55;
  }
  .family-chart-band-line {
    stroke: ${unsafeCSS(BAND)};
    stroke-width: 1.5;
  }
  .family-chart .family-chart-band-label,
  .family-chart .family-chart-lane-label,
  .family-chart .family-chart-marker-label {
    text-anchor: start;
  }
  .family-chart .family-chart-marker-label-end {
    text-anchor: end;
  }
  .family-chart-marker {
    stroke: ${unsafeCSS(MARKER)};
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .family-chart-marker-dash {
    stroke-dasharray: 3 3;
  }
  /* Lanes: rows of periods under the plot, flat fills on a quiet outlined track. */
  .family-chart-lane-track {
    fill: none;
    stroke: var(--family-chart-grid, color-mix(in srgb, var(--primary-text-color) 13%, transparent));
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  /* Text anchors are laid out left to right, also inside a right-to-left document. */
  svg.family-chart {
    direction: ltr;
  }
  /* Every period has an outline that holds 3:1 against the chart background in light and dark
     themes, so a pale tone is still a visible shape. */
  .family-chart-period {
    fill: ${unsafeCSS(chartPeriodColor("planned"))};
    stroke: ${unsafeCSS(OUTLINE)};
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .family-chart-period[data-tone="active"] {
    fill: ${unsafeCSS(chartPeriodColor("active"))};
    animation: family-chart-period-pulse var(--family-chart-period-active-duration, 2.4s) ease-in-out infinite;
  }
  .family-chart-period[data-tone="extra"] {
    fill: ${unsafeCSS(chartPeriodColor("extra"))};
  }
  .family-chart-period[data-tone="warning"] {
    fill: ${unsafeCSS(chartPeriodColor("warning"))};
  }
  .family-chart-period[data-tone="muted"] {
    fill: ${unsafeCSS(chartPeriodColor("muted"))};
  }
  .family-chart-period-hatch {
    stroke: none;
    pointer-events: none;
  }
  .family-chart-period-hatch-line {
    stroke: ${unsafeCSS(HATCH)};
    stroke-width: 1;
  }
  .family-chart-period-bars-line {
    stroke-width: 1.5;
  }
  .family-chart-lane-marker {
    stroke: var(--family-chart-lane-marker, var(--primary-text-color));
    stroke-width: 2;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .family-chart-lane[data-muted] .family-chart-lane-label,
  .family-chart-lane[data-muted] .family-chart-lane-marker {
    opacity: 0.6;
  }
  @keyframes family-chart-period-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
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
    .family-chart-period[data-tone="active"] {
      animation: none;
    }
    .family-chart-skeleton {
      animation: none;
      background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
    }
  }
`;
