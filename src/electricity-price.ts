// The electricity price chart every card draws the same way: a fixed two-day window from
// today's midnight in the home time zone, one bar per hour in the shared price colours, H and L,
// and the day-and-time labels. The Real Electricity Price card is the reference; a card that
// adds its own rows under the prices (charging periods) uses the same window, data and series.
//
// Pure functions without lit, so they run in node tests.

import {
  electricityPriceColor,
  type ChartDomain,
  type ChartPoint,
  type ChartSeries,
  type ElectricityPriceColors,
} from "./chart-geometry.js";
import { formatHassDateTime, hassTimeZone, type FormatHass } from "./format.js";

const HOUR_MS = 60 * 60 * 1000;

/** The Real Electricity Price integration's entities, the defaults of every card that reads prices. */
export const ELECTRICITY_PRICE_ENTITIES = {
  yesterday: "sensor.real_electricity_price_hourly_prices_yesterday",
  today: "sensor.real_electricity_price_hourly_prices_today",
  tomorrow: "sensor.real_electricity_price_hourly_prices_tomorrow",
  current: "sensor.real_electricity_price_current_price",
  cheap: "number.real_electricity_price_acceptable_price",
} as const;

/** The price chart always shows today and tomorrow. */
export const ELECTRICITY_PRICE_CHART_HOURS = 48;
/** Time label steps of the price chart: never hourly, so two days fit a phone. */
export const ELECTRICITY_PRICE_TICK_STEPS_MS: number[] = [6, 8, 12, 16, 24, 48].map((hours) => hours * HOUR_MS);

export interface ElectricityPriceHass extends FormatHass {
  states?: Record<string, { state?: string; attributes?: Record<string, unknown> } | undefined>;
}

/** One hour of the price sensors: `t` is its start, `v` the price a household pays. */
export type ElectricityPricePoint = ChartPoint<{ start: number; end: number }>;

function finite(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function instant(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !value) return undefined;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber;
  const asDate = new Date(value).getTime();
  return Number.isFinite(asDate) ? asDate : undefined;
}

function zoneParts(time: number, timeZone: string, options: Intl.DateTimeFormatOptions): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-US", { ...options, timeZone }).formatToParts(new Date(time))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts;
}

