import assert from "node:assert/strict";
import { test } from "node:test";
// Pure geometry: no DOM, no Lit. Importing the module directly proves it.
const {
  CHART_LABEL_CHAR_PX,
  CHART_LABEL_GAP_PX,
  CHART_AXIS_GAP_PX,
  CHART_MARGIN,
  CHART_FRAME_CHROME_PX,
  CHART_LANE_PX,
  CHART_LANES_GAP_PX,
  CHART_LANE_TRACK_PX,
  CHART_PERIOD_MIN_PX,
  CHART_LANE_LABEL_CHARS,
  CHART_PERIOD_ACTIVE_PX,
  CHART_PERIOD_LINE_PX,
  DEFAULT_TICK_STEPS_MS,
  chartHeight,
  chartTotalHeight,
  chartPeriodTone,
  chartPeriodColor,
  chartPeriodText,
  chartSafeColor,
  chartLaneLabel,
  estimateTextWidth,
  linearScale,
  niceStep,
  stepDecimals,
  niceDomain,
  estimateLabelWidth,
  timeTicks,
  segmentPoints,
  linePath,
  smoothPath,
  stepPath,
  areaPath,
  barRect,
  extremes,
  indexAtTime,
  nearestIndex,
  keyboardIndex,
  sampleAndHold,
  safeId,
  chartDefId,
  layoutTimeSeriesChart,
  ELECTRICITY_PRICE_COLORS,
  electricityPriceColor,
} = await import("../dist/chart-geometry.js");
const { formatHassDateTime, formatHassNumber } = await import("../dist/format.js");

const HOUR = 3_600_000;
const MIDNIGHT = Date.UTC(2026, 10, 3);
const GB = { locale: { language: "en-GB", time_format: "24" }, config: { time_zone: "UTC" } };
const US12 = { locale: { language: "en", time_format: "12" }, config: { time_zone: "UTC" } };
const t = (iso) => new Date(iso).getTime();

test("constants match the visual standard", () => {
  assert.equal(CHART_LABEL_CHAR_PX, 5.8);
  assert.equal(CHART_LABEL_GAP_PX, 8);
  assert.equal(CHART_AXIS_GAP_PX, 12, "axis labels clear the selection halo at the plot edge");
  assert.deepEqual({ ...CHART_MARGIN }, { top: 15, bottom: 24, edge: 8, minAxis: 36 });
  assert.equal(CHART_FRAME_CHROME_PX, 36);
  assert.equal(DEFAULT_TICK_STEPS_MS[0], 15 * 60_000);
  assert.equal(DEFAULT_TICK_STEPS_MS.at(-1), 7 * 24 * HOUR);
  assert.equal(estimateLabelWidth("3 Nov, 0:00"), 11 * 5.8);
});

test("linearScale maps and inverts; a zero-span domain maps to mid-range", () => {
  const scale = linearScale([0, 10], [100, 0]);
  assert.equal(scale(0), 100);
  assert.equal(scale(2.5), 75);
  assert.equal(scale.invert(75), 2.5);
  assert.deepEqual(scale.domain, [0, 10]);
  assert.deepEqual(scale.range, [100, 0]);
  const flat = linearScale([5, 5], [0, 40]);
  assert.equal(flat(5), 20);
  assert.equal(flat(99), 20);
});

test("niceStep uses readable 1, 2, 2.5, 3, 4, 5, 6, 8 × 10^n steps", () => {
  assert.equal(niceStep(81.1), 100);
  assert.equal(niceStep(0.065), 0.08);
  assert.equal(niceStep(0.24), 0.25);
  assert.equal(niceStep(0.354), 0.4);
  assert.equal(niceStep(3), 3);
  assert.equal(niceStep(1.5, { integer: true }), 2);
  assert.equal(niceStep(2.2, { integer: true }), 3, "2.5 is skipped for integer axes");
  assert.equal(niceStep(0.3, { integer: true }), 1);
  assert.equal(niceStep(22, { integer: true }), 25, "25 is still an integer step");
  assert.equal(stepDecimals(0.25), 2);
  assert.equal(stepDecimals(0.08), 2);
  assert.equal(stepDecimals(0.5), 1);
  assert.equal(stepDecimals(2.5), 1);
  assert.equal(stepDecimals(100), 0);
  // Tiny steps are not mistaken for integers; non-terminating explicit splits stop at three significant digits.
  assert.equal(stepDecimals(1e-7), 7);
  assert.equal(stepDecimals(5e-7), 7);
  assert.equal(stepDecimals(0.25 / 3), 4, "0.0833");
  assert.equal(stepDecimals(niceDomain([0.1], { lines: 4, min: 0, max: 0.5 }).step), 3, "0…0.5 in thirds reads 0.167, not 0.1666667");
  assert.equal(stepDecimals(10 / 3), 2);
  assert.equal(stepDecimals(500 / 3), 0);
});

test("niceDomain worked vectors", () => {
  // Printer power, peak 312, includeZero, minSpan 100 -> 0…400, step 100.
  assert.deepEqual(niceDomain([0, 120, 312], { lines: 5, includeZero: true, minSpan: 100 }), {
    min: 0, max: 400, step: 100, ticks: [0, 100, 200, 300, 400],
  });
  // Current, peak 1.36. The design note says 0…2/0.5, but its own rule (smallest readable
  // step, 4 included) gives 0…1.6/0.4: 1.36 × 1.04 = 1.41 <= 4 × 0.4.
  assert.deepEqual(niceDomain([0, 0.4, 1.36], { lines: 5, includeZero: true, minSpan: 1 }), {
    min: 0, max: 1.6, step: 0.4, ticks: [0, 0.4, 0.8, 1.2, 1.6],
  });
  // Weather 8–14 °C, pad 0, integer -> 8…16, step 2.
  assert.deepEqual(niceDomain([8, 11, 14], { lines: 5, pad: 0, integer: true, minSpan: 1 }), {
    min: 8, max: 16, step: 2, ticks: [8, 10, 12, 14, 16],
  });
  // Precipitation, explicit 0/100 -> 0, 25, 50, 75, 100.
  assert.deepEqual(niceDomain([10, 40], { lines: 5, min: 0, max: 100 }).ticks, [0, 25, 50, 75, 100]);
  // Electricity 0.02–0.25 with zero -> 0…0.32, step 0.08.
  assert.deepEqual(niceDomain([0.02, 0.1, 0.25], { lines: 5, includeZero: true }), {
    min: 0, max: 0.32, step: 0.08, ticks: [0, 0.08, 0.16, 0.24, 0.32],
  });
});

test("niceDomain: explicit bounds, negative minimum, flat series and line counts", () => {
  assert.deepEqual(niceDomain([0.1, 0.3], { lines: 3, min: -0.1, max: 0.5 }).ticks, [-0.1, 0.2, 0.5], "explicit min/max split evenly, no nicing");
  assert.deepEqual(niceDomain([0.1, 0.3], { lines: 5, min: 0 }).ticks, [0, 0.08, 0.16, 0.24, 0.32]);
  const negative = niceDomain([-0.05, 0.1, 0.3], { lines: 5, includeZero: true });
  assert.ok(negative.min <= -0.05 && negative.max >= 0.3);
  assert.ok(negative.ticks.includes(0), "zero is a gridline when the axis crosses it");
  assert.ok(negative.ticks.every((value) => Number.isFinite(value)));
  const flat = niceDomain([5, 5, 5], { lines: 5 });
  assert.ok(flat.min < 5 && flat.max > 5 && flat.step > 0);
  assert.deepEqual(niceDomain([0, 0], { lines: 5, includeZero: true, minSpan: 100 }).ticks, [0, 25, 50, 75, 100], "an idle printer keeps a readable 0–100 W axis");
  assert.deepEqual(niceDomain([0, 7], { lines: 2 }).ticks, [0, 8]);
  const nine = niceDomain([0, 7], { lines: 9 });
  assert.equal(nine.ticks.length, 9);
  assert.equal(nine.step, 1);
  assert.equal(niceDomain([1, 2], { lines: 1 }).ticks.length, 2, "lines are clamped to 2..9");
  assert.equal(niceDomain([1, 2], { lines: 40 }).ticks.length, 9);
  assert.equal(niceDomain([], { lines: 5 }).ticks.length, 5);
});

test("niceDomain: one explicit bound keeps zero on the axis instead of crossing it", () => {
  // Electricity `max: 0.3` with positive prices: the old card split 0…max evenly.
  assert.deepEqual(niceDomain([0.02, 0.25], { lines: 5, includeZero: true, max: 0.3 }).ticks, [0, 0.075, 0.15, 0.225, 0.3]);
  assert.deepEqual(niceDomain([0.4, 14], { lines: 5, max: 21 }).ticks, [0, 5.25, 10.5, 15.75, 21], "non-negative data never gets a negative floor");
  assert.deepEqual(niceDomain([0, 0.25], { lines: 5, includeZero: true, max: 0.32 }).ticks, [0, 0.08, 0.16, 0.24, 0.32], "a nice step that fits is kept");
  assert.deepEqual(niceDomain([2, 14], { lines: 5, max: 21 }).ticks, [1, 6, 11, 16, 21], "away from zero the steps stay nice");
  // The mirror image: only `min`, all values at or below zero.
  assert.deepEqual(niceDomain([-0.25, -0.02], { lines: 5, includeZero: true, min: -0.3 }).ticks, [-0.3, -0.225, -0.15, -0.075, 0]);
  assert.deepEqual(niceDomain([-10, -2], { lines: 5, includeZero: true, min: -10 }).ticks, [-10, -7.5, -5, -2.5, 0]);
});

test("niceDomain: headroom never doubles the step when the unpadded data fits", () => {
  // Padded −0.064…0.314 misses −0.1…0.3 by a hair; the unpadded data fits at the same step.
  assert.deepEqual(niceDomain([-0.05, 0.3], { lines: 5, includeZero: true }), {
    min: -0.1, max: 0.3, step: 0.1, ticks: [-0.1, 0, 0.1, 0.2, 0.3],
  });
  assert.deepEqual(niceDomain([-0.05, 0.1, 0.3], { lines: 5, includeZero: true }).ticks, [-0.1, 0, 0.1, 0.2, 0.3]);
  // Where the padded fit works, headroom stays (worked vectors above are unchanged).
  assert.deepEqual(niceDomain([0, 312], { lines: 5, includeZero: true, minSpan: 100 }).ticks, [0, 100, 200, 300, 400]);
});

test("niceDomain: headroom gives way to a smaller step when it would leave over a quarter of the axis empty", () => {
  // Padded −0.116…0.316 needs step 0.2 (−0.2…0.6, half empty); the data itself fits by 0.1.
  assert.deepEqual(niceDomain([-0.1, 0.3], { lines: 5 }), {
    min: -0.1, max: 0.3, step: 0.1, ticks: [-0.1, 0, 0.1, 0.2, 0.3],
  });
  assert.deepEqual(niceDomain([-0.1, 0.05, 0.3], { lines: 5, includeZero: true }).ticks, [-0.1, 0, 0.1, 0.2, 0.3], "the electricity −0.10…0.30 € day");
  assert.deepEqual(niceDomain([0, 40], { lines: 5, includeZero: true }).ticks, [0, 10, 20, 30, 40]);
  // The same with one bound: zero stays a gridline instead of −0.1, 0.02, 0.14, 0.26, 0.38.
  assert.deepEqual(niceDomain([-0.05, 0.3], { lines: 5, min: -0.1 }), {
    min: -0.1, max: 0.3, step: 0.1, ticks: [-0.1, 0, 0.1, 0.2, 0.3],
  });
  // 0…400 leaves 22 % above 312: headroom stays (0…320 by 80 would touch the top line).
  assert.deepEqual(niceDomain([0, 312], { lines: 5, includeZero: true }).ticks, [0, 100, 200, 300, 400]);
});

test("niceDomain: one explicit bound splits evenly to the data instead of leaving the axis mostly empty", () => {
  // Nice 0…80 by 20 would leave half the axis above 40 empty: the unpadded data fits by 10.
  assert.deepEqual(niceDomain([10, 40], { lines: 5, min: 0 }), { min: 0, max: 40, step: 10, ticks: [0, 10, 20, 30, 40] });
  // At 4 lines no nice step does (0…60 by 20): a finer readable step runs just past the data.
  assert.deepEqual(niceDomain([10, 40], { lines: 4, min: 0 }).ticks, [0, 15, 30, 45]);
  assert.deepEqual(niceDomain([30, 450], { lines: 5, min: 0 }).ticks, [0, 120, 240, 360, 480]);
  // Nice 2…10 by 2 for data 6…9: the unpadded data fits from the bound by 1.
  assert.deepEqual(niceDomain([6, 9], { lines: 5, max: 10 }).ticks, [6, 7, 8, 9, 10]);
  assert.deepEqual(niceDomain([-9, -6], { lines: 5, min: -10 }).ticks, [-10, -9, -8, -7, -6]);
  // An integer axis keeps whole steps.
  assert.deepEqual(niceDomain([90, 95], { lines: 5, max: 100, integer: true }).ticks, [88, 91, 94, 97, 100]);
  assert.deepEqual(niceDomain([6, 9], { lines: 5, max: 10, integer: true }).ticks, [6, 7, 8, 9, 10], "the unpadded whole step fits");
  for (const [values, options] of [[[10, 40], { min: 0 }], [[6, 9], { max: 10 }], [[3, 120], { min: 0 }], [[-120, -3], { max: 0 }]]) {
    for (let lines = 3; lines <= 9; lines++) {
      if (lines === 4 && options.max === 10) continue; // see the decimals test below
      const domain = niceDomain(values, { ...options, lines });
      const free = options.max !== undefined ? Math.min(...values) - domain.min : domain.max - Math.max(...values);
      assert.ok(free >= 0 && free / (domain.max - domain.min) <= 0.25 + 1e-9, `${JSON.stringify(values)} at ${lines} lines: ${domain.ticks}`);
    }
  }
});

