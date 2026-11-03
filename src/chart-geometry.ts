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

/** A bar centred in its interval slot, growing up or down from `zeroY`. */
export function barRect(
  x0: number,
  x1: number,
  y: number,
  zeroY: number,
): { x: number; y: number; width: number; height: number } {
  const slot = Math.max(0, x1 - x0);
  const width = clamp(slot * 0.9, 2, 14);
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
}

export interface ChartSelection<T = unknown> {
  t: number;
  x: number;
  /** Index into `model.selectable` (the nearest one when the selected time has no value here). */
  index: number;
  followsNow: boolean;
  /**
   * One entry per series; no `point` means no value at `t`. A time picked in another chart of
   * the selection group keeps `t` and leaves every value empty here when no point is within
   * tolerance (the containing interval, else maxGapMs/2 or intervalMs/2).
   */
  values: { series: ChartSeries<T>; point?: ChartPoint<T>; y?: number }[];
}

export interface ChartModel<T = unknown> {
  empty: boolean;
  width: number;
  height: number;
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
  selection?: ChartSelection<T>;
  /** Index space for slider/keyboard (primary series, finite values). */
  selectable: ChartPoint<T>[];
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

/** True for series drawn with interval semantics: step lines and bars (layout requires their intervalMs). */
const usesIntervals = (series: ChartSeries<any>): boolean => series.kind === "bar" || series.curve === "step";

/**
 * The point holding a value at `time`, if any: for step and bar series the interval that
 * contains it; for lines the nearest sample within maxGapMs/2 (else intervalMs/2, else any),
 * unless an explicit gap (`null`) is at least as close: that time has no value.
 * `points` are in time order and may include gaps.
 */
function pointNear<T>(series: ChartSeries<T>, points: ChartPoint<T>[], time: number): ChartPoint<T> | undefined {
  const finite = points.filter((point) => isValue(point.v));
  if (usesIntervals(series)) {
    const at = finite[indexAtTime(finite, time)];
    return at && time >= at.t && time < at.t + (series.intervalMs as number) ? at : undefined;
  }
  const at = finite[nearestIndex(finite, time)];
  const tolerance = (series.maxGapMs ?? series.intervalMs ?? Infinity) / 2;
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

/** Pure: all geometry for a given width/selection/now. Unit-tested without a DOM. */
export function layoutTimeSeriesChart<T>(
  options: TimeSeriesChartOptions<T>,
  state: { width: number; selectedT?: number; now: number },
): ChartModel<T> {
  const width = Math.max(MIN_WIDTH, Math.round(state.width) || 0);
  const height = chartHeight(options.height);
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
  const plot = {
    left: secondaryTexts ? axisWidth(secondaryTexts) : CHART_MARGIN.edge,
    right: width - (empty ? CHART_MARGIN.minAxis : primaryLabelled ? axisWidth(primaryTexts) : CHART_MARGIN.edge),
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
        ...barRect(x0(point), x(intervalEnd(series, point)), plotY(y, point.v as number), zeroY),
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
  const selectedPoint = matched ? selectable[index] : undefined;
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
        point = pointNear(series, points, usesIntervals(series) ? selectionT : selectedPoint?.t ?? selectionT);
      }
      return point ? { series, point, y: plotY(yFor(series), point.v as number) } : { series };
    }),
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
    selection,
    selectable,
    selectableSeries,
    intervalSelection,
    hasGaps,
  };
}
