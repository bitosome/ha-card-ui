import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
const window = new Window({ url: "http://localhost" });
for (const key of ["window", "document", "Document", "HTMLElement", "Element", "customElements", "CSSStyleSheet", "Event", "CustomEvent"]) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true });
}
const { render } = await import("lit");
const { levelMeter, levelMeterMarkup, batteryTone, componentStyles } = await import("../dist/index.js");

const mount = (template) => {
  const container = document.createElement("div");
  render(template, container);
  return container.querySelector(".family-level-meter");
};
const fromMarkup = (markup) => {
  const container = document.createElement("div");
  container.innerHTML = markup;
  return container.querySelector(".family-level-meter");
};

test("battery bands are shared: success from 60, warning from 20, error below", () => {
  assert.equal(batteryTone(100), "success");
  assert.equal(batteryTone(60), "success");
  assert.equal(batteryTone(59), "warning");
  assert.equal(batteryTone(20), "warning");
  assert.equal(batteryTone(19), "error");
  assert.equal(batteryTone(0), "error");
  for (const missing of [undefined, null, NaN]) assert.equal(batteryTone(missing), undefined);
});

test("Lit and string meters render the same accessible bar", () => {
  const options = { value: 72, label: "Battery level", tone: "success", target: 80, valueText: "72%, target 80%", className: "battery" };
  for (const meter of [mount(levelMeter(options)), fromMarkup(levelMeterMarkup(options))]) {
    assert.equal(meter.getAttribute("role"), "meter");
    assert.equal(meter.getAttribute("aria-label"), "Battery level");
    assert.equal(meter.getAttribute("aria-valuemin"), "0");
    assert.equal(meter.getAttribute("aria-valuemax"), "100");
    assert.equal(meter.getAttribute("aria-valuenow"), "72");
    assert.equal(meter.getAttribute("aria-valuetext"), "72%, target 80%");
    assert.ok(meter.classList.contains("battery"));
    const fill = meter.querySelector(".family-level-fill");
    assert.equal(fill.dataset.tone, "success");
    assert.match(fill.getAttribute("style"), /width:\s*72%/);
    assert.match(meter.querySelector(".family-level-target").getAttribute("style"), /left:\s*clamp\(1px, 80%, calc\(100% - 1px\)\)/);
  }
});

test("missing values draw an empty track announced as unavailable; levels are clamped", () => {
  for (const meter of [mount(levelMeter({ value: undefined, label: "Fan setting" })), fromMarkup(levelMeterMarkup({ value: null, label: "Fan setting" }))]) {
    assert.equal(meter.hasAttribute("aria-valuenow"), false);
    assert.equal(meter.getAttribute("aria-valuetext"), "Unavailable");
    assert.match(meter.querySelector(".family-level-fill").getAttribute("style"), /width:\s*0%/);
    assert.equal(meter.querySelector(".family-level-fill").dataset.tone, "accent");
    assert.equal(meter.querySelector(".family-level-target"), null);
  }
  assert.equal(mount(levelMeter({ value: 140, label: "Level" })).getAttribute("aria-valuenow"), "100");
  assert.equal(fromMarkup(levelMeterMarkup({ value: -5, label: "Level" })).getAttribute("aria-valuenow"), "0");
});

test("a 100 % target stays fully inside the track", () => {
  for (const meter of [mount(levelMeter({ value: 72, label: "Battery", target: 100 })), fromMarkup(levelMeterMarkup({ value: 72, label: "Battery", target: 100 }))]) {
    assert.match(meter.querySelector(".family-level-target").getAttribute("style"), /clamp\(1px, 100%, calc\(100% - 1px\)\)/);
  }
});

test("string meter escapes its text", () => {
  const markup = levelMeterMarkup({ value: 50, label: `Car "A" <b>` });
  assert.doesNotMatch(markup, /<b>/);
  assert.equal(fromMarkup(markup).getAttribute("aria-label"), `Car "A" <b>`);
});

test("one track thickness for every level bar ships in componentStyles", () => {
  const css = componentStyles.cssText;
  assert.match(css, /\.family-level-meter\s*\{[^}]*height: 6px;/);
  assert.match(css, /\.family-level-fill\s*\{[^}]*background: var\(--family-tone, var\(--primary-color\)\)/);
});
