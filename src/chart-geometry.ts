import { formatHassDateTime, type FormatHass } from "./format.js";

/**
 * Time-series chart geometry for the card family, free of Lit and the DOM.
 *
 * Everything is measured in CSS pixels: the SVG viewBox is the measured width ×
 * the configured height, so 11px labels, 4px lines and the margins are real
 * pixels at every card width. Cards own their data, units and colours; these
 * helpers own scales, readable axis steps, label density, gaps and paths.
 * The weather (Space Hub) and electricity price charts are the visual reference.
 */

export interface ChartPoint<T = unknown> {
  t: number;
  /** `null` or a non-finite value is a gap; it is never drawn as zero. */
  v: number | null;
  data?: T;
}
export interface ChartDomain {
  start: number;
  end: number;
}
export type ChartCurve = "linear" | "smooth" | "step";
export interface XY {
  x: number;
  y: number;
}

/** 11px/600 labels measure about 5.6–5.8 px per character; the estimate errs wide. */
export const CHART_LABEL_CHAR_PX = 5.8;
export const CHART_LABEL_GAP_PX = 8;
/** Space between the plot edge and its axis labels: clears the 8.5px selection halo at the edge. */
export const CHART_AXIS_GAP_PX = 12;
export const CHART_FONT_PX = 11;
/** minAxis fits a 4-character label such as "100%" plus the axis gap, so stacked charts align. */
export const CHART_MARGIN = { top: 15, bottom: 24, edge: 8, minAxis: 36 } as const;
/** Frame padding (13) + head row (18) + gap (5), for card-size estimates. */
export const CHART_FRAME_CHROME_PX = 36;
/** Extra height of a legend row. */
export const CHART_LEGEND_PX = 21;
/** Height of one lane row under the plot (periods on a 10px track). */
export const CHART_LANE_PX = 22;
/** Space between the chart (its time labels) and the first lane. */
export const CHART_LANES_GAP_PX = 6;
/** Height of a lane's track and of the periods on it; both ends are round (rx 5). */
export const CHART_LANE_TRACK_PX = 10;
/** A period is never drawn narrower than this, so a short one stays visible. */
export const CHART_PERIOD_MIN_PX = 3;
/** Lane labels longer than this are cut to it, ellipsis included, so the axis gutter stays narrow. */
export const CHART_LANE_LABEL_CHARS = 8;
/** Height of an `active` period: 2 px taller than the track, centred on it, so it differs without colour or motion. */
export const CHART_PERIOD_ACTIVE_PX = 12;
/** A `done` period is 4 px slimmer than the track: what already happened differs without colour. */
export const CHART_PERIOD_DONE_PX = 6;
/** Extra frame height of the period line under a chart with lanes (18 px line + 5 px gap), for card-size estimates. */
export const CHART_PERIOD_LINE_PX = 23;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const DEFAULT_TICK_STEPS_MS: number[] = [
  15 * MINUTE_MS,
  30 * MINUTE_MS,
  HOUR_MS,
  2 * HOUR_MS,
  3 * HOUR_MS,
  4 * HOUR_MS,
  6 * HOUR_MS,
  8 * HOUR_MS,
  12 * HOUR_MS,
  16 * HOUR_MS,
  24 * HOUR_MS,
  48 * HOUR_MS,
  7 * 24 * HOUR_MS,
];

const HEIGHT_RANGE = [82, 360] as const;
const MIN_WIDTH = 120;
/** A nice axis may leave at most this share empty beyond the data before headroom (or, with one bound, the nice step) gives way. */
const EMPTY_AXIS_LIMIT = 0.25;
/** Neighbouring intervals further than this from `intervalMs` apart are a gap. */
const INTERVAL_TOLERANCE_MS = MINUTE_MS;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const isValue = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);
/** 12 significant digits removes float noise such as 0.30000000000000004. */
const clean = (value: number): number => Number(value.toPrecision(12));

/** The drawn chart height for a configured one: CSS px, clamped to 82–360 (what the SVG and its state blocks use). */
export function chartHeight(height: number): number {
  return clamp(Math.round(height) || 0, HEIGHT_RANGE[0], HEIGHT_RANGE[1]);
}

/**
 * The drawn height of a chart with `lanes` rows of periods under it, for card-size estimates:
 * `chartHeight(height)` plus 22 px per lane and a 6 px gap. Without lanes it is `chartHeight(height)`.
 */
export function chartTotalHeight(height: number, lanes: number = 0): number {
  const rows = Math.max(0, Math.floor(lanes) || 0);
  return chartHeight(height) + (rows ? rows * CHART_LANE_PX + CHART_LANES_GAP_PX : 0);
}

// ---------------------------------------------------------------- scales

export interface LinearScale {
  (value: number): number;
  invert(px: number): number;
  domain: [number, number];
  range: [number, number];
}

/** A zero-span domain maps to the middle of the range. */
export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const scale = ((value: number) =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
  scale.invert = (px: number) =>
    r1 === r0 || span === 0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * span;
  scale.domain = [d0, d1];
  scale.range = [r0, r1];
  return scale;
}

const STEP_MULTIPLIERS = [1, 2, 2.5, 3, 4, 5, 6, 8];

/** Readable steps 1, 2, 2.5, 3, 4, 5, 6, 8 × 10^n (2.5 skipped when `integer`). */
export function niceStep(rough: number, options: { integer?: boolean } = {}): number {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1;
  if (options.integer && rough <= 1) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const multipliers = options.integer && magnitude < 10
    ? STEP_MULTIPLIERS.filter((multiplier) => multiplier !== 2.5)
    : STEP_MULTIPLIERS;
  const multiplier = multipliers.find((candidate) => candidate >= normalized - 1e-9) ?? 10;
  return clean(multiplier * magnitude);
}

const FINE_STEP_MULTIPLIERS = [1, 1.2, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8];

/**
 * A finer readable step for an even split from one bound: 1, 1.2, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8 × 10^n,
 * skipping steps whose labels need more than `maxDecimals` decimals (0.015 where the nice step reads 0.02).
 */
function fineStep(rough: number, integer: boolean | undefined, maxDecimals: number): number {
  if (integer) return Math.max(1, Math.ceil(rough - 1e-9));
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = FINE_STEP_MULTIPLIERS
    .map((multiplier) => clean(multiplier * magnitude))
    .find((candidate) => candidate >= rough - magnitude * 1e-9 && stepDecimals(candidate) <= maxDecimals);
  return step ?? clean(10 * magnitude);
}

/**
 * Decimals that show every multiple of `step` distinctly, e.g. 0.25 -> 2, 0.08 -> 2, 100 -> 0.
 * A non-terminating step (an explicit 0…0.5 split in thirds) stops at three significant digits.
 */
export function stepDecimals(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  const limit = clamp(2 - Math.floor(Math.log10(step)), 0, 12);
  let decimals = 0;
  while (decimals < limit) {
    const scaled = step * Math.pow(10, decimals);
    const rounded = Math.round(scaled);
    if (rounded > 0 && Math.abs(scaled - rounded) < 1e-6 * scaled) break;
    decimals++;
  }
  return decimals;
}

export interface NiceDomainOptions {
  /** Exact gridline count, 2..9. */
  lines: number;
  /** Explicit bounds are used as given; both together split evenly without nicing. */
  min?: number;
  max?: number;
  /** Keep zero on the axis (bars, power). */
  includeZero?: boolean;
  /** Smallest span before nicing, e.g. 100 W, 1 A or 1 °. */
  minSpan?: number;
  /** Headroom fraction before nicing, default 0.04. */
  pad?: number;
  integer?: boolean;
  /**
   * Label decimals the card shows anyway, e.g. 2 for a price axis. A smaller step than the nice
   * one (headroom giving way, a one-bound split) may need up to this many, or the nice step's.
   */
  decimals?: number;
}

export interface NiceDomain {
  min: number;
  max: number;
  /**
   * Tick spacing, and the unit for `stepDecimals`. A two-line axis that crosses zero
   * cannot be spaced evenly around it; its two ticks are multiples of this nice unit instead.
   */
  step: number;
  /** Ascending tick values, exactly `lines` of them. */
  ticks: number[];
}

const lineCount = (lines: number): number => clamp(Math.round(lines) || 5, 2, 9);