test("niceDomain: one-bound labels never need more decimals than the nice step", () => {
  // Readable but finer steps that add a decimal are skipped: the nice step stays.
  assert.deepEqual(niceDomain([0.01, 0.05], { lines: 5, min: 0 }).ticks, [0, 0.02, 0.04, 0.06, 0.08], "not 0.015 steps");
  assert.deepEqual(niceDomain([0.01, 0.05], { lines: 5, min: 0, pad: 0 }).ticks, [0, 0.02, 0.04, 0.06, 0.08], "not 0.0125 steps");
  assert.deepEqual(niceDomain([-5, -1], { lines: 5, max: 0 }).ticks, [-8, -6, -4, -2, 0], "whole-number data keeps whole steps, not 1.5");
  assert.deepEqual(niceDomain([0.95, 0.99], { lines: 5, max: 1 }).ticks, [0.92, 0.94, 0.96, 0.98, 1], "not 0.015 steps");
  assert.deepEqual(niceDomain([6, 9], { lines: 4, max: 10 }).ticks, [4, 6, 8, 10], "not 5.5, 7, 8.5, 10");
  // `decimals`: a price axis shows two anyway, so a two-decimal split from the bound is free.
  assert.deepEqual(niceDomain([-0.1, 0.3], { lines: 5, includeZero: true, max: 0.4 }).ticks, [-0.4, -0.2, 0, 0.2, 0.4]);
  assert.deepEqual(niceDomain([-0.1, 0.3], { lines: 5, includeZero: true, max: 0.4, decimals: 2 }).ticks, [-0.2, -0.05, 0.1, 0.25, 0.4]);
  assert.deepEqual(niceDomain([0.01, 0.05], { lines: 5, min: 0, decimals: 2 }).ticks, [0, 0.02, 0.04, 0.06, 0.08], "0.015 still needs a third");
  // Prices 0.01…0.60 € from a zero (or down to a zero) bound, with and without headroom.
  for (const [pad, decimals] of [[undefined, undefined], [0, undefined], [undefined, 2], [0, 2]]) {
    for (let lines = 2; lines <= 9; lines++) {
      for (let low = 1; low <= 60; low += 3) {
        for (let high = low; high <= 60; high++) {
          for (const sign of [1, -1]) {
            const values = [(sign * low) / 100, (sign * high) / 100];
            const domain = niceDomain(values, { lines, pad, decimals, ...(sign > 0 ? { min: 0 } : { max: 0 }) });
            const nice = niceStep(((high / 100) * (1 + (pad ?? 0.04))) / (lines - 1));
            const label = `${JSON.stringify(values)} at ${lines} lines, pad ${pad}, decimals ${decimals}: ${domain.ticks}`;
            assert.ok(stepDecimals(domain.step) <= Math.max(decimals ?? 0, stepDecimals(nice)), label);
            assert.ok(domain.min <= Math.min(...values) && domain.max >= Math.max(...values), label);
          }
        }
      }
    }
  }
});

test("niceDomain: two lines across zero round each bound outward to a nice unit", () => {
  for (const [values, options, ticks] of [
    [[-0.05, 0.3], { includeZero: true }, [-0.1, 0.4]],
    [[-12.4, 3.2], {}, [-15, 5]],
    [[-0.02, 0.25], { includeZero: true }, [-0.08, 0.32]],
  ]) {
    const domain = niceDomain(values, { ...options, lines: 2 });
    assert.deepEqual(domain.ticks, ticks, JSON.stringify(values));
    const decimals = stepDecimals(domain.step);
    domain.ticks.forEach((value) => assert.equal(Number(value.toFixed(decimals)), value, `${value} labels exactly at ${decimals} decimals`));
  }
});

test("niceDomain labels never repeat at stepDecimals precision", () => {
  const cases = [
    [[0, 312], { includeZero: true, minSpan: 100 }],
    [[0, 1.36], { includeZero: true, minSpan: 1 }],
    [[0.02, 0.25], { includeZero: true }],
    [[-0.05, 0.3], { includeZero: true }],
    [[0.123, 0.128], {}],
    [[8, 14], { pad: 0, integer: true }],
    [[-12.4, 3.2], {}],
    [[1000, 1003], {}],
  ];
  for (const [values, options] of cases) {
    for (const lines of [2, 3, 5, 7, 9]) {
      const domain = niceDomain(values, { ...options, lines });
      const labels = domain.ticks.map((value) => value.toFixed(stepDecimals(domain.step)));
      assert.equal(new Set(labels).size, labels.length, `${JSON.stringify(values)} at ${lines} lines: ${labels}`);
      assert.ok(domain.min <= Math.min(...values) && domain.max >= Math.max(...values));
    }
  }
});

// Electricity: 48 h midnight domain, axis labels like "-0.08 €" (7 characters).
const electricityPlotWidth = (width) => width - CHART_MARGIN.edge - Math.max(CHART_MARGIN.minAxis, estimateLabelWidth("-0.08 €") + CHART_AXIS_GAP_PX);
const ELECTRICITY_STEPS = [6, 8, 12, 16, 24, 48].map((hours) => hours * HOUR);
const DOMAIN_48H = { start: MIDNIGHT, end: MIDNIGHT + 48 * HOUR };

test("timeTicks keeps the electricity counts: 3 at 360px, 2 at 200px, 7 at 720px", () => {
  const format = (time) => formatHassDateTime(GB, time, { year: false });
  const count = (width) => timeTicks(DOMAIN_48H, electricityPlotWidth(width), format, { stepsMs: ELECTRICITY_STEPS }).length;
  assert.equal(count(360), 3);
  assert.equal(count(200), 2);
  assert.equal(count(720), 7);
});

test("timeTicks: 12-hour labels never overlap from 280 to 1080px and never pass the end", () => {
  const format = (time) => formatHassDateTime(US12, time, { year: false });
  for (const width of [120, 140, 160, 200, 240, 280, 300, 340, 360, 400, 415, 480, 720, 1080]) {
    const plot = electricityPlotWidth(width);
    const ticks = timeTicks(DOMAIN_48H, plot, format, { stepsMs: ELECTRICITY_STEPS });
    assert.ok(ticks.length >= (width >= 280 ? 2 : 1));
    assert.ok(ticks.every((time) => time >= DOMAIN_48H.start && time <= DOMAIN_48H.end));
    // Measure with 5.6 px per character, like the electricity card's own test.
    const spans = ticks.map((time, index) => {
      const x = ((time - DOMAIN_48H.start) / (48 * HOUR)) * plot;
      const w = format(time).length * 5.6;
      return index === 0 ? [x, x + w] : index === ticks.length - 1 && time === DOMAIN_48H.end ? [x - w, x] : [x - w / 2, x + w / 2];
    });
    spans.slice(1).forEach((span, index) => assert.ok(span[0] >= spans[index][1], `labels overlap at ${width}px`));
  }
  // Default steps: a 24 h window whose steps do not divide it never yields a tick past the end.
  const day = { start: MIDNIGHT, end: MIDNIGHT + 23.5 * HOUR };
  for (const width of [300, 900, 2400]) {
    const ticks = timeTicks(day, width, (time) => formatHassDateTime(GB, time, { year: false }));
    assert.ok(ticks.length >= 2 && ticks.every((time) => time <= day.end), `${width}px`);
  }
  // The fallback only keeps both ends when their inward-anchored labels fit side by side.
  const label = () => "3 Nov, 14:00"; // 69.6px estimated
  const fullDay = { start: 0, end: 24 * HOUR };
  assert.deepEqual(timeTicks(fullDay, 148, label, { stepsMs: [48 * HOUR] }), [0, 24 * HOUR], "69.6 + 69.6 + 8 fits in 148px");
  assert.deepEqual(timeTicks(fullDay, 140, label, { stepsMs: [48 * HOUR] }), [0], "the end label would overlap the start");
  assert.deepEqual(timeTicks(fullDay, 100, label), [0]);
  assert.deepEqual(timeTicks(DOMAIN_48H, 40, () => "a very long label"), [DOMAIN_48H.start]);
});

test("segmentPoints splits on null, NaN, interval breaks and maxGapMs", () => {
  const points = [0, 1, 2, 3, 4, 5].map((hour) => ({ t: MIDNIGHT + hour * HOUR, v: hour }));
  const lengths = (segments) => segments.map((segment) => segment.length);
  assert.deepEqual(lengths(segmentPoints(points)), [6]);
  assert.deepEqual(lengths(segmentPoints(points.map((point, index) => (index === 2 ? { ...point, v: null } : point)))), [2, 3]);
  assert.deepEqual(lengths(segmentPoints(points.map((point, index) => (index === 4 ? { ...point, v: NaN } : point)))), [4, 1]);
  const missingHour = points.filter((_, index) => index !== 3);
  assert.deepEqual(lengths(segmentPoints(missingHour, { intervalMs: HOUR })), [3, 2], "a missing hour breaks an interval series");
  assert.deepEqual(lengths(segmentPoints(missingHour)), [5], "lines without rules join across missing samples");
  assert.deepEqual(lengths(segmentPoints(missingHour, { maxGapMs: 1.5 * HOUR })), [3, 2]);
  const shifted = points.map((point, index) => (index === 3 ? { ...point, t: point.t + 30_000 } : point));
  assert.deepEqual(lengths(segmentPoints(shifted, { intervalMs: HOUR })), [6], "under a minute of jitter stays contiguous");
  // A single-point segment draws a short step, not a dot.
  const single = segmentPoints([{ t: 0, v: null }, { t: HOUR, v: 3 }, { t: 2 * HOUR, v: null }], { intervalMs: HOUR });
  assert.deepEqual(lengths(single), [1]);
  assert.equal(stepPath([{ x: 10, y: 20, x1: 18 }]), "M 10.00 20.00 L 18.00 20.00");
  // A lone linear or smooth point is a zero-length line, which round caps draw as a dot.
  assert.equal(linePath([{ x: 10, y: 20 }]), "M 10.00 20.00 L 10.00 20.00");
  assert.equal(smoothPath([{ x: 10, y: 20 }]), "M 10.00 20.00 L 10.00 20.00");
});

test("paths: step coordinates, smooth through every point, area closed at the baseline", () => {
  assert.equal(linePath([{ x: 0, y: 1 }, { x: 2, y: 3 }]), "M 0.00 1.00 L 2.00 3.00");
  assert.equal(
    stepPath([{ x: 0, y: 10, x1: 5 }, { x: 5, y: 20, x1: 10 }]),
    "M 0.00 10.00 L 5.00 10.00 L 5.00 20.00 L 10.00 20.00",
  );
  const points = [{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 15 }, { x: 30, y: 5 }];
  const smooth = smoothPath(points);
  assert.match(smooth, /^M 0\.00 10\.00/);
  for (const point of points.slice(1)) assert.ok(smooth.includes(`, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`), `passes through ${point.x}`);
  assert.equal((smooth.match(/ C /g) || []).length, 3);
  assert.equal(smoothPath([]), "");
  assert.equal(areaPath("M 0.00 10.00 L 5.00 10.00", 0, 5, 40), "M 0.00 10.00 L 5.00 10.00 L 5.00 40.00 L 0.00 40.00 Z");
  // Negative bars grow down from zero; widths are clamped to 2..14.
  assert.deepEqual(barRect(0, 10, 80, 50), { x: 0.5, y: 50, width: 9, height: 30 });
  assert.deepEqual(barRect(0, 10, 20, 50), { x: 0.5, y: 20, width: 9, height: 30 });
  assert.equal(barRect(0, 40, 20, 50).width, 14);
  assert.equal(barRect(0, 1, 20, 50).width, 2);
  assert.equal(barRect(0, 10, 50, 50).height, 1);
  // "interval": the bar fills its slot but for 1px on each side, whatever the slot width.
  assert.deepEqual(barRect(100, 140, 20, 50, "interval"), { x: 101, y: 20, width: 38, height: 30 });
  assert.deepEqual(barRect(0, 10, 20, 50, "interval"), { x: 1, y: 20, width: 8, height: 30 });
  assert.deepEqual(barRect(0, 4, 20, 50, "interval"), { x: 0.5, y: 20, width: 3, height: 30 });
  assert.equal(barRect(0, 0.5, 20, 50, "interval").width, 1);
  assert.deepEqual(barRect(0, 40, 20, 50, "narrow"), barRect(0, 40, 20, 50));
});

test("barFit interval makes bars span their interval in the laid-out chart", () => {
  const points = [0.1, 0.2, 0.3, 0.2].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v }));
  const options = (barFit) => priceOptions({
    domain: { start: MIDNIGHT, end: MIDNIGHT + 4 * HOUR },
    series: [priceSeries({ kind: "bar", points, ...(barFit ? { barFit } : {}) })],
  });
  const narrow = layoutTimeSeriesChart(options(), { width: 360, now: MIDNIGHT }).series[0].bars;
  const wide = layoutTimeSeriesChart(options("interval"), { width: 360, now: MIDNIGHT }).series[0].bars;
  assert.ok(narrow.every((bar) => bar.width === 14));
  const slot = wide[1].x - wide[0].x;
  assert.ok(slot > 40, `four hours on 360px: ${slot}`);
  assert.ok(wide.every((bar) => Math.abs(bar.width - (slot - 2)) < 0.01), "each bar fills its hour but for 2px");
  // Neighbouring bars leave a 2px gap: the edge of an hour is 1px from each bar.
  assert.ok(Math.abs(wide[1].x - (wide[0].x + wide[0].width) - 2) < 0.01);
});