function zoneOffsetMs(time: number, timeZone: string): number {
  const parts = zoneParts(time, timeZone, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Number.isFinite(local) ? local - time : 0;
}

/** Midnight of the day that holds `now`, in the zone Home Assistant shows times in (the browser's without one). */
export function homeMidnight(hass?: FormatHass, now: number = Date.now()): number {
  const zone = hassTimeZone(hass);
  if (zone) {
    try {
      const day = zoneParts(now, zone, { year: "numeric", month: "2-digit", day: "2-digit" });
      const guess = Date.UTC(day.year, day.month - 1, day.day);
      if (Number.isFinite(guess)) {
        // Two passes: the offset at the guess can differ from the offset at local midnight (DST).
        const first = guess - zoneOffsetMs(guess, zone);
        return guess - zoneOffsetMs(first, zone);
      }
    } catch {
      // An unknown zone name: fall through to the browser's midnight.
    }
  }
  const local = new Date(now);
  local.setHours(0, 0, 0, 0);
  return local.getTime();
}

/** The window of the price chart: today's midnight in the home time zone, then 48 hours. */
export function electricityPriceDomain(hass?: FormatHass, now: number = Date.now()): ChartDomain {
  const start = homeMidnight(hass, now);
  return { start, end: start + ELECTRICITY_PRICE_CHART_HOURS * HOUR_MS };
}

/** The `hourly_prices` attribute of one price sensor as chart points, oldest first. */
export function electricityPriceSensorPoints(entity: { attributes?: Record<string, unknown> } | undefined): ElectricityPricePoint[] {
  const rows = entity?.attributes?.hourly_prices;
  if (!Array.isArray(rows)) return [];
  const points: ElectricityPricePoint[] = [];
  for (const row of rows) {
    const pair = Array.isArray(row);
    const item = (row ?? {}) as Record<string, unknown>;
    const start = pair ? instant(row[0]) : instant(item.start_time) ?? instant(item.x);
    const value = pair ? finite(row[1]) : finite(item.actual_price, item.price, item.y, item.nord_pool_price);
    if (start === undefined || value === undefined) continue;
    const end = pair ? undefined : instant(item.end_time);
    points.push({ t: start, v: value, data: { start, end: end !== undefined && end > start ? end : start + HOUR_MS } });
  }
  return points.sort((left, right) => left.t - right.t);
}

export interface ElectricityPriceData {
  /** Hours that start inside the domain, oldest first, one per start time (tomorrow's sensor wins over today's). */
  points: ElectricityPricePoint[];
  /** Entity ids of the today and tomorrow sensors that do not exist. */
  missing: string[];
  /** The sensor to open more-info for: today's, else tomorrow's. */
  entityId?: string;
}

/** Prices of the yesterday, today and tomorrow sensors inside `domain` (default: `electricityPriceDomain`). */
export function electricityPricePoints(
  hass: ElectricityPriceHass | undefined,
  options: { entities?: { yesterday?: string; today?: string; tomorrow?: string }; domain?: ChartDomain; now?: number } = {},
): ElectricityPriceData {
  const domain = options.domain ?? electricityPriceDomain(hass, options.now);
  const ids = {
    yesterday: options.entities?.yesterday || ELECTRICITY_PRICE_ENTITIES.yesterday,
    today: options.entities?.today || ELECTRICITY_PRICE_ENTITIES.today,
    tomorrow: options.entities?.tomorrow || ELECTRICITY_PRICE_ENTITIES.tomorrow,
  };
  const today = hass?.states?.[ids.today];
  const tomorrow = hass?.states?.[ids.tomorrow];
  const byStart = new Map<number, ElectricityPricePoint>();
  for (const entity of [hass?.states?.[ids.yesterday], today, tomorrow]) {
    for (const point of electricityPriceSensorPoints(entity)) {
      if (point.t >= domain.start && point.t < domain.end) byStart.set(point.t, point);
    }
  }
  return {
    points: [...byStart.values()].sort((left, right) => left.t - right.t),
    missing: [today ? "" : ids.today, tomorrow ? "" : ids.tomorrow].filter(Boolean),
    entityId: today ? ids.today : tomorrow ? ids.tomorrow : undefined,
  };
}

/** The cheap limit the price colours use: the acceptable price of the price integration, or another number entity. */
export function electricityPriceCheapLimit(hass: ElectricityPriceHass | undefined, entityId?: string): number | undefined {
  return finite(hass?.states?.[entityId || ELECTRICITY_PRICE_ENTITIES.cheap]?.state);
}

/**
 * The price series of the price chart: hourly bars (or a stepped line) in the shared price
 * colours, with H and L. Pass it to `FamilyChartController.render` with `electricityPriceDomain`,
 * `ELECTRICITY_PRICE_TICK_STEPS_MS` and `electricityPriceTimeLabel`.
 */
export function electricityPriceSeries(options: {
  points: ChartPoint[];
  now: number;
  format: (value: number) => string;
  /** Prices at or below this are green. */
  cheap?: number | null;
  colors?: Partial<ElectricityPriceColors>;
  /** Default `bar`. */
  kind?: "bar" | "line";
  /** Default one hour. */
  intervalMs?: number;
  /** Default true. */
  extremes?: boolean;
  areaColor?: string;
  id?: string;
  label?: string;
}): ChartSeries {
  const intervalMs = options.intervalMs ?? HOUR_MS;
  return {
    id: options.id ?? "price",
    label: options.label ?? "Price",
    kind: options.kind ?? "bar",
    curve: "step",
    intervalMs,
    points: options.points,
    colorAt: (point) => electricityPriceColor({
      start: point.t, end: point.t + intervalMs, now: options.now, value: point.v, cheap: options.cheap, colors: options.colors,
    }),
    ...(options.areaColor ? { areaColor: options.areaColor } : {}),
    extremes: options.extremes !== false,
    format: options.format,
  };
}

/** Time labels of the price chart: day and time without the year, e.g. "11 Nov at 0:00". */
export function electricityPriceTimeLabel(hass: FormatHass | undefined, time: number): string {
  return formatHassDateTime(hass, time, { year: false });
}