/** Smallest readable step with lo = floor(min/step)·step and lo + step·(lines−1) >= max. Values cleaned to 12 significant digits. */
export function niceDomain(values: number[], options: NiceDomainOptions): NiceDomain {
  const lines = lineCount(options.lines);
  const intervals = lines - 1;
  const explicitMin = isValue(options.min) ? options.min : undefined;
  let explicitMax = isValue(options.max) ? options.max : undefined;
  if (explicitMin !== undefined && explicitMax !== undefined && !(explicitMax > explicitMin)) explicitMax = undefined;
  const even = (lo: number, step: number): NiceDomain => {
    const ticks = Array.from({ length: lines }, (_, index) => {
      const value = clean(lo + step * index);
      return Math.abs(value) < Math.abs(step) * 1e-9 ? 0 : value;
    });
    return { min: ticks[0], max: ticks[intervals], step: clean(step), ticks };
  };
  if (explicitMin !== undefined && explicitMax !== undefined) {
    return even(explicitMin, (explicitMax - explicitMin) / intervals);
  }

  const finite = values.filter(isValue);
  let lo = finite.length ? Math.min(...finite) : 0;
  let hi = finite.length ? Math.max(...finite) : 0;
  if (options.includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (explicitMin !== undefined) lo = explicitMin;
  if (explicitMax !== undefined) hi = explicitMax;
  const minSpan = isValue(options.minSpan) && options.minSpan > 0 ? options.minSpan : 0;
  const wanted = Math.max(minSpan, hi > lo ? 0 : 1);
  const grown = hi - lo < wanted;
  if (grown) {
    // Grow away from a fixed or zero bound; otherwise grow around the middle.
    if (explicitMin !== undefined || lo === 0) hi = lo + wanted;
    else if (explicitMax !== undefined || hi === 0) lo = hi - wanted;
    else {
      const middle = (lo + hi) / 2;
      lo = middle - wanted / 2;
      hi = middle + wanted / 2;
    }
  }
  // The data extent before headroom: an unpadded fit and the empty-share check use it.
  const dataLo = lo;
  const dataHi = hi;
  // Headroom never pushes an axis across zero: non-negative data keeps a 0 floor.
  // A span grown to `minSpan` already has room.
  const padding = grown ? 0 : (hi - lo) * (isValue(options.pad) ? Math.max(0, options.pad) : 0.04);
  if (explicitMax === undefined && hi !== 0) hi = hi < 0 ? Math.min(0, hi + padding) : hi + padding;
  if (explicitMin === undefined && lo !== 0) lo = lo > 0 ? Math.max(0, lo - padding) : lo - padding;

  // Headroom is a preference everywhere: when the padded axis would leave more than a quarter
  // of it empty, the unpadded data at a smaller readable step wins (−0.1…0.3 reads −0.1…0.3
  // by 0.1, not −0.2…0.6 by 0.2), unless that step needs more label decimals.
  const unpaddedStep = niceStep((dataHi - dataLo) / intervals, options);
  const labelDecimals = isValue(options.decimals) ? clamp(Math.round(options.decimals), 0, 12) : 0;

  // One explicit bound: nice steps away from it, unless that would cross zero; then the
  // axis keeps zero and splits evenly up to (or down from) the bound, like the old 0…max.
  // When the nice step would leave more than a quarter of the axis empty beyond the data
  // (0…40 at 5 lines is 0…80 by 20), the unpadded data at a smaller nice step comes first
  // (0…40 by 10); else it splits evenly from the bound to just past the padded data, by a
  // finer readable step (0…45 by 15 at 4 lines) when that stays within the quarter, else
  // exactly. Neither may need more label decimals than the nice step or `decimals` (0.01…0.05
  // from 0 keeps 0…0.08 by 0.02, not 0…0.06 by 0.015); an `integer` axis keeps whole steps.
  const emptyShare = (axis: NiceDomain): number =>
    explicitMax !== undefined
      ? (dataLo - axis.min) / (axis.max - axis.min)
      : (axis.max - dataHi) / (axis.max - axis.min);
  const fromBound = (step: number): NiceDomain =>
    explicitMax !== undefined ? even(hi - step * intervals, step) : even(lo, step);
  const oneBound = (nice: NiceDomain): NiceDomain => {
    if (emptyShare(nice) <= EMPTY_AXIS_LIMIT) return nice;
    const decimals = Math.max(labelDecimals, stepDecimals(nice.step));
    const usable = (axis: NiceDomain): boolean =>
      stepDecimals(axis.step) <= decimals
      && !(explicitMax !== undefined ? axis.min < 0 && dataLo >= 0 : axis.max > 0 && dataHi <= 0);
    let result = nice;
    const unpadded = fromBound(unpaddedStep);
    if (unpaddedStep < nice.step && emptyShare(unpadded) >= -1e-9 && usable(unpadded)) {
      if (emptyShare(unpadded) <= EMPTY_AXIS_LIMIT) return unpadded;
      result = unpadded;
    }
    const rough = (hi - lo) / intervals;
    const fine = fromBound(fineStep(rough, options.integer, decimals));
    if (fine.step < result.step && emptyShare(fine) <= EMPTY_AXIS_LIMIT && usable(fine)) return fine;
    // No readable step fits closer: split exactly, unless an integer axis or the label decimals forbid it.
    const exact = fromBound(rough);
    return options.integer || !usable(exact) ? result : exact;
  };
  if (explicitMax !== undefined) {
    const step = niceStep((hi - lo) / intervals, options);
    return oneBound(lo >= 0 && hi - step * intervals < 0 && hi > 0 ? even(0, hi / intervals) : even(hi - step * intervals, step));
  }
  if (explicitMin !== undefined) {
    const step = niceStep((hi - lo) / intervals, options);
    return oneBound(hi <= 0 && lo + step * intervals > 0 && lo < 0 ? even(lo, -lo / intervals) : even(lo, step));
  }
  // Lowest tick index when `from…to` fits in `lines` ticks of `step`.
  const fit = (step: number, from: number, to: number): number | undefined => {
    const first = Math.floor(clean(from / step));
    return (first + intervals) * step >= to - Math.abs(step) * 1e-9 ? first : undefined;
  };
  // The first readable step from `step` up that fits; with `padded`, the padded data at a step
  // beats the unpadded data at it (−0.05…0.30 misses −0.1…0.3 padded, fits unpadded).
  const search = (step: number, padded: boolean): NiceDomain | undefined => {
    for (let guard = 0; guard < 40; guard++) {
      const first = (padded ? fit(step, lo, hi) : undefined) ?? fit(step, dataLo, dataHi);
      if (first !== undefined) {
        const ticks = Array.from({ length: lines }, (_, index) => clean((first + index) * step));
        return { min: ticks[0], max: ticks[intervals], step, ticks };
      }
      step = niceStep(step * (1 + 1e-6), options);
    }
    return undefined;
  };
  const withHeadroom = search(niceStep((hi - lo) / intervals, options), true);
  if (withHeadroom) {
    const span = withHeadroom.max - withHeadroom.min;
    if (span - (dataHi - dataLo) <= EMPTY_AXIS_LIMIT * span) return withHeadroom;
    const tight = search(unpaddedStep, false);
    return tight && tight.step < withHeadroom.step
      && stepDecimals(tight.step) <= Math.max(labelDecimals, stepDecimals(withHeadroom.step))
      ? tight
      : withHeadroom;
  }
  // Only two lines across zero get here (the lower tick would always be −step, the upper 0):
  // round each bound outward to a nice unit about a quarter of the span.
  const unit = niceStep((hi - lo) / 4, options);
  const ticks = [clean(Math.floor(clean(lo / unit)) * unit), clean(Math.ceil(clean(hi / unit)) * unit)];
  return { min: ticks[0], max: ticks[1], step: unit, ticks };
}

// ---------------------------------------------------------------- time ticks

export function estimateLabelWidth(text: string, charPx: number = CHART_LABEL_CHAR_PX): number {
  return text.length * charPx;
}

const WIDE_GLYPH = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;
const EMOJI_GLYPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
/** 11px/600 advance widths per character class: [reserve (errs wide), typical]. Measured in Roboto and Helvetica. */
const GLYPH_PX = {
  emoji: [14, 14],
  wide: [12, 11.2],
  ellipsis: [11, 11],
  capsWide: [10.4, 9.8],
  caps: [7.6, 7.2],
  lowerWide: [9.8, 9],
  lower: [6, 5.6],
  digit: [6.6, 6.1],
  other: [4, 3.2],
} as const;

let segmenter: { segment(text: string): Iterable<{ segment: string }> } | null | undefined;
/** User-perceived characters (`Intl.Segmenter`), so a flag, a family emoji or a letter with a combining mark stays whole; code points where it is missing. */
function graphemes(text: string): string[] {
  // Plain ASCII has one code unit per character: no segmenter needed for "XC40" or "Day tariff".
  if (/^[\x20-\x7e]*$/.test(text)) return text.split("");
  if (segmenter === undefined) {
    const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => typeof segmenter }).Segmenter;
    segmenter = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : null;
  }
  return segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : [...text];
}

/**
 * Width of an 11px/600 label by character class instead of one width per character: capitals,
 * CJK and emoji are far wider than lowercase. `reserve` (default) errs wide and is what a label
 * gets room for; `typical` is the expected width, for "does this label fit" rules.
 */