test("electricity price colours: past, current and future, green at or below the cheap limit", () => {
  const now = MIDNIGHT + 2.5 * HOUR;
  const at = (hour, value, extra = {}) => electricityPriceColor({ start: MIDNIGHT + hour * HOUR, end: MIDNIGHT + (hour + 1) * HOUR, now, value, ...extra });
  assert.equal(at(1, 0.3), ELECTRICITY_PRICE_COLORS.past);
  assert.equal(at(2, 0.3), ELECTRICITY_PRICE_COLORS.current);
  assert.equal(at(3, 0.3), ELECTRICITY_PRICE_COLORS.future);
  assert.equal(at(1, 0.1, { cheap: 0.1 }), ELECTRICITY_PRICE_COLORS.cheapPast);
  assert.equal(at(2, 0.1, { cheap: 0.1 }), ELECTRICITY_PRICE_COLORS.cheapCurrent);
  assert.equal(at(3, 0.05, { cheap: 0.1 }), ELECTRICITY_PRICE_COLORS.cheap);
  assert.equal(at(3, 0.11, { cheap: 0.1 }), ELECTRICITY_PRICE_COLORS.future);
  // No limit, or no price: never green. Negative prices are cheap under any limit above them.
  assert.equal(at(3, 0.05, { cheap: null }), ELECTRICITY_PRICE_COLORS.future);
  assert.equal(at(3, null, { cheap: 0.1 }), ELECTRICITY_PRICE_COLORS.future);
  assert.equal(at(3, -0.02, { cheap: 0 }), ELECTRICITY_PRICE_COLORS.cheap);
  assert.equal(at(3, 0.3, { colors: { future: "#123456" } }), "#123456");
  assert.equal(at(2, 0.3, { colors: { future: "#123456" } }), ELECTRICITY_PRICE_COLORS.current);
  // The end of an interval belongs to the next one.
  assert.equal(electricityPriceColor({ start: now - HOUR, end: now, now, value: 0.3 }), ELECTRICITY_PRICE_COLORS.past);
  assert.equal(electricityPriceColor({ start: now, end: now + HOUR, now, value: 0.3 }), ELECTRICITY_PRICE_COLORS.current);
});

test("extremes, indexAtTime, nearestIndex and keyboardIndex", () => {
  const points = [{ t: 0, v: 3 }, { t: 10, v: null }, { t: 20, v: -1 }, { t: 30, v: 7 }, { t: 40, v: 7 }];
  const { min, max } = extremes(points);
  assert.equal(min.t, 20);
  assert.equal(max.t, 30, "the first highest wins");
  assert.deepEqual(extremes([{ t: 0, v: null }]), { min: undefined, max: undefined });
  const times = [{ t: 0 }, { t: 10 }, { t: 30 }];
  assert.equal(indexAtTime(times, -5), 0);
  assert.equal(indexAtTime(times, 10), 1);
  assert.equal(indexAtTime(times, 29), 1, "interval semantics: last point at or before");
  assert.equal(indexAtTime(times, 99), 2);
  assert.equal(indexAtTime([], 1), -1);
  assert.equal(nearestIndex(times, 21), 2);
  assert.equal(nearestIndex(times, 19), 1);
  assert.equal(nearestIndex([], 1), -1);
  assert.equal(keyboardIndex("ArrowRight", 3, 48), 4);
  assert.equal(keyboardIndex("ArrowUp", 3, 48), 4);
  assert.equal(keyboardIndex("ArrowLeft", 0, 48), 0);
  assert.equal(keyboardIndex("ArrowDown", 3, 48), 2);
  assert.equal(keyboardIndex("PageUp", 3, 48), 9, "48 hourly prices page by 6");
  assert.equal(keyboardIndex("PageDown", 30, 288), 0, "288 buckets page by 36");
  assert.equal(keyboardIndex("PageUp", 0, 288), 36);
  assert.equal(keyboardIndex("PageUp", 0, 3), 1, "pages are at least one step");
  assert.equal(keyboardIndex("Home", 7, 48), 0);
  assert.equal(keyboardIndex("End", 7, 48), 47);
  assert.equal(keyboardIndex("Escape", 7, 48), "now");
  assert.equal(keyboardIndex("Enter", 7, 48), undefined);
  assert.equal(keyboardIndex("ArrowRight", 0, 0), undefined);
});

test("sampleAndHold carries sample-and-hold values (ported from the printer card)", () => {
  const power = [
    { t: t("2026-10-27T10:00:00Z"), v: 100 },
    { t: t("2026-10-27T10:10:00Z"), v: 200 },
  ];
  const options = { start: t("2026-10-27T10:00:00Z"), end: t("2026-10-27T10:15:00Z"), bucketMs: 5 * 60_000 };
  const buckets = sampleAndHold(power, options);
  assert.equal(buckets.length, 3);
  assert.deepEqual(buckets.map((bucket) => bucket.v), [100, 100, 200]);
  assert.equal(buckets[0].t, options.start);
  const current = sampleAndHold([{ t: t("2026-10-27T10:00:00Z"), v: 1 }], options);
  assert.equal(current[2].v, 1);
  const before = sampleAndHold([{ t: t("2026-10-27T09:00:00Z"), v: 42 }, { t: t("2026-10-27T10:07:00Z"), v: null }], options);
  assert.deepEqual(before.map((bucket) => bucket.v), [42, null, null], "values carry forward from before start; unavailable stays a gap");
  assert.equal(sampleAndHold([], { start: 0, end: 1e9, bucketMs: 1 }).length, 1440, "at most 1440 buckets");
  assert.deepEqual(sampleAndHold(power, { ...options, end: options.start }), []);
  assert.deepEqual(sampleAndHold(power, { ...options, bucketMs: 0 }), []);
  assert.equal(safeId("weather-0-Weather.Home/Temp"), "weather-0-Weather-Home-Temp");
});

test("chartDefId keeps gradient ids distinct when raw ids sanitize or join alike", () => {
  assert.match(chartDefId("temperature", "price", "stroke"), /^family-chart-temperature-price-[0-9a-z]+-stroke$/);
  assert.notEqual(chartDefId("a-b", "c", "stroke"), chartDefId("a", "b-c", "stroke"));
  assert.notEqual(chartDefId("chart", "Price", "fade"), chartDefId("chart", "price", "fade"));
  assert.notEqual(chartDefId("weather.home", "t", "area"), chartDefId("weather/home", "t", "area"));
  assert.equal(chartDefId("w", "t", "area"), chartDefId("w", "t", "area"), "stable across renders");
  assert.match(chartDefId("Weather Home/1", "t", "fade"), /^[A-Za-z0-9_-]+$/, "safe inside url(#…)");
});

// ---------------------------------------------------------------- layout

const priceSeries = (overrides = {}) => ({
  id: "price",
  label: "Price",
  kind: "line",
  curve: "step",
  intervalMs: HOUR,
  extremes: true,
  points: [0.05, 0.1, 0.25, 0.3, 0.2].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })),
  format: (value) => formatHassNumber(GB, value, { digits: 4, unit: "€/kWh" }),
  ...overrides,
});
const priceOptions = (overrides = {}) => ({
  id: "price",
  label: "Electricity price interval",
  height: 190,
  hass: GB,
  domain: { start: MIDNIGHT, end: MIDNIGHT + 6 * HOUR },
  series: [priceSeries()],
  axes: { primary: { includeZero: true, format: (value) => formatHassNumber(GB, value, { digits: 2, unit: "€" }) } },
  ...overrides,
});

test("layout: the viewBox width is the measured width and height is clamped", () => {
  const model = layoutTimeSeriesChart(priceOptions(), { width: 280, now: MIDNIGHT + 2.5 * HOUR });
  assert.equal(model.width, 280);
  assert.equal(model.height, 190);
  assert.equal(model.empty, false);
  assert.equal(layoutTimeSeriesChart(priceOptions({ height: 40 }), { width: 280, now: 0 }).height, 82);
  assert.equal(layoutTimeSeriesChart(priceOptions({ height: 900 }), { width: 280, now: 0 }).height, 360);
  assert.equal(model.plot.top, 15);
  assert.equal(model.plot.bottom, 190 - 24);
  assert.equal(model.gridY.length, 5);
  assert.equal(model.axisLabels.primary.length, 5);
  assert.equal(model.ticks[0].anchor, "start");
  assert.equal(model.ticks.at(-1).anchor, "end");
  assert.equal(model.xPercent(MIDNIGHT), (model.plot.left / 280) * 100);
});

test("layout: the right margin follows the longest label; a secondary axis adds a left margin", () => {
  const short = layoutTimeSeriesChart(priceOptions({ axes: { primary: { format: (value) => `${Math.round(value)}` } } }), { width: 360, now: 0 });
  assert.equal(short.plot.right, 360 - 36, "short labels keep the 36px minimum");
  assert.equal(short.plot.left, 8);
  const long = layoutTimeSeriesChart(priceOptions({ axes: { primary: { format: (value) => `${value.toFixed(2)} long-unit` } } }), { width: 360, now: 0 });
  assert.equal(long.plot.right, 360 - (estimateLabelWidth("0.32 long-unit") + CHART_AXIS_GAP_PX));
  const dual = layoutTimeSeriesChart(
    priceOptions({
      series: [priceSeries(), priceSeries({ id: "rain", axis: "secondary", emphasis: "secondary", curve: "linear", intervalMs: undefined })],
      axes: {
        primary: { includeZero: true, format: (value) => value.toFixed(2) },
        secondary: { min: 0, max: 100, format: (value) => `${Math.round(value)}%`, color: "var(--rain)" },
      },
    }),
    { width: 360, now: 0 },
  );
  assert.equal(dual.plot.left, Math.max(CHART_MARGIN.minAxis, estimateLabelWidth("100%") + CHART_AXIS_GAP_PX));
  assert.equal(dual.axisLabels.secondary.length, dual.axisLabels.primary.length, "both axes share the gridlines");
  dual.axisLabels.secondary.forEach((label, index) => assert.equal(label.y, dual.axisLabels.primary[index].y));
});

test("layout: the now marker is hidden outside the domain or when turned off", () => {
  const inside = layoutTimeSeriesChart(priceOptions(), { width: 360, now: MIDNIGHT + 2.5 * HOUR });
  assert.equal(inside.now.x, inside.x(MIDNIGHT + 2.5 * HOUR));
  assert.equal(layoutTimeSeriesChart(priceOptions(), { width: 360, now: MIDNIGHT - HOUR }).now, undefined);
  assert.equal(layoutTimeSeriesChart(priceOptions(), { width: 360, now: MIDNIGHT + 7 * HOUR }).now, undefined);
  assert.equal(layoutTimeSeriesChart(priceOptions({ nowMarker: false }), { width: 360, now: MIDNIGHT + 2 * HOUR }).now, undefined);
});

test("layout: the default selection follows now (interval x for step, nearest point for smooth)", () => {
  const now = MIDNIGHT + 2.5 * HOUR;
  const step = layoutTimeSeriesChart(priceOptions(), { width: 360, now });
  assert.equal(step.selection.followsNow, true);
  assert.equal(step.selection.index, 2);
  assert.equal(step.selection.x, step.x(now), "the cursor sits at the exact now x");
  assert.equal(step.selection.t, now);
  assert.equal(step.selection.values[0].point.v, 0.25);
  const smooth = layoutTimeSeriesChart(
    priceOptions({ domain: undefined, series: [priceSeries({ curve: "smooth", intervalMs: undefined })] }),
    { width: 360, now: MIDNIGHT + 2.6 * HOUR },
  );
  assert.equal(smooth.selection.index, 3);
  assert.equal(smooth.selection.x, smooth.x(MIDNIGHT + 3 * HOUR));
  const before = layoutTimeSeriesChart(priceOptions(), { width: 360, now: MIDNIGHT - 5 * HOUR });
  assert.equal(before.selection.index, 0, "outside the domain the nearest end is used");
  const after = layoutTimeSeriesChart(priceOptions(), { width: 360, now: MIDNIGHT + 9 * HOUR });
  assert.equal(after.selection.index, 4);
});

test("layout: a manual selection snaps to the interval centre and aligns other series by time", () => {
  const options = priceOptions({
    series: [priceSeries(), priceSeries({ id: "other", extremes: false, points: [{ t: MIDNIGHT + 3 * HOUR, v: 0.9 }] })],
  });
  const model = layoutTimeSeriesChart(options, { width: 360, now: MIDNIGHT, selectedT: MIDNIGHT + 3 * HOUR + 120_000 });
  assert.equal(model.selection.followsNow, false);
  assert.equal(model.selection.index, 3);
  assert.equal(model.selection.t, MIDNIGHT + 3 * HOUR);
  assert.equal(model.selection.x, model.x(MIDNIGHT + 3.5 * HOUR));
  assert.equal(model.selection.values[1].point.v, 0.9);
  const elsewhere = layoutTimeSeriesChart(options, { width: 360, now: MIDNIGHT, selectedT: MIDNIGHT + HOUR });
  assert.equal(elsewhere.selection.values[1].point, undefined, "no value where the other series has none");
});

