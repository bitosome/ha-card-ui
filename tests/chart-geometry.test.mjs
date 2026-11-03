import assert from "node:assert/strict";
import { test } from "node:test";
// Pure geometry: no DOM, no Lit. Importing the module directly proves it.
const {
  CHART_LABEL_CHAR_PX,
  CHART_LABEL_GAP_PX,
  CHART_AXIS_GAP_PX,
  CHART_MARGIN,
  CHART_FRAME_CHROME_PX,
  DEFAULT_TICK_STEPS_MS,
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