export function estimateTextWidth(text: string, mode: "reserve" | "typical" = "reserve"): number {
  const column = mode === "typical" ? 1 : 0;
  let width = 0;
  for (const glyph of graphemes(String(text ?? ""))) {
    const ascii = glyph.length === 1 && glyph.charCodeAt(0) < 0x80;
    const kind: keyof typeof GLYPH_PX = !ascii && EMOJI_GLYPH.test(glyph)
      ? "emoji"
      : !ascii && WIDE_GLYPH.test(glyph)
        ? "wide"
        : glyph === "…"
          ? "ellipsis"
          : /^[0-9]/.test(glyph)
            ? "digit"
            : glyph.toLowerCase() !== glyph
              ? (/^[MW]/.test(glyph) ? "capsWide" : "caps")
              : glyph.toUpperCase() !== glyph
                ? (/^[mw]/.test(glyph) ? "lowerWide" : "lower")
                : "other";
    width += GLYPH_PX[kind][column];
  }
  return width;
}

/**
 * Ticks aligned to domain.start at the first step (ascending) whose labels fit:
 * edge labels anchor inwards, so each neighbouring pair needs its facing extents + gap.
 * A tick past domain.end is dropped. Falls back to [start, end], or [start] when even those overlap.
 */
export function timeTicks(
  domain: ChartDomain,
  plotWidthPx: number,
  format: (t: number) => string,
  options: { stepsMs?: number[]; charPx?: number; gapPx?: number } = {},
): number[] {
  const { start, end } = domain;
  if (!(end > start)) return Number.isFinite(start) ? [start] : [];
  const span = end - start;
  const charPx = options.charPx ?? CHART_LABEL_CHAR_PX;
  const gapPx = options.gapPx ?? CHART_LABEL_GAP_PX;
  const labels = new Map<number, number>();
  const width = (t: number): number => {
    let measured = labels.get(t);
    if (measured === undefined) {
      measured = estimateLabelWidth(format(t), charPx);
      labels.set(t, measured);
    }
    return measured;
  };
  const steps = [...(options.stepsMs ?? DEFAULT_TICK_STEPS_MS)]
    .filter((step) => step > 0)
    .sort((a, b) => a - b);
  for (const step of steps) {
    const count = Math.floor(span / step + 1e-9) + 1;
    if (count < 2) continue;
    const spacing = (step / span) * plotWidthPx;
    // Even one-character labels need the gap; skip impossible steps before formatting.
    if (spacing < gapPx + charPx) continue;
    const ticks = Array.from({ length: count }, (_, index) => start + index * step);
    const last = ticks[count - 1];
    const lastOnEnd = Math.abs(end - last) < 1;
    const fits = ticks.slice(1).every((t, index) => {
      const left = index === 0 ? width(ticks[0]) : width(ticks[index]) / 2;
      const right = index + 1 === count - 1 && lastOnEnd ? width(t) : width(t) / 2;
      return left + right + gapPx <= spacing;
    });
    // A centred last label may reach into the axis margin, never past the chart.
    const inside = lastOnEnd || width(last) / 2 <= ((end - last) / span) * plotWidthPx + CHART_MARGIN.minAxis;
    if (fits && inside) return ticks;
  }
  // Both ends anchor inwards; when even they collide, the start label stands alone.
  return width(start) + width(end) + gapPx <= plotWidthPx ? [start, end] : [start];
}

// ---------------------------------------------------------------- series and paths

/** Split into contiguous runs: null/NaN, interval breaks (|Δt − intervalMs| >= 60 s) and Δt > maxGapMs. Points are in time order. */
export function segmentPoints<T>(
  points: ChartPoint<T>[],
  options: { intervalMs?: number; maxGapMs?: number } = {},
): ChartPoint<T>[][] {
  const segments: ChartPoint<T>[][] = [];
  let current: ChartPoint<T>[] = [];
  const flush = () => {
    if (current.length) segments.push(current);
    current = [];
  };
  for (const point of points) {
    if (!isValue(point.v)) {
      flush();
      continue;
    }
    const previous = current[current.length - 1];
    if (previous) {
      const delta = point.t - previous.t;
      const intervalBreak = options.intervalMs !== undefined
        && Math.abs(delta - options.intervalMs) >= INTERVAL_TOLERANCE_MS;
      const tooFar = options.maxGapMs !== undefined && delta > options.maxGapMs;
      if (intervalBreak || tooFar) flush();
    }
    current.push(point);
  }
  flush();
  return segments;
}

const xy = (x: number, y: number): string => `${x.toFixed(2)} ${y.toFixed(2)}`;

/** A lone point is a zero-length line: round caps draw it as a dot instead of nothing. */
const dotPath = (point: XY): string => `M ${xy(point.x, point.y)} L ${xy(point.x, point.y)}`;

export function linePath(points: XY[]): string {
  if (points.length === 1) return dotPath(points[0]);
  return points.map((point, index) => `${index ? "L" : "M"} ${xy(point.x, point.y)}`).join(" ");
}

/** Catmull-Rom with 1/6 tension (the weather card's curve); it passes through every point. */
export function smoothPath(points: XY[]): string {
  if (!points.length) return "";
  if (points.length === 1) return dotPath(points[0]);
  let path = `M ${xy(points[0].x, points[0].y)}`;
  for (let index = 0; index < points.length - 1; index++) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[index - 1] || current;
    const after = points[index + 2] || next;
    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (after.x - current.x) / 6;
    const cp2y = next.y - (after.y - current.y) / 6;
    path += ` C ${xy(cp1x, cp1y)}, ${xy(cp2x, cp2y)}, ${xy(next.x, next.y)}`;
  }
  return path;
}

/** Step-after: each point is level from x to x1; verticals join neighbours inside a segment. */
export function stepPath(points: (XY & { x1: number })[]): string {
  return points
    .map((point, index) => `${index ? "L" : "M"} ${xy(point.x, point.y)} L ${xy(point.x1, point.y)}`)
    .join(" ");
}

export function areaPath(line: string, firstX: number, lastX: number, baseline: number): string {
  if (!line) return "";
  return `${line} L ${xy(lastX, baseline)} L ${xy(firstX, baseline)} Z`;
}

/**
 * A bar centred in its interval slot, growing up or down from `zeroY`. By default a bar is at
 * most 14px wide. With `fit: "interval"` it fills its slot but for a 1px gap on each side, so
 * its edges line up with anything else drawn on the same time scale (period lanes, bands).
 */
export function barRect(
  x0: number,
  x1: number,
  y: number,
  zeroY: number,
  fit: "narrow" | "interval" = "narrow",
): { x: number; y: number; width: number; height: number } {
  const slot = Math.max(0, x1 - x0);
  const width = fit === "interval" ? Math.max(1, slot - Math.min(2, slot * 0.25)) : clamp(slot * 0.9, 2, 14);
  return {
    x: x0 + Math.max(0, (slot - width) / 2),
    y: Math.min(y, zeroY),
    width,
    height: Math.max(1, Math.abs(zeroY - y)),
  };
}

/** First lowest and first highest finite point. */
export function extremes<T>(points: ChartPoint<T>[]): { min?: ChartPoint<T>; max?: ChartPoint<T> } {
  let min: ChartPoint<T> | undefined;
  let max: ChartPoint<T> | undefined;
  for (const point of points) {
    if (!isValue(point.v)) continue;
    if (!min || point.v < (min.v as number)) min = point;
    if (!max || point.v > (max.v as number)) max = point;
  }
  return { min, max };
}

/** Last point with t <= time (interval semantics, electricity); 0 before the first, −1 when empty. */
export function indexAtTime(points: { t: number }[], time: number): number {
  if (!points.length) return -1;
  let index = 0;
  for (let candidate = 1; candidate < points.length; candidate++) {
    if (points[candidate].t > time) break;
    index = candidate;
  }
  return index;
}

/** Point closest in time (first on a tie); −1 when empty. */
export function nearestIndex(points: { t: number }[], time: number): number {
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const next = Math.abs(point.t - time);
    if (next < distance) {
      distance = next;
      best = index;
    }
  });
  return best;
}

/**
 * Slider keys: ←/↓ −1, →/↑ +1, PageDown/PageUp ±max(1, round(n/8)), Home, End,
 * Escape returns `"now"` (follow the current time). Other keys return undefined.
 */
export function keyboardIndex(key: string, current: number, count: number): number | "now" | undefined {
  if (key === "Escape") return "now";
  if (count <= 0) return undefined;
  const page = Math.max(1, Math.round(count / 8));
  const from = clamp(current, 0, count - 1);
  let next: number;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      next = from - 1;
      break;
    case "ArrowRight":
    case "ArrowUp":
      next = from + 1;
      break;
    case "PageDown":
      next = from - page;
      break;
    case "PageUp":
      next = from + page;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = count - 1;
      break;
    default:
      return undefined;
  }
  return clamp(next, 0, count - 1);
}