test("layout: a synced time without a value here keeps the cursor on that time and shows no value", () => {
  // Hourly prices with 02:00 missing; a synced chart picked 02:30.
  const gap = priceOptions({
    series: [priceSeries({ points: [0.05, 0.1, null, 0.3, 0.2].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })) })],
  });
  const missing = layoutTimeSeriesChart(gap, { width: 360, now: MIDNIGHT, selectedT: MIDNIGHT + 2.5 * HOUR });
  assert.equal(missing.selection.t, MIDNIGHT + 2.5 * HOUR, "not snapped to 01:00");
  assert.equal(missing.selection.x, missing.x(MIDNIGHT + 2.5 * HOUR));
  assert.equal(missing.selection.values[0].point, undefined);
  assert.equal(missing.selection.values[0].y, undefined);
  assert.equal(missing.selection.index, 1, "the slider index stays on the nearest interval for the keyboard");
  // Lines: a sample within maxGapMs/2 matches, one further away does not.
  const line = priceOptions({ series: [priceSeries({ curve: "smooth", intervalMs: undefined, maxGapMs: HOUR })] });
  const near = layoutTimeSeriesChart(line, { width: 360, now: MIDNIGHT, selectedT: MIDNIGHT + 1.4 * HOUR });
  assert.equal(near.selection.t, MIDNIGHT + HOUR);
  assert.equal(near.selection.values[0].point.v, 0.1);
  const far = layoutTimeSeriesChart(line, { width: 360, now: MIDNIGHT, selectedT: MIDNIGHT + 5.8 * HOUR });
  assert.equal(far.selection.t, MIDNIGHT + 5.8 * HOUR, "the last sample is 04:00, 1.8 h away");
  assert.equal(far.selection.values[0].point, undefined);
  // Half an interval for a line with intervalMs and no maxGapMs; any distance without either.
  const hourly = priceOptions({ series: [priceSeries({ curve: "linear" })] });
  assert.equal(layoutTimeSeriesChart(hourly, { width: 360, now: MIDNIGHT, selectedT: MIDNIGHT + 5.8 * HOUR }).selection.values[0].point, undefined);
  const loose = priceOptions({ series: [priceSeries({ curve: "linear", intervalMs: undefined })] });
  assert.equal(layoutTimeSeriesChart(loose, { width: 360, now: MIDNIGHT, selectedT: MIDNIGHT + 5.8 * HOUR }).selection.values[0].point.v, 0.2);
  // An explicit null at the picked time is no value, whatever the tolerance: hourly samples
  // 10…70 with 04:00 missing must not read 03:00's 40.
  const domain = { start: MIDNIGHT, end: MIDNIGHT + 7 * HOUR };
  const withNull = (overrides) => priceOptions({
    domain,
    series: [priceSeries({ curve: "smooth", intervalMs: undefined, points: [10, 20, 30, 40, null, 60, 70].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })), ...overrides })],
  });
  for (const maxGapMs of [1.5 * HOUR, 2 * HOUR, 9 * HOUR, undefined]) {
    const model = layoutTimeSeriesChart(withNull({ maxGapMs }), { width: 360, now: MIDNIGHT, selectedT: MIDNIGHT + 4 * HOUR });
    assert.equal(model.selection.values[0].point, undefined, `maxGapMs ${maxGapMs}`);
    assert.equal(model.selection.t, MIDNIGHT + 4 * HOUR, `maxGapMs ${maxGapMs}: the cursor stays on 04:00`);
  }
  const beside = layoutTimeSeriesChart(withNull({ maxGapMs: 9 * HOUR }), { width: 360, now: MIDNIGHT, selectedT: MIDNIGHT + 3 * HOUR });
  assert.equal(beside.selection.values[0].point.v, 40, "a value next to the gap still reads");
  // A second series is matched the same way: its null at the primary sample's time reads no value.
  const combined = priceOptions({
    domain,
    series: [
      priceSeries({ curve: "smooth", intervalMs: undefined, maxGapMs: 9 * HOUR, points: [1, 2, 3, 4, 5, 6, 7].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })) }),
      priceSeries({ id: "other", curve: "smooth", intervalMs: undefined, extremes: false, points: [10, 20, 30, 40, null, 60, 70].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })) }),
    ],
  });
  const pair = layoutTimeSeriesChart(combined, { width: 360, now: MIDNIGHT, selectedT: MIDNIGHT + 4 * HOUR });
  assert.equal(pair.selection.values[0].point.v, 5);
  assert.equal(pair.selection.values[1].point, undefined);
  // Outside this chart's window the cursor waits at the nearest edge.
  const outside = layoutTimeSeriesChart(gap, { width: 360, now: MIDNIGHT, selectedT: MIDNIGHT + 9 * HOUR });
  assert.equal(outside.selection.x, outside.x(MIDNIGHT + 6 * HOUR));
  assert.equal(outside.selection.values[0].point, undefined);
});

test("layout: hard colour stops come in pairs, smooth stops sit at each point's x", () => {
  const colorAt = (point) => (point.v > 0.2 ? "#f00" : "#0f0");
  const hard = layoutTimeSeriesChart(priceOptions({ series: [priceSeries({ colorAt })] }), { width: 360, now: 0 });
  const stops = hard.series[0].stops;
  assert.equal(stops.length, 10);
  for (let index = 0; index < stops.length; index += 2) {
    assert.equal(stops[index].color, stops[index + 1].color);
    assert.ok(stops[index].offset <= stops[index + 1].offset);
  }
  assert.equal(stops[0].offset, 0);
  const smooth = layoutTimeSeriesChart(
    priceOptions({ domain: undefined, series: [priceSeries({ curve: "smooth", intervalMs: undefined, colorAt })] }),
    { width: 360, now: 0 },
  );
  assert.equal(smooth.series[0].stops.length, 5);
  assert.deepEqual(smooth.series[0].stops.map((stop) => stop.offset), [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(layoutTimeSeriesChart(priceOptions(), { width: 360, now: 0 }).series[0].stops, undefined, "plain colours need no gradient");
});

test("layout: H/L extremes, bars from zero, gaps and the empty state", () => {
  const line = layoutTimeSeriesChart(priceOptions(), { width: 360, now: 0 });
  assert.deepEqual(line.extremes.map((mark) => mark.text), ["H", "L"]);
  assert.equal(line.extremes[0].x, line.x(MIDNIGHT + 3.5 * HOUR), "step extremes sit over the interval centre");
  assert.ok(line.extremes.every((mark) => mark.y >= 11));
  assert.ok(line.series[0].segments[0].area.endsWith("Z"));
  const negative = priceSeries({ kind: "bar", points: [-0.05, 0.1, null, 0.3].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })) });
  const bars = layoutTimeSeriesChart(priceOptions({ series: [negative] }), { width: 360, now: 0 });
  const zeroY = bars.y.primary(0);
  assert.equal(bars.series[0].bars.length, 3);
  assert.equal(bars.series[0].bars[0].y, zeroY, "a negative bar grows down from zero");
  assert.ok(bars.series[0].bars[1].y + bars.series[0].bars[1].height <= zeroY + 1e-9);
  const low = bars.extremes.find((mark) => mark.text === "L");
  assert.ok(low.y > bars.y.primary(-0.05), "a negative bar's L sits under the bar end, not over the bar");
  assert.ok(low.y <= bars.plot.bottom + 9, "and stays clear of the time labels");
  assert.equal(bars.selectable.length, 3, "the slider skips the missing hour");
  assert.equal(bars.hasGaps, true);
  assert.equal(line.hasGaps, false);
  const nulls = priceSeries({ points: [0, 1, 2].map((hour) => ({ t: MIDNIGHT + hour * HOUR, v: null })) });
  const empty = layoutTimeSeriesChart(priceOptions({ series: [nulls] }), { width: 360, now: 0 });
  assert.equal(empty.empty, true);
  assert.equal(empty.selection, undefined);
  assert.equal(layoutTimeSeriesChart(priceOptions({ domain: { start: 5, end: 5 } }), { width: 360, now: 0 }).empty, true);
});

test("layout: a missing linear value splits the line into two segments", () => {
  const temperature = {
    id: "temperature",
    label: "Temperature",
    curve: "smooth",
    maxGapMs: 1.5 * HOUR,
    points: [8, 9, null, 12, 14, 13].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })),
    format: (value) => `${Math.round(value)}°`,
  };
  const model = layoutTimeSeriesChart(
    { id: "w", label: "Temperature", height: 118, series: [temperature], axes: { primary: { pad: 0, integer: true, minSpan: 1, format: (value) => `${value}°` } } },
    { width: 360, now: MIDNIGHT + 2 * HOUR },
  );
  assert.equal(model.series[0].segments.length, 2);
  assert.equal(model.selectable.length, 5);
  assert.equal(model.x.domain[1], MIDNIGHT + 5 * HOUR, "the default domain spans the data");
});

test("layout: values beyond an explicit min/max stay inside the plot", () => {
  const outOfRange = [0.5, -0.1, 0.1].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v }));
  const options = (kind) => priceOptions({
    domain: { start: MIDNIGHT, end: MIDNIGHT + 3 * HOUR },
    series: [priceSeries({ kind, points: outOfRange })],
    axes: { primary: { min: 0, max: 0.2, format: (value) => value.toFixed(2) } },
  });
  const inside = (model, y) => y >= model.plot.top - 1e-9 && y <= model.plot.bottom + 1e-9;
  const bars = layoutTimeSeriesChart(options("bar"), { width: 360, now: MIDNIGHT + 0.5 * HOUR });
  for (const bar of bars.series[0].bars) {
    // barRect keeps a 1px stub for a value on the zero line, here -0.1 pinned to a 0 floor.
    assert.ok(inside(bars, bar.y) && bar.y + bar.height <= bars.plot.bottom + 1, `bar ${bar.point.v}: ${bar.y}+${bar.height}`);
  }
  assert.equal(bars.series[0].bars[0].y, bars.plot.top, "0.5 is pinned to the top edge");
  assert.ok(inside(bars, bars.selection.values[0].y), "the selection dot stays inside too");
  const line = layoutTimeSeriesChart(options("line"), { width: 360, now: MIDNIGHT + 0.5 * HOUR });
  const ys = line.series[0].segments
    .flatMap((segment) => [...segment.line.matchAll(/[ML] [\d.-]+ ([\d.-]+)/g)].map((match) => Number(match[1])));
  assert.ok(ys.length && ys.every((y) => inside(line, y)), `line ys ${ys}`);
  assert.ok(line.extremes.every((mark) => mark.y >= 11));
});

test("layout: axis format receives the computed domain, so labels follow the step", () => {
  // An idle printer: current 0.5 A, includeZero, minSpan 1 -> 0…1 in 0.25 A steps.
  const seen = [];
  const current = {
    id: "current",
    label: "Current",
    curve: "step",
    intervalMs: 5 * 60_000,
    points: [0, 1, 2].map((index) => ({ t: MIDNIGHT + index * 5 * 60_000, v: 0.5 })),
    format: (value) => `${value} A`,
  };
  const model = layoutTimeSeriesChart(
    {
      id: "printer",
      label: "Power",
      height: 120,
      series: [current],
      axes: {
        primary: {
          includeZero: true,
          minSpan: 1,
          format: (value, axis) => {
            seen.push(axis);
            return `${value.toFixed(stepDecimals(axis.step))} A`;
          },
        },
      },
    },
    { width: 360, now: MIDNIGHT },
  );
  assert.deepEqual(model.axisLabels.primary.map((label) => label.text), ["0.00 A", "0.25 A", "0.50 A", "0.75 A", "1.00 A"]);
  assert.deepEqual(seen[0], { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] });
});

test("layout: a primary axis without data shows no invented labels next to a secondary one", () => {
  // Printer "Power unavailable": power is all null, current has data.
  const at = (index) => MIDNIGHT + index * 5 * 60_000;
  const model = layoutTimeSeriesChart(
    {
      id: "printer",
      label: "Power and current",
      height: 160,
      series: [
        { id: "power", label: "Power", curve: "step", intervalMs: 5 * 60_000, points: [0, 1, 2].map((index) => ({ t: at(index), v: null })), format: String },
        { id: "current", label: "Current", curve: "step", intervalMs: 5 * 60_000, axis: "secondary", emphasis: "secondary", points: [0, 1, 2].map((index) => ({ t: at(index), v: index + 1 })), format: String },
      ],
      axes: {
        primary: { includeZero: true, minSpan: 100, format: (value) => `${value} W` },
        secondary: { includeZero: true, minSpan: 1, format: (value) => `${value} A` },
      },
    },
    { width: 360, now: at(1) },
  );
  assert.equal(model.empty, false);
  assert.deepEqual(model.axisLabels.primary, []);
  assert.equal(model.axisLabels.secondary.length, 5);
  assert.deepEqual(model.gridY, model.axisLabels.secondary.map((label) => label.y), "gridlines come from the secondary axis");
  assert.equal(model.plot.right, 360 - CHART_MARGIN.edge, "no right axis margin without right labels");
  assert.equal(model.selectableSeries.id, "current");
});

