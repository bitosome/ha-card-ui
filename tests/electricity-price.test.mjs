import assert from "node:assert/strict";
import { test } from "node:test";
// Pure helpers: no DOM, no Lit.
const {
  ELECTRICITY_PRICE_CHART_HOURS,
  ELECTRICITY_PRICE_ENTITIES,
  ELECTRICITY_PRICE_TICK_STEPS_MS,
  electricityPriceCheapLimit,
  electricityPriceDomain,
  electricityPricePoints,
  electricityPriceSensorPoints,
  electricityPriceSeries,
  electricityPriceTimeLabel,
  homeMidnight,
} = await import("../dist/electricity-price.js");
const { ELECTRICITY_PRICE_COLORS, layoutTimeSeriesChart } = await import("../dist/chart-geometry.js");

const HOUR = 3600000;
const tallinn = { config: { time_zone: "Europe/Tallinn" }, locale: { language: "en-GB", time_format: "24" } };
const iso = (time) => new Date(time).toISOString();
const sensor = (start, prices, extra = {}) => ({
  state: "ok",
  attributes: {
    hourly_prices: prices.map((price, index) => ({
      start_time: iso(start + index * HOUR), end_time: iso(start + (index + 1) * HOUR), nord_pool_price: price / 2, actual_price: price, ...extra,
    })),
  },
});

test("the window is today's midnight in the home time zone and 48 hours", () => {
  // 11 Nov 2026 11:00 in Tallinn (UTC+2).
  const now = Date.UTC(2026, 10, 11, 9, 0);
  const midnight = Date.UTC(2026, 10, 10, 22, 0);
  assert.equal(homeMidnight(tallinn, now), midnight);
  assert.deepEqual(electricityPriceDomain(tallinn, now), { start: midnight, end: midnight + 48 * HOUR });
  assert.equal(ELECTRICITY_PRICE_CHART_HOURS, 48);
  // Just before and at local midnight.
  assert.equal(homeMidnight(tallinn, midnight - 1), midnight - 24 * HOUR);
  assert.equal(homeMidnight(tallinn, midnight), midnight);
  // The day the clocks go back (25 Oct 2026) starts at UTC+3 and is 25 hours long.
  const autumn = Date.UTC(2026, 9, 25, 12, 0);
  assert.equal(homeMidnight(tallinn, autumn), Date.UTC(2026, 9, 24, 21, 0));
  // The day they go forward (29 Mar 2026) starts at UTC+2.
  assert.equal(homeMidnight(tallinn, Date.UTC(2026, 2, 29, 12, 0)), Date.UTC(2026, 2, 28, 22, 0));
  // Another zone, and an unknown one falls back to the browser's midnight.
  assert.equal(homeMidnight({ config: { time_zone: "America/New_York" } }, now), Date.UTC(2026, 10, 11, 5, 0));
  const local = new Date(now);
  local.setHours(0, 0, 0, 0);
  assert.equal(homeMidnight({ config: { time_zone: "Nowhere/Nothing" } }, now), local.getTime());
  assert.equal(homeMidnight(undefined, now), local.getTime());
});

test("sensor rows become points: the paid price first, pairs and bad rows handled", () => {
  const start = Date.UTC(2026, 10, 10, 23, 0);
  const points = electricityPriceSensorPoints(sensor(start, [0.3445, 0.2599]));
  assert.deepEqual(points.map((point) => [point.t, point.v]), [[start, 0.3445], [start + HOUR, 0.2599]]);
  assert.deepEqual(points[0].data, { start, end: start + HOUR });
  const mixed = electricityPriceSensorPoints({ attributes: { hourly_prices: [
    [start + 2 * HOUR, "0.2"], { x: start + HOUR, y: 0.1 }, { start_time: iso(start), price: 0.05 },
    { start_time: iso(start + 3 * HOUR), nord_pool_price: 0.4 }, { start_time: "soon", actual_price: 1 }, { start_time: iso(start), actual_price: null }, null,
  ] } });
  assert.deepEqual(mixed.map((point) => [point.t - start, point.v]), [[0, 0.05], [HOUR, 0.1], [2 * HOUR, 0.2], [3 * HOUR, 0.4]], "sorted, bad rows dropped");
  assert.deepEqual(electricityPriceSensorPoints(undefined), []);
  assert.deepEqual(electricityPriceSensorPoints({ attributes: { hourly_prices: "none" } }), []);
});