/** Generic recorder bucketing (printer buildChartBuckets): last sample before each bucket end, carried forward from before start; max 1440 buckets. */
export function sampleAndHold(
  points: ChartPoint[],
  options: { start: number; end: number; bucketMs: number; maxBuckets?: number },
): ChartPoint[] {
  const { start, end, bucketMs } = options;
  if (!(end > start) || !(bucketMs > 0)) return [];
  const count = Math.max(1, Math.min(options.maxBuckets ?? 1440, Math.ceil((end - start) / bucketMs)));
  const width = (end - start) / count;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const buckets: ChartPoint[] = [];
  let index = 0;
  let value: number | null = null;
  while (index < sorted.length && sorted[index].t <= start) value = sorted[index++].v;
  for (let bucket = 0; bucket < count; bucket++) {
    const bucketStart = start + bucket * width;
    const bucketEnd = bucketStart + width;
    while (index < sorted.length && sorted[index].t < bucketEnd) value = sorted[index++].v;
    buckets.push({ t: bucketStart, v: isValue(value) ? value : null });
  }
  return buckets;
}

/** Id fragment, safe inside `url(#…)`; case is kept because ids are case-sensitive. */
export function safeId(value: string): string {
  return String(value).replace(/[^a-z0-9_-]/gi, "-");
}

/** FNV-1a, base 36: a short tag that tells apart raw ids which sanitize or join alike. */
function idHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Gradient and mask id for one series of one chart, unique within a shadow root:
 * "family-chart-{chart}-{series}-{hash}-{part}". The hash covers both raw ids, so
 * "a-b"/"c" and "a"/"b-c" (or "Price"/"price" after sanitizing) never collide.
 */
export function chartDefId(chartId: string, seriesId: string, part: string): string {
  return `family-chart-${safeId(chartId)}-${safeId(seriesId)}-${idHash(`${chartId}\u0000${seriesId}`)}-${part}`;
}

// ---------------------------------------------------------------- chart layout

export interface ChartAxisOptions extends Omit<NiceDomainOptions, "lines"> {
  /**
   * Axis label text, e.g. "300 W", "12°", "0.08 €". `axis` is the computed domain, so
   * labels can take `stepDecimals(axis.step)` decimals and never repeat or round wrongly.
   */
  format: (value: number, axis: NiceDomain) => string;
  /** Label colour. The secondary axis defaults to the colour of its first series. */
  color?: string;
}

export interface ChartSeries<T = unknown> {
  id: string;
  label: string;
  points: ChartPoint<T>[];
  /** Default `line`. */
  kind?: "line" | "bar";
  /** Default `linear`; bars always use interval (step) semantics. */
  curve?: ChartCurve;
  /** Required for step and bar (layout throws without it): each point covers [t, t + intervalMs). */
  intervalMs?: number;
  /**
   * Bars only. `narrow` (default): at most 14px wide, centred in the interval. `interval`: the
   * bar fills its interval, for charts that draw periods or bands under the same time scale.
   */
  barFit?: "narrow" | "interval";
  /** Linear and smooth lines break when neighbours are further apart. */
  maxGapMs?: number;
  /** `primary` is the right axis. */
  axis?: "primary" | "secondary";
  /** `primary` (default): 4px with shadow and area. `secondary`: 2px, no shadow. */
  emphasis?: "primary" | "secondary";
  /** Default: emphasis === "primary" && kind === "line". */
  area?: boolean;
  color?: string;
  /** Per-point colour, painted as a horizontal gradient (lines) or per bar. */
  colorAt?: (point: ChartPoint<T>) => string;
  /** Default `hard` when intervalMs is set, otherwise `smooth`. */
  colorBlend?: "hard" | "smooth";
  areaColor?: string;
  /** Draw H and L over the highest and lowest values. */
  extremes?: boolean;
  /** Readout and aria value text. */
  format: (value: number) => string;
}

/** `done` (1.10.0) is a period that already happened, e.g. the hours a car charged. */
export type ChartPeriodTone = "planned" | "active" | "done" | "extra" | "warning" | "muted";

/** A time range on a lane, e.g. one planned charging block. */
export interface ChartPeriod {
  /** ms; clipped to the chart domain. A period outside it, or with `end <= start`, is dropped. */
  start: number;
  end: number;
  /** Default `planned`. */
  tone?: ChartPeriodTone;
  /** CSS colour (`chartSafeColor`); overrides the tone colour. Anything that is not a plain colour is ignored. */
  color?: string;
  /** Period line and aria text, e.g. "Charging", "Planned", "Extra while cheap". Defaults to the tone. */
  label?: string;
}

/** A row of periods under the plot, on the plot's time scale: one car, one heating zone, one robot. */
export interface ChartLane {
  /** Unique within the chart: pattern ids and `data-lane` come from it. */
  id: string;
  /**
   * Short row label in the right axis gutter; longer than 8 characters is cut with an ellipsis,
   * so labels should differ within their first 7 characters.
   */
  label: string;
  /** Periods should not overlap: the last one is drawn on top and is the one the selection reads. */
  periods: ChartPeriod[];
  /** A short vertical tick across this lane, e.g. the car's ready-by time. Outside the domain it is not drawn. */
  marker?: { t: number; label?: string };
  /** Draw every period with the `muted` tone and without animation (plan paused). */
  muted?: boolean;
  /**
   * What a muted lane reads in the period line, aria text and description: "{label} {mutedLabel}",
   * e.g. "Paused". Without it a muted lane reads "{label} {period.label} (paused)".
   */
  mutedLabel?: string;
}

/** A shaded time range inside the plot, behind the gridlines and series (e.g. hours without a published price). */
export interface ChartBand {
  /** ms; clipped to the chart domain. */
  start: number;
  end: number;
  /**
   * Drawn once at the top left inside the band when the band is at least as wide as the label
   * plus 8 px; always part of the aria text and description. Name a narrow band in the legend too.
   */
  label?: string;
  /** Default `hatched` (diagonal lines); `tint` is a flat, weaker fill. */
  pattern?: "hatched" | "tint";
  /** CSS colour; default `--family-chart-band`. */
  color?: string;
}

/** A vertical time marker across the plot and the lanes. Outside the domain it is not drawn. */
export interface ChartMarker {
  t: number;
  /**
   * Drawn above the plot beside the line, on the side away from the nearer plot edge. Labels
   * are placed in time order; one that would leave the plot or come within 8 px of an earlier
   * label tries the other side and is dropped otherwise, so keep it short.
   */
  label?: string;
  /** CSS colour (`chartSafeColor`); default `--family-chart-marker`, a neutral text-colour mix. */
  color?: string;
  dash?: boolean;
}

export interface TimeSeriesChartOptions<T = unknown> {
  /** Unique within the host: width key and gradient ids. */
  id: string;
  /** Slider accessible name. */
  label: string;
  /** SVG `<desc>`; defaults to "{n} points from {start} to {end}." */
  description?: string;
  series: ChartSeries<T>[];
  /** Default: first t .. last t (+ intervalMs). */
  domain?: ChartDomain;
  /** CSS px, clamped to 82–360. */
  height: number;
  /** Horizontal gridlines, 2–9, default 5. */
  lines?: number;
  axes: { primary: ChartAxisOptions; secondary?: ChartAxisOptions };
  hass?: FormatHass;
  /** Default formatHassDateTime(hass, t, {year: false}), e.g. "3 Nov, 14:00". */
  timeLabel?: (t: number) => string;
  tickStepsMs?: number[];
  /** Default Date.now(). */
  now?: number;
  /** Default true. */
  nowMarker?: boolean;
  /**
   * Charts in one group share the selected time. Default `id`. A chart without a value near
   * that time keeps its cursor there and reads "No data" instead of snapping elsewhere.
   */
  selectionGroup?: string;
  /**
   * `hover` (default) previews the point under the mouse and returns to the pinned selection
   * (or now) on pointerleave; `press` only selects on press and drag. Presses, drags, touch,
   * pen and keyboard pin the selection until Escape or another pick.
   */
  selectOn?: "hover" | "press";
  valueText?: (selection: ChartSelection<T>) => string;
  emptyMessage?: string;
  /**
   * Rows of time periods under the plot, below the time labels, on the plot's time scale.
   * Each adds 22 px to the drawn height (plus one 6 px gap): see `chartTotalHeight`.
   * Lanes, bands and markers never extend the domain.
   */
  lanes?: ChartLane[];
  /** Shaded time ranges inside the plot, behind the gridlines and series. Not data: a chart with only bands is empty. */
  bands?: ChartBand[];
  /** Vertical time markers across the plot and the lanes. */
  markers?: ChartMarker[];
}

export interface ChartSelection<T = unknown> {
  t: number;
  x: number;
  /** Index into `model.selectable` (the nearest one when the selected time has no value here); into `model.steps` on a chart with lanes. */
  index: number;
  followsNow: boolean;
  /**
   * One entry per series; no `point` means no value at `t`. A time picked in another chart of
   * the selection group keeps `t` and leaves every value empty here when no point is within
   * tolerance (the containing interval, else maxGapMs/2 or intervalMs/2).
   */
  values: { series: ChartSeries<T>; point?: ChartPoint<T>; y?: number }[];
  /**
   * One entry per lane: the period at the selection, if any. For a selected interval (bar or
   * step) it is the period that overlaps `range` most (the later one on a tie); otherwise, and
   * while following now, the period that contains the time (start inclusive, end exclusive).
   * Of overlapping periods the last one, drawn on top, wins.
   */
  periods: { lane: ChartLane; period?: ChartPeriod }[];
  /**
   * Only on a chart with lanes, whose selection is a time rather than a series point: the time
   * range the selection stands for. A selected interval is `[start, end)`; a single time
   * (a line chart's step, or now while following it) has `start === end`.
   */
  range?: { start: number; end: number };
}

