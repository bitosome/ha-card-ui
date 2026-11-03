/**
 * Home Assistant-aware value formatting for the card family.
 *
 * Every helper reads the HA user's profile (`hass.locale`) and the server time
 * zone (`hass.config.time_zone`) the same way the HA frontend does, so cards
 * agree on language, number format, 12/24-hour clock and time zone. Missing or
 * non-finite input returns the shared unavailable marker instead of `0`.
 * Precision belongs to the quantity: callers pass digits, not a generic rounding.
 */

/** Visible text for missing data. Never format missing data as `0`. */
export const UNAVAILABLE_TEXT = "Unavailable";
/** Visible text for optional data the user has not bound in configuration. */
export const NOT_CONFIGURED_TEXT = "Not configured";

/** The subset of `hass` the formatters read; a full HomeAssistant object fits. */
export interface FormatHass {
  language?: string;
  locale?: {
    language?: string;
    number_format?: string;
    time_format?: string;
    time_zone?: string;
  };
  config?: { time_zone?: string; currency?: string };
}

type Instant = Date | number | string;

const language = (hass?: FormatHass): string =>
  hass?.locale?.language || hass?.language || "en";

/** Locale string for numbers, honouring HA's profile number format. */
export function hassNumberLocale(hass?: FormatHass): string | undefined {
  switch (hass?.locale?.number_format) {
    case "comma_decimal":
    case "none":
      return "en-US";
    case "decimal_comma":
      return "de";
    case "space_comma":
      return "fr";
    case "system":
      return undefined;
    default:
      return language(hass);
  }
}

/** `hour12` for Intl, honouring HA's profile time format. */
export function hassHour12(hass?: FormatHass): boolean | undefined {
  switch (hass?.locale?.time_format) {
    case "12":
      return true;
    case "24":
      return false;
    case "system": {
      const cycle = (
        new Intl.DateTimeFormat(undefined, { hour: "numeric" })
          .resolvedOptions() as { hourCycle?: string }
      ).hourCycle;
      return cycle === "h11" || cycle === "h12";
    }
    default:
      return undefined;
  }
}

/**
 * IANA zone for Intl, as HA resolves it: the browser zone only when the profile
 * asks for local time and the browser reports a real zone; otherwise the server zone.
 */
export function hassTimeZone(hass?: FormatHass): string | undefined {
  const local = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (hass?.locale?.time_zone === "local" && local && local !== "UTC") return undefined;
  return hass?.config?.time_zone || undefined;
}

function toDate(value: Instant | null | undefined): Date | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Only real numbers and numeric strings (HA states) count; booleans, blanks and objects are missing. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !NUMERIC.test(value.trim())) return undefined;
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : undefined;
}

/** Intl constructors throw on bad tags, currencies or zones; never let that break a render. */
function safely(format: () => string): string {
  try {
    return format();
  } catch {
    return UNAVAILABLE_TEXT;
  }
}

const grouping = (hass?: FormatHass): boolean => hass?.locale?.number_format !== "none";

/** True when a value would format as a real reading rather than the unavailable marker. */
export function isAvailableValue(value: unknown): boolean {
  return toNumber(value) !== undefined;
}

export interface NumberFormatOptions {
  /** Fixed precision; overrides minimum/maximum. */
  digits?: number;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** Appended after a narrow no-break space, e.g. `48.6 %`. */
  unit?: string;
  signDisplay?: "auto" | "always" | "exceptZero" | "never";
}

export function formatHassNumber(
  hass: FormatHass | undefined,
  value: unknown,
  options: NumberFormatOptions = {},
): string {
  const number = toNumber(value);
  if (number === undefined) return UNAVAILABLE_TEXT;
  const formatted = safely(() =>
    new Intl.NumberFormat(hassNumberLocale(hass), {
      minimumFractionDigits: options.digits ?? options.minimumFractionDigits,
      maximumFractionDigits: options.digits ?? options.maximumFractionDigits,
      signDisplay: options.signDisplay,
      useGrouping: grouping(hass),
    }).format(number),
  );
  return options.unit && formatted !== UNAVAILABLE_TEXT
    ? `${formatted}\u202f${options.unit}`
    : formatted;
}

export function formatHassCurrency(
  hass: FormatHass | undefined,
  value: unknown,
  options: { currency?: string; digits?: number } = {},
): string {
  const number = toNumber(value);
  const currency = options.currency || hass?.config?.currency;
  if (number === undefined || !currency) return UNAVAILABLE_TEXT;
  return safely(() =>
    new Intl.NumberFormat(hassNumberLocale(hass), {
      style: "currency",
      currency: currency.trim(),
      minimumFractionDigits: options.digits,
      maximumFractionDigits: options.digits,
      useGrouping: grouping(hass),
    }).format(number),
  );
}