test("points of yesterday, today and tomorrow inside the window; missing sensors are named", () => {
  const now = Date.UTC(2026, 10, 11, 9, 0);
  const midnight = Date.UTC(2026, 10, 10, 22, 0);
  // The sensors hold market days (CET), so each starts at 01:00 Tallinn time.
  const states = {
    [ELECTRICITY_PRICE_ENTITIES.yesterday]: sensor(midnight - 23 * HOUR, Array.from({ length: 24 }, () => 0.5)),
    [ELECTRICITY_PRICE_ENTITIES.today]: sensor(midnight + HOUR, Array.from({ length: 24 }, (_, index) => 0.1 + index / 100)),
  };
  const data = electricityPricePoints({ ...tallinn, states }, { now });
  assert.equal(data.points.length, 25, "the 00:00 hour comes from yesterday's sensor");
  assert.deepEqual([data.points[0].t, data.points[0].v], [midnight, 0.5]);
  assert.equal(data.points[1].v, 0.1);
  assert.deepEqual(data.missing, [ELECTRICITY_PRICE_ENTITIES.tomorrow]);
  assert.equal(data.entityId, ELECTRICITY_PRICE_ENTITIES.today);

  const tomorrow = { ...states, "sensor.t": sensor(midnight + 24 * HOUR, [0.9, 0.8]) };
  const both = electricityPricePoints({ ...tallinn, states: tomorrow }, { now, entities: { tomorrow: "sensor.t" } });
  assert.equal(both.points.length, 26, "one point per hour");
  assert.equal(both.points.find((point) => point.t === midnight + 24 * HOUR).v, 0.9, "tomorrow's sensor wins over today's last hour");
  assert.deepEqual(both.missing, []);

  const none = electricityPricePoints({ ...tallinn, states: {} }, { now });
  assert.deepEqual(none, { points: [], missing: [ELECTRICITY_PRICE_ENTITIES.today, ELECTRICITY_PRICE_ENTITIES.tomorrow], entityId: undefined });
  assert.deepEqual(electricityPricePoints(undefined, { now }).points, []);
  // An explicit domain.
  const narrow = electricityPricePoints({ ...tallinn, states }, { domain: { start: midnight + HOUR, end: midnight + 3 * HOUR } });
  assert.deepEqual(narrow.points.map((point) => point.t), [midnight + HOUR, midnight + 2 * HOUR]);
});

test("the cheap limit is the acceptable price, or another number entity", () => {
  const states = { [ELECTRICITY_PRICE_ENTITIES.cheap]: { state: "0.16" }, "number.other": { state: "0.2" }, "number.off": { state: "unavailable" } };
  assert.equal(electricityPriceCheapLimit({ states }), 0.16);
  assert.equal(electricityPriceCheapLimit({ states }, "number.other"), 0.2);
  assert.equal(electricityPriceCheapLimit({ states }, "number.off"), undefined);
  assert.equal(electricityPriceCheapLimit({ states }, "number.none"), undefined);
  assert.equal(electricityPriceCheapLimit(undefined), undefined);
});

test("the series is hourly bars in the price colours with H and L, and lays out in the window", () => {
  const now = Date.UTC(2026, 10, 11, 9, 30);
  const domain = electricityPriceDomain(tallinn, now);
  const points = Array.from({ length: 24 }, (_, index) => ({ t: domain.start + index * HOUR, v: index === 3 ? 0.1 : 0.3 + index / 100 }));
  const series = electricityPriceSeries({ points, now, cheap: 0.16, format: (value) => `${value} €/kWh` });
  assert.deepEqual([series.id, series.label, series.kind, series.curve, series.intervalMs, series.extremes, series.barFit], ["price", "Price", "bar", "step", HOUR, true, undefined]);
  assert.equal(series.colorAt(points[2]), ELECTRICITY_PRICE_COLORS.past);
  assert.equal(series.colorAt(points[3]), ELECTRICITY_PRICE_COLORS.cheapPast);
  assert.equal(series.colorAt(points[11]), ELECTRICITY_PRICE_COLORS.current);
  assert.equal(series.colorAt(points[12]), ELECTRICITY_PRICE_COLORS.future);
  assert.equal(series.format(0.3), "0.3 €/kWh");
  assert.equal("areaColor" in series, false);
  const line = electricityPriceSeries({ points, now, kind: "line", extremes: false, areaColor: "teal", colors: { future: "#123456" }, format: String });
  assert.deepEqual([line.kind, line.extremes, line.areaColor, line.colorAt(points[12])], ["line", false, "teal", "#123456"]);

  const model = layoutTimeSeriesChart({
    id: "price", label: "Price", series: [series], domain, height: 140, now, hass: tallinn,
    axes: { primary: { includeZero: true, decimals: 2, format: (value) => value.toFixed(2) } },
    tickStepsMs: ELECTRICITY_PRICE_TICK_STEPS_MS, timeLabel: (time) => electricityPriceTimeLabel(tallinn, time),
  }, { width: 360, now });
  assert.deepEqual(model.x.domain, [domain.start, domain.end]);
  assert.ok(model.ticks.length >= 2);
  assert.match(model.ticks[0].text, /^11 Nov/);
  assert.match(electricityPriceTimeLabel(tallinn, domain.start), /^11 Nov.*0:00$/);
  assert.deepEqual(ELECTRICITY_PRICE_TICK_STEPS_MS.map((step) => step / HOUR), [6, 8, 12, 16, 24, 48]);
});
