import assert from "node:assert/strict";
import { test } from "node:test";
const {
  UNAVAILABLE_TEXT,
  formatHassNumber,
  formatHassCurrency,
  formatHassTime,
  formatHassDate,
  formatHassDateTime,
  formatHassRelative,
  formatHassDuration,
  hassNumberLocale,
  hassHour12,
  hassTimeZone,
  isAvailableValue,
} = await import("../dist/index.js");

const NNBSP = " ";
const hass = (locale = {}, config = { time_zone: "Europe/Tallinn", currency: "EUR" }) => ({
  language: "en",
  locale: { language: "en", number_format: "language", time_format: "language", time_zone: "server", ...locale },
  config,
});
// 2026-11-03T12:35:00Z is 14:35 in Tallinn (EET, UTC+2).
const instant = Date.UTC(2026, 10, 3, 12, 35);

test("missing and non-finite values use the unavailable marker, never 0", () => {
  for (const value of [undefined, null, "", "unavailable", "unknown", NaN, Infinity]) {
    assert.equal(formatHassNumber(hass(), value), UNAVAILABLE_TEXT);
    assert.equal(isAvailableValue(value), false);
  }
  assert.equal(formatHassNumber(hass(), 0, { unit: "W" }), `0${NNBSP}W`);
  assert.equal(isAvailableValue(0), true);
  assert.equal(formatHassTime(hass(), undefined), UNAVAILABLE_TEXT);
  assert.equal(formatHassTime(hass(), "not a date"), UNAVAILABLE_TEXT);
  assert.equal(formatHassDuration(hass(), -5), UNAVAILABLE_TEXT);
  assert.equal(formatHassCurrency(hass({}, {}), 2.5), UNAVAILABLE_TEXT);
  for (const value of [true, false, " ", [], {}, "12 W"]) {
    assert.equal(formatHassNumber(hass(), value), UNAVAILABLE_TEXT, `${JSON.stringify(value)} is not a reading`);
  }
  assert.equal(formatHassNumber(hass(), " 21.5 ", { digits: 1 }), "21.5");
  assert.equal(formatHassNumber(hass(), "0"), "0");
});

test("invalid currencies, languages and zones degrade instead of throwing in render", () => {
  assert.equal(formatHassCurrency(hass({}, { currency: "EURO" }), 12.3), UNAVAILABLE_TEXT);
  assert.equal(formatHassCurrency(hass({}, { currency: " EUR " }), 2.34), "€2.34");
  assert.equal(formatHassNumber(hass({ language: "not a tag!" }), 1), UNAVAILABLE_TEXT);
  assert.equal(formatHassTime(hass({ time_format: "24" }, { time_zone: "Mars/Olympus" }), instant).length > 0, true);
});

test("numbers follow the HA profile number format and the quantity's precision", () => {
  assert.equal(formatHassNumber(hass(), 1136.4, { digits: 0, unit: "rpm" }), `1,136${NNBSP}rpm`);
  assert.equal(formatHassNumber(hass({ number_format: "decimal_comma" }), 1136.45, { digits: 2 }), "1.136,45");
  assert.equal(formatHassNumber(hass({ number_format: "comma_decimal", language: "de" }), 0.2937, { digits: 4 }), "0.2937");
  assert.equal(formatHassNumber(hass({ number_format: "none" }), 12345.6, { digits: 1 }), "12345.6");
  assert.equal(formatHassNumber(hass({ number_format: "none", language: "de" }), 12345.6, { digits: 1 }), "12345.6");
  assert.equal(formatHassCurrency(hass({ number_format: "none" }), 12345.6), "€12345.60");
  assert.equal(formatHassNumber(hass({ number_format: "space_comma" }), 48.6, { digits: 1, unit: "%" }), `48,6${NNBSP}%`);
  assert.equal(hassNumberLocale(hass({ number_format: "system" })), undefined);
  assert.equal(formatHassCurrency(hass(), 2.34), "€2.34");
});

test("times use the HA 12/24-hour preference and the server zone when requested", () => {
  assert.equal(formatHassTime(hass({ time_format: "24" }), instant), "14:35");
  assert.match(formatHassTime(hass({ time_format: "12" }), instant), /^2:35\s?PM$/);
  assert.equal(hassHour12(hass({ time_format: "language" })), undefined);
  assert.equal(hassTimeZone(hass()), "Europe/Tallinn");
  const browserZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  // HA uses the browser zone for "local" unless the browser only reports UTC.
  assert.equal(hassTimeZone(hass({ time_zone: "local" })), browserZone && browserZone !== "UTC" ? undefined : "Europe/Tallinn");
  assert.equal(hassTimeZone({ config: { time_zone: "Europe/Tallinn" } }), "Europe/Tallinn");
  assert.equal(formatHassTime(hass({ time_format: "24", time_zone: "server" }, { time_zone: "America/New_York" }), instant), "07:35");
  assert.equal(formatHassDate(hass(), instant), "Nov 3, 2026");
  assert.equal(formatHassDate(hass(), instant, { year: false }), "Nov 3");
  assert.match(formatHassDateTime(hass({ time_format: "24" }), instant), /^Nov 3, 2026,? 14:35$/);
});

test("relative time is localised and pairs with an explicit reference instant", () => {
  assert.equal(formatHassRelative(hass(), instant - 5 * 60_000, instant), "5 minutes ago");
  assert.equal(formatHassRelative(hass(), instant + 2 * 3_600_000, instant), "in 2 hours");
  assert.equal(formatHassRelative(hass(), instant - 86_400_000, instant), "yesterday");
  assert.equal(formatHassRelative(hass(), null, instant), UNAVAILABLE_TEXT);
  assert.equal(formatHassRelative(hass(), instant - 59_600, instant), "1 minute ago");
  assert.equal(formatHassRelative(hass(), instant - 59.6 * 60_000, instant), "1 hour ago");
  assert.equal(formatHassRelative(hass(), instant - 23.6 * 3_600_000, instant), "yesterday");
});

test("durations show the largest unit and the next non-zero one", () => {
  assert.equal(formatHassDuration(hass(), 3900), `1${NNBSP}h 5${NNBSP}min`);
  assert.equal(formatHassDuration(hass(), 3600), `1${NNBSP}h`);
  assert.equal(formatHassDuration(hass(), 2700), `45${NNBSP}min`);
  assert.equal(formatHassDuration(hass(), 30), `30${NNBSP}s`);
  assert.equal(formatHassDuration(hass(), 86_430), `1${NNBSP}d`);
  assert.equal(formatHassDuration(hass(), 0), `0${NNBSP}min`);
  assert.equal(formatHassDuration(hass(), -0.4), `0${NNBSP}min`, "end-time jitter is not unavailable");
  assert.equal(formatHassDuration(hass(), -5), UNAVAILABLE_TEXT);
});