function dateTime(
  hass: FormatHass | undefined,
  value: Instant | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  if (!date) return UNAVAILABLE_TEXT;
  const usesTime = "hour" in options || "minute" in options;
  const hour12 = usesTime ? hassHour12(hass) : undefined;
  // HA sets an explicit hour cycle; hour12 alone can resolve to h24/h11 on some engines.
  const clock: Intl.DateTimeFormatOptions =
    hour12 === undefined ? {} : ({ hourCycle: hour12 ? "h12" : "h23" } as Intl.DateTimeFormatOptions);
  const build = (timeZone: string | undefined) =>
    new Intl.DateTimeFormat(language(hass), { ...options, ...clock, timeZone }).format(date);
  return safely(() => {
    try {
      return build(hassTimeZone(hass));
    } catch {
      return build(undefined);
    }
  });
}

/** Clock time, e.g. `14:35` or `2:35 PM`. */
export function formatHassTime(
  hass: FormatHass | undefined,
  value: Instant | null | undefined,
  options: { seconds?: boolean } = {},
): string {
  return dateTime(hass, value, {
    hour: "numeric",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" } : {}),
  });
}

/** Calendar date, e.g. `3 Nov 2026`; omit the year with `year: false`. */
export function formatHassDate(
  hass: FormatHass | undefined,
  value: Instant | null | undefined,
  options: { year?: boolean; weekday?: boolean } = {},
): string {
  return dateTime(hass, value, {
    day: "numeric",
    month: "short",
    ...(options.year === false ? {} : { year: "numeric" }),
    ...(options.weekday ? { weekday: "short" } : {}),
  });
}

/** Date and clock time, e.g. `3 Nov 2026, 14:35`. */
export function formatHassDateTime(
  hass: FormatHass | undefined,
  value: Instant | null | undefined,
  options: { year?: boolean; seconds?: boolean } = {},
): string {
  return dateTime(hass, value, {
    day: "numeric",
    month: "short",
    ...(options.year === false ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" } : {}),
  });
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.345],
  ["month", 12],
  ["year", Infinity],
];

/** Relative time, e.g. `5 minutes ago` or `in 2 hours`. Pair it with an absolute time for diagnosis. */
export function formatHassRelative(
  hass: FormatHass | undefined,
  value: Instant | null | undefined,
  now: Instant = Date.now(),
): string {
  const date = toDate(value);
  const reference = toDate(now);
  if (!date || !reference) return UNAVAILABLE_TEXT;
  let delta = (date.getTime() - reference.getTime()) / 1000;
  return safely(() => {
    const format = new Intl.RelativeTimeFormat(language(hass), { numeric: "auto" });
    for (const [unit, size] of RELATIVE_STEPS) {
      // Round before choosing the unit, so 59.6 s reads "1 minute", not "60 seconds".
      const rounded = Math.round(delta);
      if (Math.abs(rounded) < size) return format.format(rounded, unit);
      delta /= size;
    }
    return UNAVAILABLE_TEXT;
  });
}

/**
 * Elapsed or remaining time from seconds, e.g. `1 h 5 min`, `45 min`, `30 s`.
 * Shows the largest unit and, when non-zero, the next one, so values stay compact.
 */
export function formatHassDuration(
  hass: FormatHass | undefined,
  seconds: unknown,
): string {
  const total = toNumber(seconds);
  if (total === undefined) return UNAVAILABLE_TEXT;
  const whole = Math.round(total) || 0;
  if (whole < 0) return UNAVAILABLE_TEXT;
  const parts: [number, string][] = [
    [Math.floor(whole / 86400), "d"],
    [Math.floor((whole % 86400) / 3600), "h"],
    [Math.floor((whole % 3600) / 60), "min"],
    [whole % 60, "s"],
  ];
  const first = parts.findIndex(([amount]) => amount > 0);
  if (first < 0) return `0\u202fmin`;
  const shown = parts.slice(first, first + 2).filter(([amount]) => amount > 0);
  return safely(() => {
    const number = new Intl.NumberFormat(hassNumberLocale(hass), { useGrouping: grouping(hass) });
    return shown.map(([amount, unit]) => `${number.format(amount)}\u202f${unit}`).join(" ");
  });
}