test("layout: isolated points stay visible; a single sample is not an empty chart", () => {
  const isolated = layoutTimeSeriesChart(
    priceOptions({
      domain: undefined,
      series: [priceSeries({ curve: "linear", intervalMs: undefined, extremes: false, points: [1, null, 3, null, 2].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })) })],
    }),
    { width: 360, now: 0 },
  );
  assert.equal(isolated.series[0].segments.length, 3);
  for (const { line } of isolated.series[0].segments) assert.match(line, /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/, "each lone point draws a dot");
  const lone = layoutTimeSeriesChart(
    priceOptions({
      domain: undefined,
      series: [priceSeries({ curve: "smooth", intervalMs: undefined, maxGapMs: 1.5 * HOUR, points: [{ t: MIDNIGHT, v: 1 }] })],
    }),
    { width: 360, now: MIDNIGHT },
  );
  assert.equal(lone.empty, false);
  assert.deepEqual(lone.x.domain, [MIDNIGHT - 0.75 * HOUR, MIDNIGHT + 0.75 * HOUR], "half a gap of room on each side");
  assert.equal(lone.selection.x, lone.x(MIDNIGHT));
  const noGap = layoutTimeSeriesChart(
    priceOptions({ domain: undefined, series: [priceSeries({ curve: "linear", intervalMs: undefined, points: [{ t: MIDNIGHT, v: 1 }] })] }),
    { width: 360, now: MIDNIGHT },
  );
  assert.deepEqual(noGap.x.domain, [MIDNIGHT - 0.5 * HOUR, MIDNIGHT + 0.5 * HOUR], "30 min each side without maxGapMs");
});

test("layout: the model names the selectable series; bars and steps without an interval throw", () => {
  const step = layoutTimeSeriesChart(priceOptions(), { width: 360, now: 0 });
  assert.equal(step.selectableSeries.id, "price");
  assert.equal(step.intervalSelection, true);
  const smooth = layoutTimeSeriesChart(
    priceOptions({ domain: undefined, series: [priceSeries({ curve: "smooth", intervalMs: undefined })] }),
    { width: 360, now: 0 },
  );
  assert.equal(smooth.intervalSelection, false);
  assert.throws(
    () => layoutTimeSeriesChart(priceOptions({ series: [priceSeries({ kind: "bar", intervalMs: undefined })] }), { width: 360, now: 0 }),
    /series "price" needs intervalMs for a bar series/,
  );
  assert.throws(
    () => layoutTimeSeriesChart(priceOptions({ series: [priceSeries({ intervalMs: 0 })] }), { width: 360, now: 0 }),
    /needs intervalMs for a step series/,
  );
});

// ---------------------------------------------------------------- 1.8.0: lanes, bands, markers