export interface ChartModel<T = unknown> {
  empty: boolean;
  width: number;
  /** The plot-area height (`chartHeight`): the chart without its lanes. */
  height: number;
  /** The drawn height, lanes included (`chartTotalHeight`): what the SVG and its state blocks use. */
  totalHeight: number;
  plot: { left: number; right: number; top: number; bottom: number };
  x: LinearScale;
  y: { primary: LinearScale; secondary?: LinearScale };
  gridY: number[];
  axisLabels: { primary: { y: number; text: string }[]; secondary?: { y: number; text: string }[] };
  ticks: { t: number; x: number; text: string; anchor: "start" | "middle" | "end" }[];
  series: {
    series: ChartSeries<T>;
    segments: { line: string; area?: string }[];
    bars?: (ReturnType<typeof barRect> & { point: ChartPoint<T>; fill: string })[];
    stops?: { offset: number; color: string }[];
  }[];
  now?: { x: number };
  extremes: { x: number; y: number; text: "H" | "L" }[];
  /** Lane rows under the chart, top to bottom; empty without lanes. `y` is the top of the 22 px row. */
  lanes: {
    lane: ChartLane;
    y: number;
    track: { x: number; y: number; width: number; height: number };
    /** Text-anchor start, vertically centred on the track. `room` is the width reserved for it up to the chart's right edge. */
    label: { x: number; y: number; text: string; room: number };
    periods: { period: ChartPeriod; tone: ChartPeriodTone; x: number; width: number }[];
    marker?: { x: number };
  }[];
  /** Shaded ranges clipped to the domain, spanning plot.top..plot.bottom. */
  bands: { band: ChartBand; x: number; width: number; label?: { x: number; y: number; text: string } }[];
  markers: { marker: ChartMarker; x: number; label?: { x: number; y: number; text: string; anchor: "start" | "end" } }[];
  selection?: ChartSelection<T>;
  /** Index space for slider/keyboard (primary series, finite values). With lanes it is `steps` instead. */
  selectable: ChartPoint<T>[];
  /**
   * Only on a chart with lanes: every selectable time across the whole domain, ascending, and the
   * index space of the slider (`selection.index`). For an interval series these are its points'
   * interval starts plus interval-sized slots over the hours without data; for a line series its
   * sample times, evenly spaced steps where it has no samples, period boundaries and lane markers.
   */
  steps?: number[];
  /** The series `selectable` comes from. */
  selectableSeries?: ChartSeries<T>;
  /** True when that series has interval semantics (step or bar): pointer and keyboard snap to intervals. */
  intervalSelection: boolean;
  hasGaps: boolean;
  xPercent(t: number): number;
}

const SERIES_1 = "var(--family-chart-series-1, var(--family-active, var(--primary-color)))";
const SERIES_2 = "var(--family-chart-series-2, color-mix(in srgb, var(--primary-text-color) 55%, transparent))";

/** The series paint when it has no per-point colour: its `color`, else the family series colour for its emphasis. */
export function chartSeriesColor(series: Pick<ChartSeries, "color" | "emphasis">): string {
  return series.color || (series.emphasis === "secondary" ? SERIES_2 : SERIES_1);
}

const PERIOD_PLANNED = `var(--family-chart-period-planned, color-mix(in srgb, ${SERIES_1} 75%, transparent))`;
const PERIOD_ACTIVE = "var(--family-chart-period-active, var(--family-success, var(--success-color, #43a047)))";
const PERIOD_COLORS: Record<ChartPeriodTone, string> = {
  planned: PERIOD_PLANNED,
  active: PERIOD_ACTIVE,
  // What already happened: the active colour at about half strength, still and flat.
  done: `var(--family-chart-period-done, color-mix(in srgb, ${PERIOD_ACTIVE} 48%, transparent))`,
  // 46 % of the planned colour (itself 75 %) is about 35 % of the series colour, and follows an overridden planned colour.
  extra: `var(--family-chart-period-extra, color-mix(in srgb, ${PERIOD_PLANNED} 46%, transparent))`,
  warning: "var(--family-chart-period-warning, var(--family-warning, var(--warning-color, #ff9800)))",
  muted: "var(--family-chart-period-muted, color-mix(in srgb, var(--primary-text-color) 22%, transparent))",
};

/** The tone a period is drawn and read with: `muted` on a muted lane, else its own, default `planned`. */
export function chartPeriodTone(lane: Pick<ChartLane, "muted">, period: Pick<ChartPeriod, "tone">): ChartPeriodTone {
  return lane.muted ? "muted" : period.tone && period.tone in PERIOD_COLORS ? period.tone : "planned";
}

const SAFE_COLOR = /^(?:[a-z]{3,32}|#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var)\([-\w\s.,%/#()+*]*\))$/i;

/**
 * A caller's colour as it may go into a `style` attribute: a named colour, `#hex`, or an
 * `rgb()`, `hsl()`, `color-mix()`, `var()` (and similar) function with balanced brackets.
 * Anything else, such as a value with `;`, braces, quotes, angle brackets or `url(`, is
 * `undefined`, so one colour can never add a declaration or load a resource.
 */
export function chartSafeColor(color: unknown): string | undefined {
  if (typeof color !== "string") return undefined;
  const value = color.trim();
  if (!value || value.length > 200 || !SAFE_COLOR.test(value) || /url\s*\(/i.test(value)) return undefined;
  let depth = 0;
  for (const character of value) {
    if (character === "(") depth++;
    else if (character === ")" && --depth < 0) return undefined;
  }
  return depth === 0 ? value : undefined;
}

/**
 * The CSS colour of a period tone: `color` when given and safe (`chartSafeColor`), else
 * `--family-chart-period-{tone}` with its family default.
 */
export function chartPeriodColor(tone: ChartPeriodTone = "planned", color?: string): string {
  return chartSafeColor(color) || PERIOD_COLORS[tone] || PERIOD_COLORS.planned;
}

/**
 * What a period reads in the period line, aria text and description: "{lane.label} {period.label}"
 * (the tone stands in for a missing label). On a muted lane it is "{lane.label} {lane.mutedLabel}",
 * or without a muted label "{lane.label} {period.label} (paused)".
 */
export function chartPeriodText(
  lane: Pick<ChartLane, "label" | "muted" | "mutedLabel">,
  period: Pick<ChartPeriod, "label" | "tone">,
): string {
  const own = period.label || chartPeriodTone({}, period);
  const text = lane.muted ? lane.mutedLabel || `${own} (paused)` : own;
  return `${lane.label ?? ""} ${text}`.trim();
}

/**
 * Lane label as drawn: at most `CHART_LANE_LABEL_CHARS` characters, the last one an ellipsis when
 * cut. Counted in user-perceived characters, so an emoji or an accented letter is never split.
 */
export function chartLaneLabel(label: string): string {
  const characters = graphemes(String(label ?? ""));
  return characters.length > CHART_LANE_LABEL_CHARS
    ? `${characters.slice(0, CHART_LANE_LABEL_CHARS - 1).join("")}…`
    : characters.join("");
}

/** True for series drawn with interval semantics: step lines and bars (layout requires their intervalMs). */
const usesIntervals = (series: ChartSeries<any>): boolean => series.kind === "bar" || series.curve === "step";

/**
 * The point holding a value at `time`, if any: for step and bar series the interval that
 * contains it; for lines the nearest sample within maxGapMs/2 (else intervalMs/2, else any),
 * unless an explicit gap (`null`) is at least as close: that time has no value.
 * `points` are in time order and may include gaps.
 */
function pointNear<T>(
  series: ChartSeries<T>,
  points: ChartPoint<T>[],
  time: number,
  /** Reach of a line series that sets neither maxGapMs nor intervalMs (a chart with lanes passes its step spacing). */
  fallbackToleranceMs: number = Infinity,
): ChartPoint<T> | undefined {
  const finite = points.filter((point) => isValue(point.v));
  if (usesIntervals(series)) {
    const at = finite[indexAtTime(finite, time)];
    return at && time >= at.t && time < at.t + (series.intervalMs as number) ? at : undefined;
  }
  const at = finite[nearestIndex(finite, time)];
  const tolerance = series.maxGapMs !== undefined || series.intervalMs !== undefined
    ? (series.maxGapMs ?? series.intervalMs ?? Infinity) / 2
    : fallbackToleranceMs;
  if (!at || Math.abs(at.t - time) > tolerance) return undefined;
  const distance = Math.abs(at.t - time);
  return points.some((point) => !isValue(point.v) && Math.abs(point.t - time) <= distance) ? undefined : at;
}

export function defaultChartTimeLabel(hass: FormatHass | undefined): (t: number) => string {
  return (t) => formatHassDateTime(hass, t, { year: false });
}

function longestLabel(labels: string[]): number {
  return Math.max(0, ...labels.map((label) => estimateLabelWidth(label)));
}

/** More selectable times than this are never generated for the hours without data. */
const MAX_FILL_STEPS = 1500;

/**
 * Selectable interval starts across the whole domain for a chart with lanes: every point of
 * the interval series, and interval-sized slots over the time it has no point for. A gap is
 * filled on the grid of the point that follows it, the time after the last point on its own.
 */
function intervalSteps(points: { t: number }[], intervalMs: number, domain: ChartDomain): number[] {
  const steps: number[] = [];
  const push = (t: number): void => {
    if (!steps.length || t > steps[steps.length - 1]) steps.push(t);
  };
  const fill = (domain.end - domain.start) / intervalMs <= MAX_FILL_STEPS;
  let cursor = domain.start;
  for (const point of points) {
    if (fill && point.t > cursor) {
      for (let slots = Math.ceil((point.t - cursor) / intervalMs - 1e-9); slots >= 1; slots--) {
        push(Math.max(cursor, point.t - slots * intervalMs));
      }
    }
    push(point.t);
    cursor = Math.max(cursor, point.t + intervalMs);
  }
  if (fill) for (let t = cursor; t < domain.end; t += intervalMs) push(t);
  return steps;
}

/**
 * Selectable times across the whole domain for a line chart with lanes: its sample times,
 * steps at the samples' usual spacing where it has none, the domain ends and `extras`
 * (period boundaries and lane markers). `spacing` is that usual spacing.
 */
function timeSteps(points: { t: number }[], domain: ChartDomain, extras: number[]): { steps: number[]; spacing: number } {
  const span = domain.end - domain.start;
  const times = points.map((point) => point.t);
  const deltas = times.slice(1).map((t, index) => t - times[index]).filter((delta) => delta > 0).sort((a, b) => a - b);
  const spacing = Math.max(1, span / MAX_FILL_STEPS, deltas.length ? deltas[Math.floor(deltas.length / 2)] : span / 24);
  const set = new Set<number>(times);
  const forward = (from: number, to: number): void => {
    for (let t = from + spacing; t < to - spacing / 2; t += spacing) set.add(Math.round(t));
  };
  if (times.length) {
    for (let t = times[0] - spacing; t > domain.start + spacing / 2; t -= spacing) set.add(Math.round(t));
    times.slice(1).forEach((t, index) => {
      if (t - times[index] > spacing * 1.5) forward(times[index], t);
    });
    forward(times[times.length - 1], domain.end);
  } else {
    forward(domain.start, domain.end);
  }
  for (const t of [domain.start, domain.end, ...extras]) {
    if (Number.isFinite(t) && t >= domain.start && t <= domain.end) set.add(t);
  }
  return { steps: [...set].sort((a, b) => a - b), spacing };
}

/** Pure: all geometry for a given width/selection/now. Unit-tested without a DOM. */
export function layoutTimeSeriesChart<T>(
  options: TimeSeriesChartOptions<T>,
  state: { width: number; selectedT?: number; now: number },
): ChartModel<T> {
  const width = Math.max(MIN_WIDTH, Math.round(state.width) || 0);
  const height = chartHeight(options.height);
  const laneOptions = options.lanes ?? [];
  const totalHeight = chartTotalHeight(options.height, laneOptions.length);
  const lines = lineCount(options.lines ?? 5);
  const timeLabel = options.timeLabel ?? defaultChartTimeLabel(options.hass);
  for (const series of options.series) {
    // Without an interval a bar or step has no width: fail loudly instead of drawing 2px slivers.
    if (usesIntervals(series) && !((series.intervalMs ?? 0) > 0)) {
      throw new Error(`Chart "${options.id}": series "${series.id}" needs intervalMs for a ${series.kind === "bar" ? "bar" : "step"} series.`);
    }
  }
  const sorted = options.series.map((series) => ({
    series,
    points: [...series.points].filter((point) => Number.isFinite(point.t)).sort((a, b) => a.t - b.t),
  }));

  const firstT = Math.min(...sorted.map(({ points }) => (points.length ? points[0].t : Infinity)));
  const lastT = Math.max(
    ...sorted.map(({ series, points }) =>
      points.length ? points[points.length - 1].t + (usesIntervals(series) ? series.intervalMs ?? 0 : 0) : -Infinity,
    ),
  );
  // A lone sample gets half a gap (or 30 min) of room each side instead of an empty chart.
  const loneHalfSpan = Math.max(0, ...options.series.map((series) => series.maxGapMs ?? 0)) / 2 || 30 * MINUTE_MS;
  const domain: ChartDomain = options.domain
    ?? (lastT === firstT && Number.isFinite(firstT)
      ? { start: firstT - loneHalfSpan, end: lastT + loneHalfSpan }
      : { start: firstT, end: lastT });
  const inDomain = (series: ChartSeries<T>, point: ChartPoint<T>): boolean =>
    usesIntervals(series)
      ? point.t < domain.end && point.t + (series.intervalMs as number) > domain.start
      : point.t >= domain.start && point.t <= domain.end;
  const visible = sorted.map(({ series, points }) => ({
    series,
    points: points.filter((point) => inDomain(series, point)),
  }));
  const secondaryAxis = options.axes.secondary;
  const onSecondary = (series: ChartSeries<T>): boolean => !!secondaryAxis && series.axis === "secondary";
  const values = (secondary: boolean): number[] =>
    visible
      .filter(({ series }) => onSecondary(series) === secondary)
      .flatMap(({ points }) => points.map((point) => point.v).filter(isValue));
  const primaryValues = values(false);
  const secondaryValues = values(true);
  const empty = !(domain.end > domain.start) || (!primaryValues.length && !secondaryValues.length);

  const primaryDomain = niceDomain(primaryValues, { ...options.axes.primary, lines });
  const secondaryDomain = secondaryAxis && secondaryValues.length
    ? niceDomain(secondaryValues, { ...secondaryAxis, lines })
    : undefined;
  // A primary axis without data next to a secondary one with data (printer: power unavailable,
  // current present) gets no labels: invented 0…1 values would read as data. Both domains
  // have `lines` evenly spaced ticks over the same plot, so the gridlines do not move.
  const primaryLabelled = primaryValues.length > 0 || !secondaryDomain;
  const primaryTexts = primaryLabelled
    ? primaryDomain.ticks.map((value) => options.axes.primary.format(value, primaryDomain))
    : [];
  const secondaryTexts = secondaryDomain && secondaryAxis
    ? secondaryDomain.ticks.map((value) => secondaryAxis.format(value, secondaryDomain))
    : undefined;
  const axisWidth = (labels: string[]) =>
    Math.max(CHART_MARGIN.minAxis, longestLabel(labels) + CHART_AXIS_GAP_PX);
  // Lane labels share the right gutter with the primary axis labels: it fits the longest of
  // both, and exists for the lane labels alone when the primary axis shows none.
  // Lane labels are sized by character class: capitals, CJK and emoji are wider than the
  // axis labels' digits, and a clipped car name is worse than a slightly wider gutter.
  const laneTexts = laneOptions.map((lane) => chartLaneLabel(lane.label));
  const laneGutter = laneTexts.some(Boolean)
    ? Math.max(CHART_MARGIN.minAxis, Math.max(...laneTexts.map((text) => estimateTextWidth(text))) + CHART_AXIS_GAP_PX)
    : 0;
  const rightGutter = Math.max(primaryLabelled ? axisWidth(primaryTexts) : CHART_MARGIN.edge, laneGutter);
  const plot = {
    left: secondaryTexts ? axisWidth(secondaryTexts) : CHART_MARGIN.edge,
    right: width - (empty ? CHART_MARGIN.minAxis : rightGutter),
    top: CHART_MARGIN.top,
    bottom: height - CHART_MARGIN.bottom,
  };
  const x = linearScale(
    domain.end > domain.start ? [domain.start, domain.end] : [0, 1],
    [plot.left, Math.max(plot.left + 1, plot.right)],
  );
  const yPrimary = linearScale([primaryDomain.min, primaryDomain.max], [plot.bottom, plot.top]);
  const ySecondary = secondaryDomain
    ? linearScale([secondaryDomain.min, secondaryDomain.max], [plot.bottom, plot.top])
    : undefined;
  const xPercent = (t: number): number => (x(t) / width) * 100;
  const base = {
    width,
    height,
    totalHeight,
    plot,
    x,
    y: { primary: yPrimary, secondary: ySecondary },
    xPercent,
  };
  if (empty) {
    return {
      ...base,
      empty: true,
      gridY: [],
      axisLabels: { primary: [] },
      ticks: [],
      series: [],
      extremes: [],
      lanes: [],
      bands: [],
      markers: [],
      selectable: [],
      intervalSelection: false,
      hasGaps: false,
    };
  }

  const gridY = primaryLabelled || !secondaryDomain || !ySecondary
    ? primaryDomain.ticks.map((value) => yPrimary(value))
    : secondaryDomain.ticks.map((value) => ySecondary(value));
  const axisLabels: ChartModel<T>["axisLabels"] = {
    primary: primaryLabelled
      ? primaryDomain.ticks.map((value, index) => ({ y: yPrimary(value), text: primaryTexts[index] }))
      : [],
    secondary: secondaryDomain && ySecondary && secondaryTexts
      ? secondaryDomain.ticks.map((value, index) => ({ y: ySecondary(value), text: secondaryTexts[index] }))
      : undefined,
  };
  const tickTimes = timeTicks(domain, plot.right - plot.left, timeLabel, { stepsMs: options.tickStepsMs });
  const ticks = tickTimes.map((t, index) => ({
    t,
    x: x(t),
    text: timeLabel(t),
    anchor: (index === 0
      ? "start"
      : index === tickTimes.length - 1 && Math.abs(domain.end - t) < 1
        ? "end"
        : "middle") as "start" | "middle" | "end",
  }));

  const yFor = (series: ChartSeries<T>): LinearScale => (onSecondary(series) && ySecondary ? ySecondary : yPrimary);
  /** Marks stay inside the plot: a value beyond an explicit min/max is pinned to the edge, never drawn over the head. */
  const plotY = (scale: LinearScale, value: number): number => clamp(scale(value), plot.top, plot.bottom);
  const intervalEnd = (series: ChartSeries<T>, point: ChartPoint<T>): number =>
    Math.min(point.t + (series.intervalMs as number), domain.end);
  /** Interval centre for step/bar, the point itself for lines. */
  const anchorX = (series: ChartSeries<T>, point: ChartPoint<T>): number =>
    usesIntervals(series)
      ? x((Math.max(point.t, domain.start) + intervalEnd(series, point)) / 2)
      : x(point.t);

  let hasGaps = false;
  const extremeMarks: ChartModel<T>["extremes"] = [];
  const laidOut = visible.map(({ series, points }) => {
    const y = yFor(series);
    const intervals = usesIntervals(series);
    const segments = segmentPoints(points, {
      intervalMs: intervals ? series.intervalMs : undefined,
      maxGapMs: series.maxGapMs,
    });
    if (segments.length > 1 || points.some((point) => !isValue(point.v))) hasGaps = true;
    const finite = segments.flat();
    const entry: ChartModel<T>["series"][number] = { series, segments: [] };
    const x0 = (point: ChartPoint<T>) => x(Math.max(point.t, domain.start));

    if (series.kind === "bar") {
      const zeroY = y(clamp(0, y.domain[0], y.domain[1]));
      const fill = chartSeriesColor(series);
      entry.bars = finite.map((point) => ({
        ...barRect(x0(point), x(intervalEnd(series, point)), plotY(y, point.v as number), zeroY, series.barFit),
        point,
        fill: series.colorAt?.(point) || fill,
      }));
    } else {
      const showArea = series.area ?? (series.emphasis !== "secondary");
      entry.segments = segments.map((segment) => {
        const coords = segment.map((point) => ({
          x: x0(point),
          y: plotY(y, point.v as number),
          x1: intervals ? x(intervalEnd(series, point)) : x0(point),
        }));
        const line = intervals
          ? stepPath(coords)
          : series.curve === "smooth"
            ? smoothPath(coords)
            : linePath(coords);
        const lastX = intervals ? coords[coords.length - 1].x1 : coords[coords.length - 1].x;
        return showArea ? { line, area: areaPath(line, coords[0].x, lastX, plot.bottom) } : { line };
      });
      if (series.colorAt) {
        const blend = series.colorBlend ?? (intervals ? "hard" : "smooth");
        const span = Math.max(1, plot.right - plot.left);
        const offset = (px: number) => clamp((px - plot.left) / span, 0, 1);
        entry.stops = finite.flatMap((point, index) => {
          const color = series.colorAt?.(point) as string;
          if (blend === "smooth") return [{ offset: offset(x(point.t)), color }];
          const next = finite[index + 1];
          const end = intervals ? x(intervalEnd(series, point)) : next ? x(next.t) : x0(point);
          return [
            { offset: offset(x0(point)), color },
            { offset: offset(end), color },
          ];
        });
      }
    }
    if (series.extremes) {
      const { min, max } = extremes(finite);
      if (min && max && (min.v as number) < (max.v as number)) {
        for (const [point, text] of [[max, "H"], [min, "L"]] as const) {
          const valueY = plotY(y, point.v as number);
          // A negative bar hangs below zero, so its mark goes under the bar end instead of over the bar.
          const below = series.kind === "bar" && valueY > y(0);
          extremeMarks.push({
            x: anchorX(series, point),
            y: below ? Math.min(valueY + 9, plot.bottom + 9) : Math.max(11, valueY - 9),
            text,
          });
        }
      }
    }
    return entry;
  });

  // Periods, bands and markers ride on the plot's time scale; they never widen the domain.
  const plotWidth = Math.max(0, plot.right - plot.left);
  const lanes: ChartModel<T>["lanes"] = laneOptions.map((lane, row) => {
    const y = height + CHART_LANES_GAP_PX + row * CHART_LANE_PX;
    const track = { x: plot.left, y: y + (CHART_LANE_PX - CHART_LANE_TRACK_PX) / 2, width: plotWidth, height: CHART_LANE_TRACK_PX };
    const periods = (lane.periods ?? []).flatMap((period) => {
      const start = Math.max(period.start, domain.start);
      const end = Math.min(period.end, domain.end);
      if (!(end > start)) return [];
      const periodWidth = Math.min(plotWidth, Math.max(CHART_PERIOD_MIN_PX, x(end) - x(start)));
      // The minimum width must not push a period at the end of the window past the track.
      return [{ period, tone: chartPeriodTone(lane, period), x: clamp(x(start), plot.left, plot.left + plotWidth - periodWidth), width: periodWidth }];
    });
    const markerT = lane.marker?.t;
    // The longest axis label starts at the same x: lane labels line up with the axis column.
    const labelX = plot.right + CHART_AXIS_GAP_PX - 2;
    return {
      lane,
      y,
      track,
      label: { x: labelX, y: y + CHART_LANE_PX / 2, text: laneTexts[row], room: Math.max(0, width - labelX) },
      periods,
      marker: isValue(markerT) && markerT >= domain.start && markerT <= domain.end ? { x: x(markerT) } : undefined,
    };
  });
  const bands: ChartModel<T>["bands"] = (options.bands ?? []).flatMap((band) => {
    const start = Math.max(band.start, domain.start);
    const end = Math.min(band.end, domain.end);
    if (!(end > start)) return [];
    const bandX = x(start);
    const bandWidth = Math.max(0, Math.min(x(end), plot.left + plotWidth) - bandX);
    // The expected width, not the reserve: a label that fits a phone-width band should show.
    const fits = !!band.label && bandWidth >= estimateTextWidth(band.label, "typical") + CHART_LABEL_GAP_PX;
    return [{
      band,
      x: bandX,
      width: bandWidth,
      label: fits ? { x: bandX + CHART_LABEL_GAP_PX / 2, y: plot.top + 8, text: band.label as string } : undefined,
    }];
  });
  // Marker labels sit in the top margin, clear of the bars and of a band label. They are placed
  // in time order, each on the side away from the nearer plot edge; a label that would leave
  // the plot (the gutters hold the top axis labels at almost the same height) or come within
  // 8 px of an earlier one tries the other side and is dropped otherwise.
  const placedLabels: [number, number][] = [];
  const markers: ChartModel<T>["markers"] = (options.markers ?? [])
    .map((marker, order) => ({ marker, order }))
    .filter(({ marker }) => isValue(marker.t) && marker.t >= domain.start && marker.t <= domain.end)
    .sort((a, b) => a.marker.t - b.marker.t || a.order - b.order)
    .map(({ marker, order }) => {
      const markerX = x(marker.t);
      let label: ChartModel<T>["markers"][number]["label"];
      if (marker.label) {
        const labelWidth = estimateTextWidth(marker.label);
        const preferred: "start" | "end" = markerX - plot.left <= plot.right - markerX ? "start" : "end";
        for (const anchor of [preferred, preferred === "start" ? "end" : "start"] as const) {
          const from = anchor === "start" ? markerX + 4 : markerX - 4 - labelWidth;
          const to = from + labelWidth;
          const free = placedLabels.every(([left, right]) => to + CHART_LABEL_GAP_PX <= left || from >= right + CHART_LABEL_GAP_PX);
          if (from >= plot.left && to <= plot.right && free) {
            placedLabels.push([from, to]);
            label = { x: anchor === "start" ? from : to, y: CHART_MARGIN.top - 7, text: marker.label, anchor };
            break;
          }
        }
      }
      return { order, entry: { marker, x: markerX, label } };
    })
    // Back in the caller's order: it is the draw order.
    .sort((a, b) => a.order - b.order)
    .map(({ entry }) => entry);

  // The slider walks the first primary-axis series with data; any series with data is the fallback.
  const selectableEntry = visible.find(
    ({ series, points }) => !onSecondary(series) && points.some((point) => isValue(point.v)),
  ) ?? visible.find(({ points }) => points.some((point) => isValue(point.v)));
  const selectableSeries = selectableEntry?.series as ChartSeries<T>;
  const selectable = (selectableEntry?.points ?? []).filter((point) => isValue(point.v));
  const intervalSelection = usesIntervals(selectableSeries);
  const followsNow = !isValue(state.selectedT);
  const now = state.now;
  let index: number;
  let selectionT: number;
  let selectionX: number;
  let selectedPoint: ChartPoint<T> | undefined;
  /** The times the other series are read at: intervals by the interval that contains it, lines by the sample near it. */
  let intervalT: number;
  let lineT: number;
  /** Reach of a line series without maxGapMs or intervalMs; unlimited as in 1.7.0 unless the chart has lanes. */
  let lineReach = Infinity;
  /** Chart with lanes: selectable times across the whole domain, and the time range the selection stands for. */
  let steps: number[] | undefined;
  let range: { start: number; end: number } | undefined;
  let outsideWindow = false;
  if (!laneOptions.length) {
    /** False when a synced chart picked a time this chart has no value for. */
    let matched = true;
    if (!followsNow) {
      const selectedT = state.selectedT as number;
      index = intervalSelection ? indexAtTime(selectable, selectedT) : nearestIndex(selectable, selectedT);
      if (pointNear(selectableSeries, selectableEntry?.points ?? [], selectedT) === selectable[index]) {
        selectionT = selectable[index].t;
        selectionX = anchorX(selectableSeries, selectable[index]);
      } else {
        // Another chart in the selection group picked a time without a value here: the cursor
        // stays on that time and shows no value instead of claiming a different hour.
        matched = false;
        selectionT = selectedT;
        selectionX = x(clamp(selectedT, domain.start, domain.end));
      }
    } else if (now < domain.start || now > domain.end) {
      // Outside the window, the nearest end of the data stands in for now.
      index = now < domain.start ? 0 : selectable.length - 1;
      selectionT = selectable[index].t;
      selectionX = anchorX(selectableSeries, selectable[index]);
    } else if (intervalSelection) {
      index = indexAtTime(selectable, now);
      const point = selectable[index];
      const containsNow = now >= point.t && now < point.t + (selectableSeries.intervalMs as number);
      selectionT = containsNow ? now : point.t;
      selectionX = containsNow ? x(now) : anchorX(selectableSeries, point);
    } else {
      index = nearestIndex(selectable, now);
      selectionT = selectable[index].t;
      selectionX = x(selectionT);
    }
    selectedPoint = matched ? selectable[index] : undefined;
    intervalT = selectionT;
    lineT = selectedPoint?.t ?? selectionT;
  } else {
    // With lanes the plan usually runs past the data (tomorrow's prices are not published yet),
    // so the selection is a time anywhere in the domain, not a series point: the cursor can
    // stand on an hour without a value, which then reads "–" beside the lanes' periods.
    const selectablePoints = selectableEntry?.points ?? [];
    const target = followsNow ? now : (state.selectedT as number);
    const intervalMs = selectableSeries.intervalMs as number;
    if (intervalSelection) {
      steps = intervalSteps(selectable, intervalMs, domain);
      lineReach = intervalMs / 2;
    } else {
      const built = timeSteps(
        selectable,
        domain,
        lanes.flatMap(({ lane, periods }) => [
          ...periods.flatMap(({ period }) => [Math.max(period.start, domain.start), Math.min(period.end, domain.end)]),
          ...(isValue(lane.marker?.t) ? [lane.marker?.t as number] : []),
        ]),
      );
      steps = built.steps;
      lineReach = built.spacing / 2;
    }
    const last = steps.length - 1;
    // A first interval that began before the window is still inside it.
    const outside = target < Math.min(domain.start, steps[0])
      || (intervalSelection ? target >= domain.end : target > domain.end);
    if (!followsNow && outside) {
      // A time picked in a wider chart of the selection group: as in 1.7.0 the cursor stops at the edge and reads nothing.
      index = target < domain.start ? 0 : last;
      selectionT = target;
      selectionX = x(clamp(target, domain.start, domain.end));
      intervalT = lineT = target;
      range = { start: target, end: target };
      outsideWindow = true;
    } else if (intervalSelection) {
      index = target < steps[0] ? 0 : outside ? last : indexAtTime(steps.map((t) => ({ t })), target);
      const start = steps[index];
      const end = Math.min(start + intervalMs, steps[index + 1] ?? Infinity, domain.end);
      // Following now inside the window reads the exact now; a picked interval reads as a whole.
      const exact = followsNow && !outside;
      selectionT = exact ? now : start;
      selectionX = exact ? x(now) : x((Math.max(start, domain.start) + end) / 2);
      intervalT = selectionT;
      lineT = start;
      range = exact ? { start: now, end: now } : { start, end };
      selectedPoint = pointNear(selectableSeries, selectablePoints, intervalT);
    } else {
      index = nearestIndex(steps.map((t) => ({ t })), clamp(target, domain.start, domain.end));
      selectionT = steps[index];
      selectionX = x(selectionT);
      intervalT = lineT = selectionT;
      range = { start: selectionT, end: selectionT };
      selectedPoint = pointNear(selectableSeries, selectablePoints, selectionT, lineReach);
    }
  }

  /** The period a lane shows for the selection: see `ChartSelection.periods`. Later periods win ties, as they are drawn on top. */
  const periodAt = (periods: ChartModel<T>["lanes"][number]["periods"]): ChartPeriod | undefined => {
    if (!range || outsideWindow) return undefined;
    let best: ChartPeriod | undefined;
    let bestOverlap = 0;
    for (const { period } of periods) {
      const overlap = range.end > range.start
        ? Math.min(period.end, range.end) - Math.max(period.start, range.start)
        : range.start >= period.start && range.start < period.end ? 1 : 0;
      if (overlap > 0 && overlap >= bestOverlap) {
        best = period;
        bestOverlap = overlap;
      }
    }
    return best;
  };
  const selection: ChartSelection<T> = {
    t: selectionT,
    x: selectionX,
    index,
    followsNow,
    values: visible.map(({ series, points }) => {
      let point: ChartPoint<T> | undefined;
      if (series === selectableSeries) point = selectedPoint;
      else {
        // Lines match the selected sample; intervals the interval that contains the selected time.
        point = pointNear(series, points, usesIntervals(series) ? intervalT : lineT, lineReach);
      }
      return point ? { series, point, y: plotY(yFor(series), point.v as number) } : { series };
    }),
    periods: lanes.map(({ lane, periods }) => ({ lane, period: periodAt(periods) })),
    ...(range ? { range } : {}),
  };

  const nowX = x(now);
  const showNow = options.nowMarker !== false
    && now >= domain.start && now <= domain.end
    && nowX >= plot.left && nowX <= plot.right;

  return {
    ...base,
    empty: false,
    gridY,
    axisLabels,
    ticks,
    series: laidOut,
    now: showNow ? { x: nowX } : undefined,
    extremes: extremeMarks,
    lanes,
    bands,
    markers,
    selection,
    selectable,
    selectableSeries,
    intervalSelection,
    hasGaps,
    ...(steps ? { steps } : {}),
  };
}

/**
 * Colours of an electricity price series, shared by every card that draws prices: an interval
 * is past, current or still to come, and each of those is green when its price is at or below
 * the cheap limit. Use as `colorAt: (point) => electricityPriceColor({ start: point.t, end:
 * point.t + HOUR, value: point.v, now, cheap })`. `colors` overrides single entries.
 */
export const ELECTRICITY_PRICE_COLORS = {
  future: "#93c5fd",
  current: "#3b82f6",
  past: "#bfdbfe",
  cheap: "#86efac",
  cheapCurrent: "#22c55e",
  cheapPast: "#bbf7d0",
} as const;
export type ElectricityPriceColors = { [key in keyof typeof ELECTRICITY_PRICE_COLORS]: string };

export function electricityPriceColor(options: {
  start: number;
  end: number;
  now: number;
  value: number | null | undefined;
  /** Prices at or below this are cheap; omit when there is no limit. */
  cheap?: number | null;
  colors?: Partial<ElectricityPriceColors>;
}): string {
  const colors = { ...ELECTRICITY_PRICE_COLORS, ...(options.colors || {}) };
  const isCheap = isValue(options.cheap) && isValue(options.value) && (options.value as number) <= (options.cheap as number);
  if (options.now >= options.start && options.now < options.end) return isCheap ? colors.cheapCurrent : colors.current;
  if (options.end <= options.now) return isCheap ? colors.cheapPast : colors.past;
  return isCheap ? colors.cheap : colors.future;
}