/** Six hourly price bars from midnight in a fixed 6-hour window, 360 px wide: plot 8…307.4, 49.9 px per hour. */
const planChart = (overrides = {}) => ({
  id: "plan",
  label: "Price and plan",
  height: 190,
  hass: GB,
  domain: { start: MIDNIGHT, end: MIDNIGHT + 6 * HOUR },
  axes: { primary: { includeZero: true, format: (value) => formatHassNumber(GB, value, { digits: 2, unit: "€" }) } },
  series: [{
    id: "price",
    label: "Price",
    kind: "bar",
    intervalMs: HOUR,
    points: [-0.05, 0.1, 0.15, 0.25, 0.3, 0.2].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })),
    format: String,
  }],
  ...overrides,
});
const layoutPlan = (overrides, state = {}) =>
  layoutTimeSeriesChart(planChart(overrides), { width: 360, now: MIDNIGHT + 2.5 * HOUR, ...state });
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ""} ${actual} != ${expected}`);

test("chartTotalHeight adds 22 px per lane and one 6 px gap", () => {
  assert.equal(CHART_LANE_PX, 22);
  assert.equal(CHART_LANES_GAP_PX, 6);
  assert.equal(CHART_LANE_TRACK_PX, 10);
  assert.equal(CHART_PERIOD_MIN_PX, 3);
  assert.equal(CHART_LANE_LABEL_CHARS, 8);
  assert.equal(CHART_PERIOD_ACTIVE_PX, 12);
  assert.equal(CHART_PERIOD_LINE_PX, 23, "an 18 px line and the 5 px frame gap");
  assert.equal(chartTotalHeight(190, 0), 190);
  assert.equal(chartTotalHeight(190), 190, "no lanes: the chart height");
  assert.equal(chartTotalHeight(190, 1), 218);
  assert.equal(chartTotalHeight(190, 2), 240);
  assert.equal(chartTotalHeight(40, 2), chartHeight(40) + 50, "the chart part is clamped like chartHeight");
  assert.equal(chartTotalHeight(900, 3), 360 + 72);
  assert.equal(chartTotalHeight(190, -1), 190);
  // Only whole lanes count: a fractional count is cut down, never rounded up to a row that is not drawn.
  assert.equal(chartTotalHeight(190, 1.9), 218);
  assert.equal(chartTotalHeight(190, 2.5), 240);
  assert.equal(chartTotalHeight(190, 0.9), 190);
  assert.equal(chartTotalHeight(190, Number.NaN), 190);
});

test("a chart without lanes, bands or markers keeps its 1.7.0 geometry", () => {
  const plain = layoutPlan();
  assert.equal(plain.height, 190);
  assert.equal(plain.totalHeight, 190);
  assert.deepEqual(plain.lanes, []);
  assert.deepEqual(plain.bands, []);
  assert.deepEqual(plain.markers, []);
  assert.deepEqual(plain.selection.periods, []);
  // The selection walks the series points as before: no time steps, no range.
  assert.equal(plain.steps, undefined);
  assert.equal("steps" in plain, false);
  assert.deepEqual(Object.keys(plain.selection), ["t", "x", "index", "followsNow", "values", "periods"]);
  // Lanes add rows under the chart; the plot, the scales and the time ticks do not move.
  const lanes = layoutPlan({ lanes: [{ id: "a", label: "A", periods: [] }, { id: "b", label: "B", periods: [] }] });
  assert.equal(lanes.height, 190);
  assert.equal(lanes.totalHeight, 240);
  assert.deepEqual(lanes.plot, plain.plot);
  assert.deepEqual(lanes.gridY, plain.gridY);
  assert.deepEqual(lanes.ticks, plain.ticks);
  assert.deepEqual(lanes.x.domain, plain.x.domain);
});

test("lanes are 22 px rows under the chart with a 10 px track over the plot width", () => {
  const model = layoutPlan({
    lanes: [
      { id: "xc40", label: "XC40", periods: [{ start: MIDNIGHT + HOUR, end: MIDNIGHT + 3 * HOUR }] },
      { id: "ex30", label: "EX30", periods: [], muted: true },
    ],
  });
  const { plot } = model;
  assert.deepEqual(model.lanes.map((lane) => lane.y), [196, 218], "6 px under the chart height, then 22 px each");
  assert.deepEqual(model.lanes[0].track, { x: plot.left, y: 202, width: plot.right - plot.left, height: 10 });
  assert.deepEqual(model.lanes[1].track, { x: plot.left, y: 224, width: plot.right - plot.left, height: 10 });
  assert.equal(model.lanes[0].lane.id, "xc40");
  // The label starts where the longest axis label starts, centred on the track.
  const labelX = plot.right + CHART_AXIS_GAP_PX - 2;
  assert.deepEqual(model.lanes[0].label, { x: labelX, y: 207, text: "XC40", room: 360 - labelX });
  assert.equal(model.lanes[1].label.y, 229);
  assert.equal(model.lanes[0].label.y, model.lanes[0].track.y + model.lanes[0].track.height / 2);
  const [period] = model.lanes[0].periods;
  assert.equal(period.tone, "planned", "the default tone");
  near(period.x, model.x(MIDNIGHT + HOUR));
  near(period.width, model.x(MIDNIGHT + 3 * HOUR) - model.x(MIDNIGHT + HOUR));
  assert.deepEqual(model.lanes[1].periods, []);
  assert.equal(model.lanes[0].marker, undefined);
});

test("periods are clipped to the domain, dropped outside it and never narrower than 3 px", () => {
  const periods = [
    { start: MIDNIGHT - 2 * HOUR, end: MIDNIGHT + HOUR, tone: "active" },            // clipped at the start
    { start: MIDNIGHT + 5 * HOUR, end: MIDNIGHT + 9 * HOUR, tone: "extra" },         // clipped at the end
    { start: MIDNIGHT - 3 * HOUR, end: MIDNIGHT - HOUR },                            // before the window
    { start: MIDNIGHT + 6 * HOUR, end: MIDNIGHT + 7 * HOUR },                        // starts at the end: nothing left
    { start: MIDNIGHT + 2 * HOUR, end: MIDNIGHT + 2 * HOUR },                        // empty
    { start: MIDNIGHT + 3 * HOUR, end: MIDNIGHT + 2 * HOUR },                        // reversed
    { start: Number.NaN, end: MIDNIGHT + 2 * HOUR },                                 // not a time
    { start: MIDNIGHT + 2 * HOUR, end: MIDNIGHT + 2 * HOUR + 60_000, tone: "warning" }, // one minute: 0.83 px
    { start: MIDNIGHT + 6 * HOUR - 60_000, end: MIDNIGHT + 6 * HOUR, color: "teal" },   // one minute at the very end
  ];
  const model = layoutPlan({ lanes: [{ id: "car", label: "Car", periods }] });
  const { plot } = model;
  const laid = model.lanes[0].periods;
  assert.deepEqual(laid.map((entry) => periods.indexOf(entry.period)), [0, 1, 7, 8], "the rest are dropped");
  assert.deepEqual(laid.map((entry) => entry.tone), ["active", "extra", "warning", "planned"]);
  near(laid[0].x, plot.left);
  near(laid[0].width, model.x(MIDNIGHT + HOUR) - plot.left);
  near(laid[1].x, model.x(MIDNIGHT + 5 * HOUR));
  near(laid[1].x + laid[1].width, plot.right, "clipped at the domain end");
  assert.equal(laid[2].width, 3, "minimum drawn width");
  near(laid[2].x, model.x(MIDNIGHT + 2 * HOUR));
  assert.equal(laid[3].width, 3);
  near(laid[3].x + laid[3].width, plot.right, "the minimum width stays on the track");
  assert.equal(laid[3].period.color, "teal");
});

test("a muted lane draws every period muted; tone helpers", () => {
  const model = layoutPlan({
    lanes: [{
      id: "car", label: "Car", muted: true,
      periods: [{ start: MIDNIGHT, end: MIDNIGHT + HOUR, tone: "active" }, { start: MIDNIGHT + HOUR, end: MIDNIGHT + 2 * HOUR }],
    }],
  });
  assert.deepEqual(model.lanes[0].periods.map((entry) => entry.tone), ["muted", "muted"]);
  assert.equal(chartPeriodTone({}, {}), "planned");
  assert.equal(chartPeriodTone({}, { tone: "warning" }), "warning");
  assert.equal(chartPeriodTone({ muted: true }, { tone: "active" }), "muted");
  assert.equal(chartPeriodTone({}, { tone: "nonsense" }), "planned", "an unknown tone falls back");
  assert.match(chartPeriodColor("planned"), /^var\(--family-chart-period-planned, color-mix\(in srgb, var\(--family-chart-series-1, var\(--family-active, var\(--primary-color\)\)\) 75%, transparent\)\)$/);
  assert.equal(chartPeriodColor("active"), "var(--family-chart-period-active, var(--family-success, var(--success-color, #43a047)))");
  assert.match(chartPeriodColor("extra"), /^var\(--family-chart-period-extra, color-mix\(in srgb, var\(--family-chart-period-planned, .* 46%, transparent\)\)$/);
  assert.equal(chartPeriodColor("warning"), "var(--family-chart-period-warning, var(--family-warning, var(--warning-color, #ff9800)))");
  assert.equal(chartPeriodColor("muted"), "var(--family-chart-period-muted, color-mix(in srgb, var(--primary-text-color) 22%, transparent))");
  // `done` is what already happened: the active colour at about half strength.
  assert.equal(chartPeriodTone({}, { tone: "done" }), "done");
  assert.equal(chartPeriodColor("done"), `var(--family-chart-period-done, color-mix(in srgb, ${chartPeriodColor("active")} 48%, transparent))`);
  assert.equal(chartPeriodColor("active", "teal"), "teal", "an explicit colour wins");
  assert.equal(chartPeriodColor(), chartPeriodColor("planned"));
});

test("a lane marker is laid out inside the domain and left out outside it", () => {
  const lane = (t) => ({ id: `lane-${t}`, label: "Car", periods: [], marker: { t, label: "Ready by 07:00" } });
  const model = layoutPlan({
    lanes: [lane(MIDNIGHT + 4.5 * HOUR), lane(MIDNIGHT), lane(MIDNIGHT + 6 * HOUR), lane(MIDNIGHT - 1), lane(MIDNIGHT + 6 * HOUR + 1), lane(Number.NaN)],
  });
  near(model.lanes[0].marker.x, model.x(MIDNIGHT + 4.5 * HOUR));
  near(model.lanes[1].marker.x, model.plot.left, "the domain start is inside");
  near(model.lanes[2].marker.x, model.plot.right, "the domain end is inside");
  assert.equal(model.lanes[3].marker, undefined);
  assert.equal(model.lanes[4].marker, undefined);
  assert.equal(model.lanes[5].marker, undefined);
});

test("estimateTextWidth sizes a label by character class", () => {
  assert.equal(estimateTextWidth(""), 0);
  assert.equal(estimateTextWidth("abc"), 18, "lowercase 6 px");
  assert.equal(estimateTextWidth("ABC"), 7.6 * 3, "capitals 7.6 px");
  assert.equal(estimateTextWidth("MW"), 20.8, "M and W 10.4 px");
  assert.equal(estimateTextWidth("mw"), 19.6, "m and w 9.8 px");
  assert.equal(estimateTextWidth("40"), 13.2, "digits 6.6 px");
  assert.equal(estimateTextWidth(" .-"), 12, "spaces and punctuation 4 px");
  assert.equal(estimateTextWidth("电动"), 24, "CJK 12 px");
  assert.equal(estimateTextWidth("가Ａ"), 24, "Hangul and fullwidth forms too");
  assert.equal(estimateTextWidth("🚗"), 14, "an emoji is one 14 px glyph");
  assert.equal(estimateTextWidth("👨‍👩‍👧‍👦🇪🇪"), 28, "a ZWJ family and a flag are one glyph each");
  assert.equal(estimateTextWidth("…"), 11);
  assert.equal(estimateTextWidth("Š"), 7.6, "capitals outside ASCII");
  // Capitals, CJK and emoji are much wider than the 5.8 px per character the axis labels use.
  for (const label of ["MODEL Y", "WWWWWWWW", "电动汽车充电计划", "🚗🚙🚕🛻"]) {
    assert.ok(estimateTextWidth(label) > estimateLabelWidth(label) * 1.2 || [...label].length < label.length, label);
  }
  assert.ok(Math.abs(estimateTextWidth("XC40") - 28.4) < 1e-9);
  // `typical` is the expected width, for fit rules: about 5.2 px per character of lowercase text.
  assert.ok(Math.abs(estimateTextWidth("no price yet", "typical") - 62.4) < 1e-9);
  assert.ok(estimateTextWidth("no price yet", "typical") < estimateLabelWidth("no price yet"));
  assert.ok(estimateTextWidth("Day tariff", "typical") < estimateTextWidth("Day tariff"));
});

test("the right gutter fits the longest lane label; long labels are cut to 8 characters by grapheme", () => {
  assert.equal(chartLaneLabel("XC40"), "XC40");
  assert.equal(chartLaneLabel("Garage 1"), "Garage 1", "8 characters fit");
  assert.equal(chartLaneLabel("Volvo XC40 Recharge"), "Volvo X…");
  assert.equal(chartLaneLabel("🚗🚙🚕🛻🚐🚌🚎🏎🚓"), "🚗🚙🚕🛻🚐🚌🚎…");
  // A grapheme is never split: a flag is two code points, a family seven, an accent a combining mark.
  assert.equal(chartLaneLabel("🇪🇪".repeat(9)), `${"🇪🇪".repeat(7)}…`);
  assert.equal(chartLaneLabel("👨‍👩‍👧‍👦".repeat(9)), `${"👨‍👩‍👧‍👦".repeat(7)}…`);
  assert.equal(chartLaneLabel("é".repeat(9)), `${"é".repeat(7)}…`);
  assert.equal(chartLaneLabel("é".repeat(8)), "é".repeat(8), "8 accented letters are 8 characters");
  assert.equal(chartLaneLabel(undefined), "");

  // "0.30 €" sets the gutter of the plain chart; "XC40" (28.4 px) does not widen it.
  const plain = layoutPlan();
  const short = layoutPlan({ lanes: [{ id: "a", label: "XC40", periods: [] }] });
  assert.equal(short.plot.right, plain.plot.right);
  // A cut label is wider than the axis labels: the gutter grows to fit it.
  const long = layoutPlan({ lanes: [{ id: "a", label: "Volvo XC40 Recharge", periods: [] }, { id: "b", label: "EX30", periods: [] }] });
  assert.equal(long.lanes[0].label.text, "Volvo X…");
  near(long.plot.right, 360 - (estimateTextWidth("Volvo X…") + CHART_AXIS_GAP_PX));
  assert.ok(long.plot.right < plain.plot.right);
  near(long.lanes[0].track.width, long.plot.right - long.plot.left, "the track follows the narrower plot");
  assert.equal(long.lanes[1].label.x, long.lanes[0].label.x);
  // Capitals, CJK and emoji get the room they need, not 5.8 px per character.
  for (const label of ["MODEL Y", "WWWWWWWWWW", "电动汽车充电计划表格", "🚗🚙🚕🛻🚐🚌🚎🏎"]) {
    const model = layoutPlan({ lanes: [{ id: "a", label, periods: [] }] });
    const drawn = model.lanes[0].label;
    assert.equal(drawn.text, chartLaneLabel(label));
    near(drawn.room, 360 - drawn.x);
    assert.ok(drawn.room >= estimateTextWidth(drawn.text), `${label}: ${drawn.room} px for ${estimateTextWidth(drawn.text)} px`);
    assert.ok(drawn.room > estimateLabelWidth(drawn.text), "more than the per-character estimate");
  }
});

test("lane labels get a gutter when the primary axis shows no labels", () => {
  // Primary series without data next to a secondary one with data: no right axis labels (8 px edge).
  const points = (values) => values.map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v }));
  const options = (lanes) => planChart({
    lanes,
    series: [
      { id: "power", label: "Power", points: points([null, null, null]), format: String },
      { id: "current", label: "Current", axis: "secondary", points: points([1, 2, 3]), format: String },
    ],
    axes: { primary: { format: (value) => `${value} W` }, secondary: { format: (value) => `${value} A` } },
  });
  const layout = (lanes) => layoutTimeSeriesChart(options(lanes), { width: 360, now: MIDNIGHT });
  const without = layout(undefined);
  assert.deepEqual(without.axisLabels.primary, []);
  assert.equal(without.plot.right, 360 - CHART_MARGIN.edge);
  const short = layout([{ id: "a", label: "A", periods: [] }]);
  assert.equal(short.plot.right, 360 - CHART_MARGIN.minAxis, "at least the minimum axis gutter");
  const long = layout([{ id: "a", label: "Bedrooms", periods: [] }]);
  near(long.plot.right, 360 - (estimateTextWidth("Bedrooms") + CHART_AXIS_GAP_PX));
  assert.equal(long.lanes[0].label.x, long.plot.right + CHART_AXIS_GAP_PX - 2);
  const unlabelled = layout([{ id: "a", label: "", periods: [] }]);
  assert.equal(unlabelled.plot.right, 360 - CHART_MARGIN.edge, "nothing to fit");
});

test("a plot squeezed to nothing never gives a lane, a period or a band a negative width", () => {
  const squeezed = (characters) => layoutTimeSeriesChart(planChart({
    axes: { primary: { includeZero: true, format: () => "9".repeat(characters) } },
    lanes: [{ id: "car", label: "Car", periods: [{ start: MIDNIGHT, end: MIDNIGHT + 6 * HOUR }, { start: MIDNIGHT + HOUR, end: MIDNIGHT + HOUR + 1 }] }],
    bands: [{ start: MIDNIGHT, end: MIDNIGHT + 6 * HOUR }],
  }), { width: 120, now: MIDNIGHT });
  // 17 digits leave a 1.4 px plot: the 3 px minimum period width gives way to the plot width.
  const narrow = squeezed(17);
  const plotWidth = narrow.plot.right - narrow.plot.left;
  assert.ok(plotWidth > 0 && plotWidth < 3, `plot ${plotWidth}`);
  near(narrow.lanes[0].track.width, plotWidth);
  for (const period of narrow.lanes[0].periods) {
    near(period.width, plotWidth, "capped at the plot width");
    assert.ok(period.x >= narrow.plot.left - 1e-9 && period.x + period.width <= narrow.plot.right + 1e-9);
  }
  // 20 digits push the right gutter past the left edge: everything collapses to zero, not below.
  const gone = squeezed(20);
  assert.ok(gone.plot.right < gone.plot.left);
  assert.equal(gone.lanes[0].track.width, 0);
  for (const period of gone.lanes[0].periods) assert.equal(period.width, 0);
  assert.equal(gone.bands[0].width, 0);
});

test("chartSafeColor lets colours through and nothing that could add a declaration or load a resource", () => {
  for (const color of ["red", "tomato", "currentColor", "#fff", "#12ab34", "#12ab34cc", "rgb(1, 2, 3)", "rgba(1,2,3,.5)", "hsl(120 50% 50% / 0.5)",
    "var(--warning-color)", "var(--a, var(--b, #fff))", "color-mix(in srgb, var(--primary-color) 40%, transparent)", "oklch(60% 0.2 30)"]) {
    assert.equal(chartSafeColor(color), color, color);
  }
  assert.equal(chartSafeColor("  teal "), "teal", "trimmed");
  for (const color of ["red;background:url(x)", "red;position:fixed", "red; position: fixed", "url(x)", "var(--a);color:red", "rgb(0,0,0);", "red}",
    "{red", "<b>", "red>", "\"red\"", "'red'", "rgb(0,0,0", "rgb(0,0,0))", "var(--a, url(x))", "color-mix(in srgb, url( x ), red)", "expression(alert(1))",
    "red blue", "re", "", "   ", "rgb(0,0,0;background:red)", "var(--a;--b:1)", "color-mix(in srgb, red 40%, blue);x:(y)", "var(--a)/*", "rgb(0 0 0) !important", "\\72 ed", "javascript:alert(1)", "#12", "#xyz"]) {
    assert.equal(chartSafeColor(color), undefined, color);
  }
  for (const value of [undefined, null, 7, {}, ["red"]]) assert.equal(chartSafeColor(value), undefined);
  // The period colour falls back to the tone default instead of passing a hostile value on.
  assert.equal(chartPeriodColor("warning", "red;background:url(x)"), chartPeriodColor("warning"));
  assert.equal(chartPeriodColor("planned", "red;position:fixed"), chartPeriodColor("planned"));
  assert.equal(chartPeriodColor("planned", "var(--car-colour)"), "var(--car-colour)");
});

test("chartPeriodText: the period label, the tone without one, and what a muted lane says", () => {
  const lane = { id: "xc40", label: "XC40" };
  assert.equal(chartPeriodText(lane, { label: "Charging", tone: "active" }), "XC40 Charging");
  assert.equal(chartPeriodText(lane, { tone: "extra" }), "XC40 extra", "the tone stands in for a missing label");
  assert.equal(chartPeriodText(lane, {}), "XC40 planned");
  // A paused plan must not read as if the car were charging.
  assert.equal(chartPeriodText({ ...lane, muted: true }, { label: "Charging", tone: "active" }), "XC40 Charging (paused)");
  assert.equal(chartPeriodText({ ...lane, muted: true }, { tone: "active" }), "XC40 active (paused)");
  assert.equal(chartPeriodText({ ...lane, muted: true, mutedLabel: "Paused" }, { label: "Charging" }), "XC40 Paused");
  assert.equal(chartPeriodText({ ...lane, mutedLabel: "Paused" }, { label: "Charging" }), "XC40 Charging", "the muted label needs a muted lane");
  assert.equal(chartPeriodText({ label: "" }, { label: "Charging" }), "Charging");
});

test("bands are clipped to the domain; the label shows only when the band is wide enough", () => {
  const model = layoutPlan({
    bands: [
      { start: MIDNIGHT + 4 * HOUR, end: MIDNIGHT + 9 * HOUR, label: "no price yet" },  // 2 h = 99.8 px, label 62.4 + 8
      { start: MIDNIGHT - HOUR, end: MIDNIGHT + HOUR, label: "no price yet", pattern: "tint" }, // 1 h = 49.9 px: too narrow
      { start: MIDNIGHT + 2 * HOUR, end: MIDNIGHT + 3 * HOUR },
      { start: MIDNIGHT + 7 * HOUR, end: MIDNIGHT + 8 * HOUR, label: "later" },          // outside
      { start: MIDNIGHT + 3 * HOUR, end: MIDNIGHT + 3 * HOUR },                          // empty
    ],
  });
  const { plot } = model;
  assert.equal(model.bands.length, 3);
  near(model.bands[0].x, model.x(MIDNIGHT + 4 * HOUR));
  near(model.bands[0].x + model.bands[0].width, plot.right, "clipped at the domain end");
  assert.deepEqual(model.bands[0].label, { x: model.bands[0].x + 4, y: plot.top + 8, text: "no price yet" });
  near(model.bands[1].x, plot.left, "clipped at the domain start");
  near(model.bands[1].width, model.x(MIDNIGHT + HOUR) - plot.left);
  assert.equal(model.bands[1].label, undefined, "49.9 px does not fit a 62.4 px label plus 8 px");
  assert.equal(model.bands[1].band.pattern, "tint");
  assert.equal(model.bands[2].label, undefined, "no label asked for");
  // Exactly label + 8 px wide is enough; a character more is not. The label's expected width
  // counts (5.6 px per lowercase letter), not the wider reserve the axis labels use.
  const width = (label) => estimateTextWidth(label, "typical") + CHART_LABEL_GAP_PX;
  const hourPx = model.x(MIDNIGHT + HOUR) - model.x(MIDNIGHT);
  const fit = "x".repeat(Math.floor((2 * hourPx - CHART_LABEL_GAP_PX) / 5.6));
  assert.ok(estimateLabelWidth(fit) + CHART_LABEL_GAP_PX > 2 * hourPx, "the per-character estimate would have dropped it");
  assert.ok(width(fit) <= 2 * hourPx && width(`${fit}x`) > 2 * hourPx);
  const edge = (label) => layoutPlan({ bands: [{ start: MIDNIGHT, end: MIDNIGHT + 2 * HOUR, label }] }).bands[0].label;
  assert.equal(edge(fit).text, fit);
  assert.equal(edge(`${fit}x`), undefined);
});

test("markers span the plot inside the domain; the label goes to the side with more room", () => {
  const model = layoutPlan({
    markers: [
      { t: MIDNIGHT + HOUR, label: "Cheap from", dash: true },
      { t: MIDNIGHT + 5 * HOUR, label: "Day tariff", color: "tomato" },
      { t: MIDNIGHT + 3 * HOUR },
      { t: MIDNIGHT - 1, label: "before" },
      { t: MIDNIGHT + 6 * HOUR + 1, label: "after" },
      { t: Number.NaN },
      { t: MIDNIGHT + 6 * HOUR, label: "End" },
    ],
  });
  assert.equal(model.markers.length, 4, "markers outside the domain are not drawn");
  const [left, right, bare, end] = model.markers;
  near(left.x, model.x(MIDNIGHT + HOUR));
  assert.deepEqual(left.label, { x: left.x + 4, y: CHART_MARGIN.top - 7, text: "Cheap from", anchor: "start" });
  assert.equal(left.marker.dash, true);
  near(right.x, model.x(MIDNIGHT + 5 * HOUR));
  assert.deepEqual(right.label, { x: right.x - 4, y: CHART_MARGIN.top - 7, text: "Day tariff", anchor: "end" });
  assert.equal(right.marker.color, "tomato");
  assert.ok(right.label.y < model.plot.top - 5, "above the plot: clear of the bars and the H/L marks inside it");
  near(bare.x, model.x(MIDNIGHT + 3 * HOUR));
  assert.equal(bare.label, undefined);
  near(end.x, model.plot.right, "the domain end is inside");
  assert.equal(end.label.anchor, "end");
});

test("lanes, bands and markers never extend the domain", () => {
  const extras = {
    lanes: [{ id: "car", label: "Car", periods: [{ start: MIDNIGHT - 5 * HOUR, end: MIDNIGHT + 30 * HOUR }], marker: { t: MIDNIGHT + 40 * HOUR } }],
    bands: [{ start: MIDNIGHT - 9 * HOUR, end: MIDNIGHT + 50 * HOUR }],
    markers: [{ t: MIDNIGHT + 60 * HOUR }],
  };
  const model = layoutPlan({ domain: undefined, ...extras });
  assert.deepEqual(model.x.domain, [MIDNIGHT, MIDNIGHT + 6 * HOUR], "the series data define it");
  assert.deepEqual(model.x.domain, layoutPlan({ domain: undefined }).x.domain);
  near(model.lanes[0].periods[0].x, model.plot.left);
  near(model.lanes[0].periods[0].width, model.plot.right - model.plot.left);
  assert.equal(model.lanes[0].marker, undefined);
  near(model.bands[0].width, model.plot.right - model.plot.left);
  assert.deepEqual(model.markers, []);
});

test("a marker label that does not fit over the plot beside its line is dropped", () => {
  const label = (markers, width = 360) => layoutPlan({ markers }, { width }).markers.map((entry) => entry.label && `${entry.label.anchor}:${entry.label.text}`);
  const model = layoutPlan();
  const long = "Day tariff starts and the plan";
  const width = estimateTextWidth(long);
  // Near the left edge the label goes right, the side with more room, and fits there.
  const early = layoutPlan({ markers: [{ t: MIDNIGHT + HOUR, label: long }] }).markers[0];
  assert.equal(early.label.anchor, "start");
  assert.ok(early.label.x + width <= model.plot.right);
  // In the middle neither side has the room: the line stays, the label goes.
  const middle = layoutPlan({ markers: [{ t: MIDNIGHT + 3.2 * HOUR, label: long }] }).markers[0];
  assert.ok(middle.x - 4 - width < model.plot.left && middle.x + 4 + width > model.plot.right);
  near(middle.x, model.x(MIDNIGHT + 3.2 * HOUR));
  assert.equal(middle.label, undefined);
  // A label stays over the plot: the gutters hold the top axis labels at almost the same height.
  const atEnd = layoutPlan({ markers: [{ t: MIDNIGHT + 6 * HOUR, label: "End" }] }).markers[0];
  assert.equal(atEnd.label.anchor, "end");
  near(atEnd.label.x, model.plot.right - 4);
  const gutter = layoutPlan({ markers: [{ t: MIDNIGHT + 5 * HOUR, label: "Day tariff" }, { t: MIDNIGHT + 5.9 * HOUR, label: "End of plan" }] }).markers[1];
  assert.equal(gutter.label, undefined, "left it would run into the first label, right into the axis labels: dropped");
  const atStart = layoutPlan({ markers: [{ t: MIDNIGHT, label: "Start" }] }).markers[0];
  assert.deepEqual([atStart.label.anchor, atStart.label.x], ["start", model.plot.left + 4]);
  // A narrow chart has no room for a long label at all.
  assert.deepEqual(label([{ t: MIDNIGHT + HOUR, label: long }], 200), [undefined]);
  assert.deepEqual(label([{ t: MIDNIGHT + HOUR, label: "Peak" }], 200), ["start:Peak"]);
});

test("marker labels are placed in time order and never closer than 8 px to one another", () => {
  const first = { t: MIDNIGHT + 2 * HOUR, label: "Night tariff" };
  const second = { t: MIDNIGHT + 2.2 * HOUR, label: "Cheapest" };
  const third = { t: MIDNIGHT + 5.5 * HOUR, label: "Ready" };
  // Given out of time order: the earlier marker still gets its label first.
  const model = layoutPlan({ markers: [third, second, first] });
  assert.deepEqual(model.markers.map((entry) => entry.marker), [third, second, first], "the caller's order is the draw order");
  const [ready, cheapest, night] = model.markers;
  assert.equal(night.label.anchor, "start");
  assert.equal(ready.label.anchor, "end");
  // "Cheapest" would start 10 px into "Night tariff" on the right, and has no room on the left
  // of its line either (it would end 4 px before a label that starts 10 px earlier): dropped.
  assert.equal(cheapest.label, undefined);
  near(cheapest.x, model.x(second.t));
  // A marker far enough away keeps its label: at least 8 px between the two.
  const apart = layoutPlan({ markers: [first, { ...second, t: MIDNIGHT + 4 * HOUR }] }).markers;
  const extent = ({ label }) => (label.anchor === "start" ? [label.x, label.x + estimateTextWidth(label.text)] : [label.x - estimateTextWidth(label.text), label.x]);
  assert.ok(apart[1].label);
  assert.ok(extent(apart[1])[0] - extent(apart[0])[1] >= CHART_LABEL_GAP_PX);
  // The gap is 8 px, as between time labels: 4 px after an earlier label is too close, 8.5 px is not.
  const base = layoutPlan();
  const nightEnd = base.x(MIDNIGHT + HOUR) + 4 + estimateTextWidth("Night");
  const close = (gap) => layoutPlan({ markers: [{ t: MIDNIGHT + HOUR, label: "Night" }, { t: base.x.invert(nightEnd + gap - 4), label: "Cheap" }] }).markers[1];
  assert.equal(close(4).label, undefined, "4 px from the first label, and no room left of its own line");
  assert.equal(close(7.5).label, undefined);
  assert.equal(close(8.5).label.anchor, "start");
  near(close(8.5).label.x, nightEnd + 8.5);
  // A label that collides on its preferred side takes the other one when that is free.
  const dodge = layoutPlan({ markers: [{ t: MIDNIGHT + 3.5 * HOUR, label: "Peak" }, { t: MIDNIGHT + 3.6 * HOUR, label: "Cut-off" }] }).markers;
  assert.equal(dodge[0].label.anchor, "end", "past the middle: to the left");
  assert.equal(dodge[1].label.anchor, "start", "to the right of its own line instead of over the first label");
});

test("lanes, bands and markers never extend the domain", () => {
  const extras = {
    lanes: [{ id: "car", label: "Car", periods: [{ start: MIDNIGHT - 5 * HOUR, end: MIDNIGHT + 30 * HOUR }], marker: { t: MIDNIGHT + 40 * HOUR } }],
    bands: [{ start: MIDNIGHT - 9 * HOUR, end: MIDNIGHT + 50 * HOUR }],
    markers: [{ t: MIDNIGHT + 60 * HOUR }],
  };
  const model = layoutPlan({ domain: undefined, ...extras });
  assert.deepEqual(model.x.domain, [MIDNIGHT, MIDNIGHT + 6 * HOUR], "the series data define it");
  assert.deepEqual(model.x.domain, layoutPlan({ domain: undefined }).x.domain);
  near(model.lanes[0].periods[0].x, model.plot.left);
  near(model.lanes[0].periods[0].width, model.plot.right - model.plot.left);
  assert.equal(model.lanes[0].marker, undefined);
  near(model.bands[0].width, model.plot.right - model.plot.left);
  assert.deepEqual(model.markers, []);
});

/** Prices for the first six of ten hours: the plan runs four hours past the last published price. */
const longPlan = (overrides = {}) => planChart({
  domain: { start: MIDNIGHT, end: MIDNIGHT + 10 * HOUR },
  lanes: [{
    id: "xc40",
    label: "XC40",
    periods: [{ start: MIDNIGHT + 7 * HOUR, end: MIDNIGHT + 9 * HOUR, tone: "warning", label: "Not enough time" }],
    marker: { t: MIDNIGHT + 9.5 * HOUR, label: "Ready by 09:30" },
  }],
  bands: [{ start: MIDNIGHT + 6 * HOUR, end: MIDNIGHT + 10 * HOUR, label: "no price yet" }],
  ...overrides,
});
const layoutLong = (overrides, state = {}) =>
  layoutTimeSeriesChart(longPlan(overrides), { width: 360, now: MIDNIGHT + 2.5 * HOUR, ...state });

test("with lanes the selection walks interval slots across the whole domain, also where there is no value", () => {
  const model = layoutLong();
  assert.deepEqual(model.steps, Array.from({ length: 10 }, (_, hour) => MIDNIGHT + hour * HOUR), "six priced hours and four slots after them");
  assert.equal(model.selectable.length, 6, "the series points are still listed");
  assert.equal(model.intervalSelection, true);
  // An hour after the last price: the cursor stands in its middle and the value is empty.
  const late = layoutLong({}, { selectedT: MIDNIGHT + 8 * HOUR }).selection;
  assert.equal(late.t, MIDNIGHT + 8 * HOUR);
  assert.equal(late.index, 8);
  assert.equal(late.followsNow, false);
  near(late.x, model.x(MIDNIGHT + 8.5 * HOUR));
  assert.deepEqual(late.values.map((value) => [value.series.id, value.point, value.y]), [["price", undefined, undefined]]);
  assert.deepEqual(late.range, { start: MIDNIGHT + 8 * HOUR, end: MIDNIGHT + 9 * HOUR });
  assert.equal(late.periods[0].period.label, "Not enough time", "the period in an hour without a price can be read");
  // Any time inside a slot selects that slot.
  const inside = layoutLong({}, { selectedT: MIDNIGHT + 8.7 * HOUR }).selection;
  assert.deepEqual([inside.t, inside.index], [MIDNIGHT + 8 * HOUR, 8]);
  // An hour with a price reads as before: the bar's interval, its value and the dot.
  const priced = layoutLong({}, { selectedT: MIDNIGHT + 4 * HOUR }).selection;
  assert.equal(priced.index, 4);
  assert.equal(priced.values[0].point.v, 0.3);
  near(priced.x, model.x(MIDNIGHT + 4.5 * HOUR));
  assert.equal(priced.periods[0].period, undefined);
  // The ends of the domain are the first and the last slot.
  assert.equal(model.steps.at(-1), MIDNIGHT + 9 * HOUR);
  assert.deepEqual(layoutLong({}, { selectedT: model.steps.at(-1) }).selection.range, { start: MIDNIGHT + 9 * HOUR, end: MIDNIGHT + 10 * HOUR });
});

test("interval slots fill gaps on the grid of the next point and keep every point selectable", () => {
  const series = (hours) => [{ ...planChart().series[0], points: hours.map((hour) => ({ t: MIDNIGHT + hour * HOUR, v: 0.1 + hour / 100 })) }];
  const steps = (hours, domainHours = [0, 6]) => layoutLong({
    series: series(hours),
    domain: { start: MIDNIGHT + domainHours[0] * HOUR, end: MIDNIGHT + domainHours[1] * HOUR },
  }).steps.map((t) => (t - MIDNIGHT) / HOUR);
  assert.deepEqual(steps([0, 1, 3, 4]), [0, 1, 2, 3, 4, 5], "a missing hour and the hour after the data are slots too");
  assert.deepEqual(steps([2, 3]), [0, 1, 2, 3, 4, 5], "so are the hours before the first point");
  // Half-hour phase: the gap before the first point ends on its grid, so the first slot is a short one.
  assert.deepEqual(steps([1.5, 2.5]), [0, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5]);
  // A first interval that began before the window is still the first step.
  assert.deepEqual(steps([-0.5, 0.5, 1.5], [0, 3]), [-0.5, 0.5, 1.5, 2.5]);
  const early = layoutLong({ series: series([-0.5, 0.5, 1.5]), domain: { start: MIDNIGHT, end: MIDNIGHT + 3 * HOUR } }, { selectedT: MIDNIGHT - 0.5 * HOUR }).selection;
  assert.equal(early.index, 0);
  assert.equal(early.values[0].point.t, MIDNIGHT - 0.5 * HOUR, "its value is read, not dropped as outside the window");
  // The short first slot of a half-hour phase reads no value and ends where the first bar begins.
  const short = layoutLong({ series: series([1.5, 2.5]), domain: { start: MIDNIGHT, end: MIDNIGHT + 6 * HOUR } }, { selectedT: MIDNIGHT + 0.6 * HOUR }).selection;
  assert.deepEqual(short.range, { start: MIDNIGHT + 0.5 * HOUR, end: MIDNIGHT + 1.5 * HOUR });
  assert.equal(short.values[0].point, undefined);
  // An absurd interval for the window does not generate thousands of slots.
  const tiny = layoutLong({ series: [{ ...planChart().series[0], intervalMs: 1000, points: [{ t: MIDNIGHT, v: 1 }, { t: MIDNIGHT + 1000, v: 2 }] }] });
  assert.equal(tiny.steps.length, 2, "only the points");
});

test("following now on a chart with lanes reads the exact now, also in an hour without a value", () => {
  // 02:30 with the 02:00 price missing: 1.7.0 snaps back to 01:00; with lanes the cursor stays on now.
  const gap = { series: [{ ...planChart().series[0], points: [-0.05, 0.1, null, 0.25, 0.3, 0.2].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })) }] };
  const without = layoutPlan(gap).selection;
  assert.equal(without.t, MIDNIGHT + HOUR, "without lanes: the last hour with a price, as in 1.7.0");
  const model = layoutLong(gap);
  const now = model.selection;
  assert.equal(now.followsNow, true);
  assert.equal(now.t, MIDNIGHT + 2.5 * HOUR);
  near(now.x, model.x(MIDNIGHT + 2.5 * HOUR));
  assert.equal(now.index, 2);
  assert.equal(now.values[0].point, undefined);
  assert.deepEqual(now.range, { start: MIDNIGHT + 2.5 * HOUR, end: MIDNIGHT + 2.5 * HOUR }, "a single time, not the hour");
  // With a price in that hour the value is read at now.
  const priced = layoutLong().selection;
  assert.equal(priced.t, MIDNIGHT + 2.5 * HOUR);
  assert.equal(priced.values[0].point.v, 0.15);
  // Now after the window: the last slot stands in; before it: the first.
  const after = layoutLong({}, { now: MIDNIGHT + 48 * HOUR }).selection;
  assert.deepEqual([after.index, after.t], [9, MIDNIGHT + 9 * HOUR]);
  assert.equal(after.periods[0].period, undefined);
  const before = layoutLong({}, { now: MIDNIGHT - 48 * HOUR }).selection;
  assert.deepEqual([before.index, before.t], [0, MIDNIGHT]);
  assert.equal(before.values[0].point.v, -0.05);
  assert.equal(layoutLong({}, { now: MIDNIGHT + 48 * HOUR }).now, undefined);
});

test("a time picked outside the window by another chart of the group stops at the edge and reads nothing", () => {
  const model = layoutLong({ lanes: [{ id: "xc40", label: "XC40", periods: [{ start: MIDNIGHT, end: MIDNIGHT + 40 * HOUR }] }] }, { selectedT: MIDNIGHT + 20 * HOUR });
  const selection = model.selection;
  assert.equal(selection.t, MIDNIGHT + 20 * HOUR);
  near(selection.x, model.plot.right);
  assert.equal(selection.index, 9);
  assert.equal(selection.values[0].point, undefined);
  assert.equal(selection.periods[0].period, undefined, "the drawn part of the period ends at the window");
  const early = layoutLong({}, { selectedT: MIDNIGHT - 3 * HOUR }).selection;
  assert.equal(early.index, 0);
  near(early.x, model.plot.left);
  assert.equal(early.values[0].point, undefined);
});

test("a line chart with lanes steps over samples, the time without samples, period boundaries and lane markers", () => {
  const options = (overrides = {}) => planChart({
    domain: { start: MIDNIGHT, end: MIDNIGHT + 8 * HOUR },
    series: [
      { id: "soc", label: "Charge", points: [20, 30, 40, 50].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })), format: String },
      { id: "limit", label: "Limit", emphasis: "secondary", points: [{ t: MIDNIGHT, v: 80 }, { t: MIDNIGHT + 7 * HOUR, v: 90 }], format: String },
    ],
    axes: { primary: { format: String } },
    lanes: [{
      id: "xc40",
      label: "XC40",
      periods: [{ start: MIDNIGHT + 5 * HOUR + 20 * 60_000, end: MIDNIGHT + 6 * HOUR + 10 * 60_000, label: "Planned" }],
      marker: { t: MIDNIGHT + 7.25 * HOUR, label: "Ready" },
    }],
    ...overrides,
  });
  const layout = (state = {}, overrides) => layoutTimeSeriesChart(options(overrides), { width: 360, now: MIDNIGHT + HOUR, ...state });
  const hours = (model) => model.steps.map((t) => +((t - MIDNIGHT) / HOUR).toFixed(4));
  const model = layout();
  assert.equal(model.intervalSelection, false);
  // Samples 0–3 h, hourly steps where there are none, the period's start and end, the lane marker, the domain end.
  assert.deepEqual(hours(model), [0, 1, 2, 3, 4, 5, 5.3333, 6, 6.1667, 7, 7.25, 8]);
  // A sample: value and dot as before.
  const sample = layout({ selectedT: MIDNIGHT + 2 * HOUR }).selection;
  assert.deepEqual([sample.t, sample.index, sample.values[0].point.v], [MIDNIGHT + 2 * HOUR, 2, 40]);
  assert.deepEqual(sample.range, { start: sample.t, end: sample.t });
  assert.equal(sample.periods[0].period, undefined);
  // A time picks its nearest step; the period start is one, with no sample near it.
  const start = layout({ selectedT: MIDNIGHT + 5.4 * HOUR }).selection;
  assert.equal(start.t, MIDNIGHT + 5 * HOUR + 20 * 60_000);
  assert.equal(start.index, 6);
  near(start.x, model.x(start.t));
  assert.equal(start.values[0].point, undefined, "three hours after the last sample is not that sample");
  assert.equal(start.values[1].point, undefined, "nor the limit set at midnight");
  assert.equal(start.periods[0].period.label, "Planned");
  const end = layout({ selectedT: MIDNIGHT + 6 * HOUR + 10 * 60_000 }).selection;
  assert.equal(end.periods[0].period, undefined, "the end is exclusive");
  // The second series is read where it has a sample within half a step.
  assert.equal(layout({ selectedT: MIDNIGHT + 7 * HOUR }).selection.values[1].point.v, 90);
  assert.equal(layout({ selectedT: MIDNIGHT + 7 * HOUR }).selection.values[0].point, undefined);
  // Following now picks the nearest step, as a line chart always did; the domain ends are steps.
  assert.equal(layout({ now: MIDNIGHT + 1.2 * HOUR }).selection.t, MIDNIGHT + HOUR);
  assert.equal(layout({ now: MIDNIGHT + 99 * HOUR }).selection.t, MIDNIGHT + 8 * HOUR);
  assert.equal(layout({ now: MIDNIGHT - 99 * HOUR }).selection.t, MIDNIGHT);
  // Samples with a hole: the hole is walked at the usual spacing.
  const holed = layout({}, { series: [{ id: "soc", label: "Charge", points: [0, 1, 2, 6, 7, 8].map((hour) => ({ t: MIDNIGHT + hour * HOUR, v: hour })), format: String }], lanes: [{ id: "a", label: "A", periods: [] }] });
  assert.deepEqual(hours(holed), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  // An explicit maxGapMs still decides how far a sample reaches.
  const reach = layout({ selectedT: MIDNIGHT + 4 * HOUR }, { series: [{ ...options().series[0], maxGapMs: 4 * HOUR }] }).selection;
  assert.equal(reach.values[0].point.v, 50, "within maxGapMs / 2 of the 03:00 sample");
});

test("selection.periods: a selected interval reads the period that overlaps it most; following now, the one at now", () => {
  const charging = { start: MIDNIGHT + HOUR, end: MIDNIGHT + 3 * HOUR, tone: "active", label: "Charging" };
  const later = { start: MIDNIGHT + 3 * HOUR, end: MIDNIGHT + 4 * HOUR, tone: "extra" };
  const lanes = [
    { id: "xc40", label: "XC40", periods: [charging, later] },
    { id: "ex30", label: "EX30", periods: [{ start: MIDNIGHT + 5 * HOUR, end: MIDNIGHT + 6 * HOUR }] },
  ];
  const at = (selectedT, list = lanes) => layoutPlan({ lanes: list }, { selectedT }).selection.periods;
  const inside = at(MIDNIGHT + 2 * HOUR);
  assert.equal(inside.length, 2, "one entry per lane");
  assert.equal(inside[0].lane, lanes[0]);
  assert.equal(inside[0].period, charging);
  assert.equal(inside[1].lane, lanes[1]);
  assert.equal(inside[1].period, undefined, "EX30 has nothing at 02:00");
  assert.equal(at(MIDNIGHT + HOUR)[0].period, charging, "the start is inclusive");
  assert.equal(at(MIDNIGHT + 3 * HOUR)[0].period, later, "the end is exclusive: the next period takes over");
  assert.equal(at(MIDNIGHT + 4 * HOUR)[0].period, undefined, "the end is exclusive");
  assert.equal(at(MIDNIGHT)[0].period, undefined);
  assert.equal(at(MIDNIGHT + 5 * HOUR)[1].period, lanes[1].periods[0]);
  // Following now inside an interval selects now itself (02:30), which is inside the charging period.
  const following = layoutPlan({ lanes }).selection;
  assert.equal(following.followsNow, true);
  assert.equal(following.t, MIDNIGHT + 2.5 * HOUR);
  assert.equal(following.periods[0].period, charging);

  // The cursor of a bar stands in the middle of its hour, so the hour is read as a whole: a
  // period that starts at 02:15 belongs to the 02:00 bar, though it does not contain 02:00.
  const quarter = { start: MIDNIGHT + 2.25 * HOUR, end: MIDNIGHT + 2.9 * HOUR, label: "Charging 02:15" };
  const ended = { start: MIDNIGHT + 1.4 * HOUR, end: MIDNIGHT + 2.1 * HOUR, label: "Ended 02:06" };
  assert.equal(at(MIDNIGHT + 2 * HOUR, [{ id: "a", label: "A", periods: [quarter] }])[0].period, quarter);
  assert.equal(at(MIDNIGHT + 2 * HOUR, [{ id: "a", label: "A", periods: [ended, quarter] }])[0].period, quarter, "39 minutes of the hour beat 6");
  assert.equal(at(MIDNIGHT + 2 * HOUR, [{ id: "a", label: "A", periods: [quarter, ended] }])[0].period, quarter, "whatever their order");
  assert.equal(at(MIDNIGHT + HOUR, [{ id: "a", label: "A", periods: [ended, quarter] }])[0].period, ended);
  // Two halves of the hour tie: the later one wins.
  const firstHalf = { start: MIDNIGHT + 2 * HOUR, end: MIDNIGHT + 2.5 * HOUR, label: "first" };
  const secondHalf = { start: MIDNIGHT + 2.5 * HOUR, end: MIDNIGHT + 3 * HOUR, label: "second" };
  assert.equal(at(MIDNIGHT + 2 * HOUR, [{ id: "a", label: "A", periods: [firstHalf, secondHalf] }])[0].period, secondHalf);
  // Following now reads the exact now instead: 02:30 is in the second half, 02:20 in the first.
  const nowAt = (now) => layoutPlan({ lanes: [{ id: "a", label: "A", periods: [firstHalf, secondHalf] }] }, { now }).selection.periods[0].period;
  assert.equal(nowAt(MIDNIGHT + 2.5 * HOUR), secondHalf);
  assert.equal(nowAt(MIDNIGHT + 2 * HOUR + 20 * 60_000), firstHalf);
});

test("of overlapping periods the last one, drawn on top, is the one the selection reads", () => {
  const under = { start: MIDNIGHT + HOUR, end: MIDNIGHT + 6 * HOUR, label: "under" };
  const onTop = { start: MIDNIGHT + 2 * HOUR, end: MIDNIGHT + 4 * HOUR, tone: "warning", label: "on top" };
  const read = (periods, state) => layoutPlan({ lanes: [{ id: "a", label: "A", periods }] }, state).selection.periods[0].period;
  assert.equal(read([under, onTop], { selectedT: MIDNIGHT + 3 * HOUR }), onTop);
  assert.equal(read([onTop, under], { selectedT: MIDNIGHT + 3 * HOUR }), under, "the order decides, as it does on screen");
  assert.equal(read([under, onTop], { selectedT: MIDNIGHT + 5 * HOUR }), under);
  // The same while following now (02:30).
  assert.equal(read([under, onTop]), onTop);
  assert.equal(read([onTop, under]), under);
});

test("a chart with only bands, lanes and markers is still empty, at the total height", () => {
  const model = layoutPlan({
    series: [{ ...planChart().series[0], points: [{ t: MIDNIGHT, v: null }] }],
    lanes: [{ id: "car", label: "Car", periods: [{ start: MIDNIGHT, end: MIDNIGHT + HOUR }] }],
    bands: [{ start: MIDNIGHT, end: MIDNIGHT + 6 * HOUR, label: "no price yet" }],
    markers: [{ t: MIDNIGHT + HOUR }],
  });
  assert.equal(model.empty, true);
  assert.equal(model.selection, undefined);
  assert.deepEqual(model.lanes, []);
  assert.deepEqual(model.bands, []);
  assert.deepEqual(model.markers, []);
  assert.equal(model.height, 190);
  assert.equal(model.totalHeight, 218, "the empty state keeps the height the chart will have");
  const bandsOnly = layoutPlan({ series: [], bands: [{ start: MIDNIGHT, end: MIDNIGHT + HOUR }] });
  assert.equal(bandsOnly.empty, true, "a band is not data");
  assert.equal(bandsOnly.totalHeight, 190);
});
