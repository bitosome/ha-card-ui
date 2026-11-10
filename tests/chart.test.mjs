import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { Window } from "happy-dom";
const window = new Window({ url: "http://localhost" });
for (const key of [
  "window",
  "document",
  "Document",
  "HTMLElement",
  "Element",
  "ShadowRoot",
  "customElements",
  "CSSStyleSheet",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "MutationObserver",
]) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true });
}
const { LitElement, html, render } = await import("lit");
const {
  FamilyChartController,
  chartDefId,
  chartFrame,
  chartLegend,
  chartLegendSwatch,
  chartSkeleton,
  chartState,
  chartStyles,
  formatHassNumber,
} = await import("../dist/index.js");

const HOUR = 3_600_000;
const MIDNIGHT = Date.UTC(2026, 10, 3);
const NOW = MIDNIGHT + 2.5 * HOUR;
const GB = { locale: { language: "en-GB", time_format: "24" }, config: { time_zone: "UTC" } };

const price = (overrides = {}) => ({
  id: "price",
  label: "Electricity price interval",
  description: "5 available hourly electricity price points in a fixed 6-hour chart window.",
  height: 190,
  hass: GB,
  now: NOW,
  domain: { start: MIDNIGHT, end: MIDNIGHT + 6 * HOUR },
  axes: { primary: { includeZero: true, format: (value) => formatHassNumber(GB, value, { digits: 2, unit: "€" }) } },
  series: [{
    id: "price",
    label: "Price",
    kind: "bar",
    curve: "step",
    intervalMs: HOUR,
    extremes: true,
    points: [-0.05, 0.1, null, 0.25, 0.3, 0.2].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })),
    format: (value) => formatHassNumber(GB, value, { digits: 4, unit: "€/kWh" }),
  }],
  ...overrides,
});

let hostCount = 0;
/** A Lit host that renders whatever chart options the test hands it. */
function mountHost(charts, controllerOptions) {
  const tag = `chart-test-host-${++hostCount}`;
  class Host extends LitElement {
    static styles = [chartStyles];
    constructor() {
      super();
      this.chartOptions = charts;
      this.charts = new FamilyChartController(this, controllerOptions);
      this.renders = 0;
    }
    render() {
      this.renders++;
      return html`${this.chartOptions.map((options) => {
        const view = this.charts.render(options);
        return chartFrame({ title: options.label, readout: view.readout, legend: view.legend, body: view.svg });
      })}`;
    }
  }
  customElements.define(tag, Host);
  const host = document.createElement(tag);
  document.body.append(host);
  return host;
}
// A failed assertion must not leave a host whose clock keeps Node running.
after(async () => {
  document.body.replaceChildren();
  await window.happyDOM.abort();
});
const slider = (host, index = 0) => host.shadowRoot.querySelectorAll("svg.family-chart")[index];

test("the chart is a labelled slider with title and description", async () => {
  const host = mountHost([price()]);
  await host.updateComplete;
  const svg = slider(host);
  assert.equal(svg.getAttribute("role"), "slider");
  assert.equal(svg.getAttribute("tabindex"), "0");
  assert.equal(svg.getAttribute("aria-label"), "Electricity price interval");
  assert.equal(svg.getAttribute("aria-valuemin"), "0");
  assert.equal(svg.getAttribute("aria-valuemax"), "4", "five available points; the missing hour is skipped");
  // Now (02:30) falls in the missing hour: the cursor snaps to the last interval with a price
  // instead of claiming that price for now.
  assert.equal(svg.getAttribute("aria-valuenow"), "1");
  assert.match(svg.getAttribute("aria-valuetext"), /^3 Nov, 1:00 · 0\.1000/);
  assert.equal(svg.getAttribute("viewBox"), "0 0 360 190", "the 360px fallback width without ResizeObserver");
  assert.equal(svg.querySelector("title").textContent, svg.getAttribute("aria-valuetext"));
  assert.match(svg.querySelector("desc").textContent, /5 available hourly electricity price points/);
  assert.equal(svg.dataset.chartId, "price");
  assert.equal(svg.querySelectorAll(".family-chart-bar").length, 5);
  assert.equal(svg.querySelectorAll(".family-chart-bar.selected").length, 1);
  assert.equal(svg.querySelectorAll(".family-chart-extreme").length, 2);
  assert.ok(svg.querySelector(".family-chart-now"), "now marker inside the window");
  assert.ok(svg.querySelector(".family-chart-cursor"));
  assert.equal(svg.querySelectorAll("g.family-chart-dot").length, 1);
  assert.equal(svg.querySelectorAll(".family-chart-axis").length, 5);
  assert.ok(svg.querySelector(".family-chart-time-start"));
  assert.ok(svg.querySelector(".family-chart-time-end"));
  const readout = host.shadowRoot.querySelector(".family-chart-head .family-chart-readout");
  assert.match(readout.querySelector("span").textContent, /3 Nov, 1:00/);
  assert.match(readout.querySelector("strong").textContent, /0\.1000/);
  assert.equal(host.shadowRoot.querySelector(".family-chart-title").textContent, "Electricity price interval");
  host.remove();
});

test("keyboard moves the selection and Escape returns to following now", async () => {
  const host = mountHost([price()]);
  await host.updateComplete;
  const key = async (name) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    slider(host).dispatchEvent(event);
    await host.updateComplete;
    return event;
  };
  await key("Home");
  assert.equal(slider(host).getAttribute("aria-valuenow"), "0");
  assert.match(slider(host).getAttribute("aria-valuetext"), /-0\.0500/);
  await key("ArrowRight");
  await key("ArrowRight");
  assert.equal(slider(host).getAttribute("aria-valuenow"), "2");
  assert.match(slider(host).getAttribute("aria-valuetext"), /3 Nov, 3:00 /, "skips the missing hour");
  await key("End");
  assert.equal(slider(host).getAttribute("aria-valuenow"), "4");
  await key("PageDown");
  assert.equal(slider(host).getAttribute("aria-valuenow"), "3");
  const escape = await key("Escape");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(slider(host).getAttribute("aria-valuenow"), "1");
  assert.equal(host.charts.selected("price"), undefined);
  const again = await key("Escape");
  assert.equal(again.defaultPrevented, false, "Escape while following now is left for a surrounding dialog");
  host.remove();
});

test("Enter and Space on the slider do not reach a parent tile action", async () => {
  const host = mountHost([price()]);
  await host.updateComplete;
  const reached = [];
  const frame = host.shadowRoot.querySelector(".family-chart-frame");
  frame.addEventListener("keydown", (event) => reached.push(`down ${event.key}`));
  frame.addEventListener("keyup", (event) => reached.push(`up ${event.key}`));
  for (const key of ["Enter", " "]) {
    for (const type of ["keydown", "keyup"]) {
      slider(host).dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, composed: true }));
    }
  }
  assert.deepEqual(reached, [], "Space Hub's action handler fires tap on keyup Enter/Space");
  slider(host).dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true, composed: true }));
  assert.deepEqual(reached, ["up ArrowRight"], "other keys still bubble");
  host.remove();
});

test("left axis labels default to their series colour; the readout colours secondary series", async () => {
  const series = price().series[0];
  const combined = price({
    series: [
      // Listed first, but a secondary series: it is coloured by emphasis, not by position.
      { ...series, id: "rain", label: "Rain", kind: "line", axis: "secondary", emphasis: "secondary", color: "var(--rain)", extremes: false },
      { ...series, id: "temperature", label: "Temperature", kind: "line", color: "var(--temp)", extremes: false },
    ],
    axes: {
      primary: { includeZero: true, format: (value) => value.toFixed(2) },
      secondary: { min: 0, max: 1, format: (value) => `${Math.round(value * 100)}%` },
    },
  });
  const host = mountHost([combined]);
  await host.updateComplete;
  const left = slider(host).querySelectorAll(".family-chart-axis-left");
  assert.equal(left.length, 5);
  for (const label of left) assert.equal(label.getAttribute("style"), "fill:var(--rain)");
  for (const label of slider(host).querySelectorAll(".family-chart-axis:not(.family-chart-axis-left)")) {
    assert.equal(label.getAttribute("style"), null, "the right axis keeps the text colour");
  }
  const strong = (id) => host.shadowRoot.querySelector(`.family-chart-readout strong[data-series=${id}]`);
  assert.equal(strong("rain").getAttribute("style"), "color:var(--rain)");
  assert.equal(strong("temperature").getAttribute("style"), null);
  host.remove();
});

const pointer = (type, init) => new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, ...init });

test("pointer selection: hover follows the mouse, press needs a press, touch moves need a drag", async () => {
  const host = mountHost([price(), price({ id: "press", selectOn: "press" })]);
  await host.updateComplete;
  for (const svg of host.shadowRoot.querySelectorAll("svg.family-chart")) {
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: 360, bottom: 190, width: 360, height: 190 });
  }
  const model = host.charts.render(price()).model;
  const xAt = (hours) => model.x(MIDNIGHT + hours * HOUR);

  slider(host, 0).dispatchEvent(pointer("pointermove", { pointerType: "mouse", clientX: xAt(4.5) }));
  await host.updateComplete;
  assert.equal(slider(host, 0).getAttribute("aria-valuenow"), "3", "hover selects the interval under the mouse");

  slider(host, 1).dispatchEvent(pointer("pointermove", { pointerType: "mouse", clientX: xAt(4.5) }));
  await host.updateComplete;
  assert.equal(slider(host, 1).getAttribute("aria-valuenow"), "1", "press mode ignores plain hover");
  slider(host, 1).dispatchEvent(pointer("pointerdown", { pointerType: "mouse", clientX: xAt(0.5) }));
  await host.updateComplete;
  assert.equal(slider(host, 1).getAttribute("aria-valuenow"), "0");
  slider(host, 1).dispatchEvent(pointer("pointermove", { pointerType: "mouse", clientX: xAt(5.5) }));
  await host.updateComplete;
  assert.equal(slider(host, 1).getAttribute("aria-valuenow"), "4", "dragging scrubs in press mode");
  slider(host, 1).dispatchEvent(pointer("pointerup", { pointerType: "mouse" }));

  slider(host, 0).dispatchEvent(pointer("pointerup", { pointerType: "touch" }));
  const move = pointer("pointermove", { pointerType: "touch", clientX: xAt(0.5) });
  slider(host, 0).dispatchEvent(move);
  await host.updateComplete;
  assert.equal(slider(host, 0).getAttribute("aria-valuenow"), "3", "a touch move without a press is ignored");
  const down = pointer("pointerdown", { pointerType: "touch", clientX: xAt(1.5) });
  slider(host, 0).dispatchEvent(down);
  await host.updateComplete;
  assert.equal(slider(host, 0).getAttribute("aria-valuenow"), "1");
  assert.equal(down.defaultPrevented, false, "touch keeps its default so vertical swipes scroll");
  slider(host, 0).dispatchEvent(pointer("pointermove", { pointerType: "touch", clientX: xAt(5.2) }));
  await host.updateComplete;
  assert.equal(slider(host, 0).getAttribute("aria-valuenow"), "4", "a touch drag scrubs");
  slider(host, 0).dispatchEvent(pointer("pointercancel", { pointerType: "touch" }));
  slider(host, 0).dispatchEvent(pointer("pointermove", { pointerType: "touch", clientX: xAt(0.5) }));
  await host.updateComplete;
  assert.equal(slider(host, 0).getAttribute("aria-valuenow"), "4", "the drag ends on cancel");
  host.remove();
});

test("a mouse hover is a preview: pointerleave returns to now or to the pinned selection", async () => {
  const host = mountHost([price(), price({ id: "other", selectionGroup: "price" })]);
  await host.updateComplete;
  for (const svg of host.shadowRoot.querySelectorAll("svg.family-chart")) {
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: 360, bottom: 190, width: 360, height: 190 });
  }
  const model = host.charts.render(price()).model;
  const xAt = (hours) => model.x(MIDNIGHT + hours * HOUR);
  const send = async (index, type, init) => {
    slider(host, index).dispatchEvent(pointer(type, init));
    await host.updateComplete;
  };
  const now = (index = 0) => slider(host, index).getAttribute("aria-valuenow");

  await send(0, "pointermove", { pointerType: "mouse", clientX: xAt(4.5) });
  assert.equal(now(), "3");
  assert.equal(now(1), "3", "the hover preview is shared by the selection group");
  await send(0, "pointerleave", { pointerType: "mouse" });
  assert.equal(now(), "1", "back to following now");
  assert.equal(host.charts.selected("price"), undefined);
  assert.equal(now(1), "1");

  // A press pins the selection; later hover moves preview, leaving restores the pin.
  await send(0, "pointerdown", { pointerType: "mouse", clientX: xAt(0.5) });
  await send(0, "pointerup", { pointerType: "mouse" });
  await send(0, "pointermove", { pointerType: "mouse", clientX: xAt(5.5) });
  assert.equal(now(), "4");
  await send(0, "pointerleave", { pointerType: "mouse" });
  assert.equal(now(), "0", "the pressed point persists");
  assert.equal(host.charts.selected("price"), MIDNIGHT);

  // Keyboard selections persist and replace a hover preview.
  await send(0, "pointermove", { pointerType: "mouse", clientX: xAt(4.5) });
  slider(host).dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
  await host.updateComplete;
  await send(0, "pointerleave", { pointerType: "mouse" });
  assert.equal(now(), "4", "the keyboard pick persists after the mouse leaves");

  // Touch selections persist when the finger leaves.
  await send(0, "pointerdown", { pointerType: "touch", clientX: xAt(1.5) });
  await send(0, "pointerup", { pointerType: "touch" });
  await send(0, "pointerleave", { pointerType: "touch" });
  assert.equal(now(), "1");
  assert.equal(host.charts.selected("price"), MIDNIGHT + HOUR);
  host.remove();
});

test("a synced time without data keeps the cursor there and reads No data", async () => {
  // The second chart has no 03:00–05:00 prices.
  const sparse = price({
    id: "sparse",
    selectionGroup: "sync",
    series: [{ ...price().series[0], points: [0.05, 0.1, 0.15].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })) }],
  });
  const host = mountHost([price({ selectionGroup: "sync" }), sparse]);
  await host.updateComplete;
  slider(host, 0).dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
  await host.updateComplete;
  const svg = slider(host, 1);
  assert.match(svg.getAttribute("aria-valuetext"), /^3 Nov, 5:00 · No data$/);
  assert.equal(svg.querySelectorAll(".family-chart-bar.selected").length, 0, "no bar claims the time");
  assert.equal(svg.querySelectorAll("g.family-chart-dot").length, 0);
  const model = host.charts.render(sparse).model;
  assert.equal(Number(svg.querySelector(".family-chart-cursor").getAttribute("x1")), model.x(MIDNIGHT + 5 * HOUR));
  const readout = host.shadowRoot.querySelectorAll(".family-chart-readout")[1];
  assert.match(readout.querySelector("span").textContent, /3 Nov, 5:00/);
  const dash = readout.querySelector("strong.family-chart-no-value");
  assert.equal(dash.textContent, "–");
  assert.equal(dash.getAttribute("role"), "img", "a named image, since strong cannot carry aria-label");
  assert.equal(dash.getAttribute("aria-label"), "No data");
  assert.equal(svg.getAttribute("aria-valuenow"), String(model.selection.index), "a slider keeps the nearest index; valuetext says No data");
  host.remove();
});

test("pointerdown and click do not reach a parent tile action", async () => {
  const host = mountHost([price()]);
  await host.updateComplete;
  slider(host).getBoundingClientRect = () => ({ left: 0, width: 360, top: 0, height: 190 });
  let parent = 0;
  const frame = host.shadowRoot.querySelector(".family-chart-frame");
  frame.addEventListener("pointerdown", () => parent++);
  frame.addEventListener("click", () => parent++);
  slider(host).dispatchEvent(pointer("pointerdown", { pointerType: "mouse", clientX: 20 }));
  slider(host).dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  assert.equal(parent, 0);
  host.remove();
});

test("charts in one selectionGroup move together and keep distinct gradient ids", async () => {
  const line = (id) => price({
    id,
    selectionGroup: "weather-sync",
    series: [{ ...price().series[0], kind: "line", colorAt: (point) => (point.v > 0.2 ? "red" : "green") }],
  });
  const host = mountHost([line("temperature"), line("precipitation")]);
  await host.updateComplete;
  slider(host, 0).dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
  await host.updateComplete;
  assert.equal(slider(host, 0).getAttribute("aria-valuenow"), "4");
  assert.equal(slider(host, 1).getAttribute("aria-valuenow"), "4", "the synced chart follows");
  const ids = [...host.shadowRoot.querySelectorAll("[id]")].map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids in one shadow root");
  const stroke = chartDefId("temperature", "price", "stroke");
  const fade = chartDefId("temperature", "price", "fade");
  assert.ok(ids.includes(stroke));
  assert.ok(ids.includes(chartDefId("precipitation", "price", "fade")));
  const line0 = slider(host, 0).querySelector(".family-chart-line");
  assert.equal(line0.dataset.emphasis, "primary");
  assert.ok(line0.getAttribute("style").includes(`url(#${stroke})`));
  assert.equal(slider(host, 0).querySelector(".family-chart-area").getAttribute("mask"), `url(#${fade})`);
  assert.ok(slider(host, 0).querySelector(".family-chart-shadow"));
  host.remove();
});

test("setWidth re-renders at the measured width; a ResizeObserver feeds it", async () => {
  const host = mountHost([price()]);
  await host.updateComplete;
  assert.equal(host.charts.width("price"), 360);
  host.charts.setWidth("price", 720);
  await host.updateComplete;
  assert.equal(slider(host).getAttribute("viewBox"), "0 0 720 190", "height stays the configured height");
  host.remove();

  const observed = [];
  let notify;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      notify = callback;
    }
    observe(element) {
      observed.push(element);
    }
    unobserve() {}
    disconnect() {}
  };
  try {
    const measured = mountHost([price()]);
    await measured.updateComplete;
    const body = measured.shadowRoot.querySelector(".family-chart-body");
    assert.ok(observed.includes(body), "the chart body is observed");
    notify([{ target: body, contentRect: { width: 280.4 } }]);
    await measured.updateComplete;
    assert.equal(slider(measured).getAttribute("viewBox"), "0 0 280 190");
    measured.remove();
  } finally {
    delete globalThis.ResizeObserver;
  }
});

test("the clock runs while a chart depends on now: a now marker or a selection following now", async () => {
  const wait = () => new Promise((resolve) => setTimeout(resolve, 40));
  const host = mountHost([price()], { clockMs: 5 });
  await host.updateComplete;
  const before = host.renders;
  await wait();
  assert.ok(host.renders > before, "re-renders to move the now marker");
  host.remove();
  // No marker, but the cursor and colours follow now inside the window (printer, colorAt from now).
  const follows = mountHost([price({ nowMarker: false })], { clockMs: 5 });
  await follows.updateComplete;
  const following = follows.renders;
  await wait();
  assert.ok(follows.renders > following, "a follow-now cursor stays fresh without a marker");
  // A pinned selection no longer depends on now: the clock stops.
  follows.charts.select("price", MIDNIGHT + HOUR);
  await follows.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 10));
  const pinned = follows.renders;
  await wait();
  assert.equal(follows.renders, pinned, "stops once the selection is pinned");
  // Escape-like return to now restarts it.
  follows.charts.select("price", undefined);
  await follows.updateComplete;
  const resumed = follows.renders;
  await wait();
  assert.ok(follows.renders > resumed, "resumes when the selection follows now again");
  follows.remove();
  // Now outside the window and no marker: nothing on screen depends on now.
  const still = mountHost([price({ nowMarker: false, now: MIDNIGHT + 9 * HOUR })], { clockMs: 5 });
  await still.updateComplete;
  const count = still.renders;
  await wait();
  assert.equal(still.renders, count);
  still.remove();
  // An update that lands after disconnection must not restart the clock.
  const gone = mountHost([price()], { clockMs: 5 });
  await gone.updateComplete;
  gone.remove();
  gone.requestUpdate();
  await gone.updateComplete;
  const settled = gone.renders;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(gone.renders, settled);
  // Reattached (HA switching dashboard views): the clock resumes without an outside update.
  document.body.append(gone);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(gone.renders > settled + 1, "the now marker keeps moving after a reconnect");
  gone.remove();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const stopped = gone.renders;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(gone.renders, stopped, "and stops again on the next disconnect");
});

test("empty data renders asyncState; legend, skeleton and frame helpers", async () => {
  const empty = price({
    emptyMessage: "No recorded power data for this period.",
    series: [{ ...price().series[0], points: [{ t: MIDNIGHT, v: null }] }],
  });
  const host = mountHost([empty]);
  await host.updateComplete;
  assert.equal(slider(host), undefined);
  const state = host.shadowRoot.querySelector(".family-chart-body .family-async-state");
  assert.match(state.textContent, /No recorded power data for this period\./);
  assert.match(host.shadowRoot.querySelector(".family-chart-body").getAttribute("style"), /min-height:190px/);
  assert.equal(host.shadowRoot.querySelector(".family-chart-readout"), null);
  host.remove();

  const container = document.createElement("div");
  render(chartSkeleton({ height: 120, label: "Loading power history" }), container);
  const skeleton = container.querySelector(".family-chart-skeleton");
  assert.equal(skeleton.getAttribute("aria-label"), "Loading power history");
  assert.match(skeleton.getAttribute("style"), /height:120px/);
  render(chartSkeleton({ height: 40, label: "Loading" }), container);
  assert.match(container.querySelector(".family-chart-skeleton").getAttribute("style"), /height:82px/, "clamped like the chart");

  // Error, empty and loading blocks share the chart height, so the frame does not jump.
  const retried = [];
  render(chartState({ height: 120, state: "error", message: "Could not load power history.", onRetry: () => retried.push(1) }), container);
  const stateBody = container.querySelector(".family-chart-body.family-chart-empty");
  assert.match(stateBody.getAttribute("style"), /min-height:120px/);
  assert.match(stateBody.textContent, /Could not load power history\./);
  assert.ok(stateBody.querySelector(".family-notice[data-tone=error]"));
  render(chartState({ height: 900, state: "loading", message: "Loading power history" }), container);
  assert.match(container.querySelector(".family-chart-empty").getAttribute("style"), /min-height:360px/);
  assert.ok(container.querySelector(".family-async-state[role=status]"));

  const series = [
    { id: "power", label: "Power", points: [], format: String },
    { id: "current", label: "Current", emphasis: "secondary", points: [], format: String },
  ];
  render(chartLegend(series, { gapNote: "Gaps mean missing data" }), container);
  assert.deepEqual([...container.querySelectorAll(".family-chart-legend > span[data-series]")].map((span) => span.textContent.trim()), ["Power", "Current"]);
  assert.match(container.querySelector("[data-series=current] i").getAttribute("style"), /--family-chart-series-2/);
  assert.ok(container.querySelector(".family-chart-gap-note"));
  render(chartLegend(series, { gapNote: "Gaps mean missing data", show: false }), container);
  assert.equal(container.querySelector(".family-chart-gap-note"), null);

  // colorAt series: a gradient of their colours from the lowest to the highest value.
  const coloured = {
    id: "temperature",
    label: "Temperature",
    points: [12, 4, null, 20, 8].map((v, hour) => ({ t: MIDNIGHT + hour * HOUR, v })),
    colorAt: (point) => (point.v < 6 ? "blue" : point.v < 15 ? "green" : "red"),
    format: String,
  };
  assert.equal(chartLegendSwatch(coloured), "linear-gradient(90deg, blue, green, red)");
  assert.equal(chartLegendSwatch({ ...coloured, colorAt: () => "teal" }), "teal", "one colour is a plain swatch");
  assert.match(chartLegendSwatch({ ...coloured, points: [] }), /--family-chart-series-1/, "no data falls back to the series colour");
  const many = { ...coloured, points: Array.from({ length: 20 }, (_, v) => ({ t: v, v })), colorAt: (point) => `hsl(${point.v * 10} 70% 50%)` };
  assert.equal(chartLegendSwatch(many).match(/hsl\(/g).length, 6, "at most six stops");
  render(chartLegend([coloured, series[1]], { swatches: { current: "var(--override)" } }), container);
  assert.equal(container.querySelector("[data-series=temperature] i").getAttribute("style"), "background:linear-gradient(90deg, blue, green, red)");
  assert.equal(container.querySelector("[data-series=current] i").getAttribute("style"), "background:var(--override)");

  render(chartFrame({ body: html`<p>body</p>`, above: html`<i class="strip"></i>`, className: "chart-panel" }), container);
  const frame = container.querySelector(".family-chart-frame.chart-panel");
  assert.equal(frame.querySelector(".family-chart-head"), null, "no empty head row");
  assert.ok(frame.querySelector(".strip").compareDocumentPosition(frame.querySelector("p")) & 4, "above sits before the body");
});

test("chartStyles: theme-derived, 11px family-font labels, pan-y, reduced motion", () => {
  const cssText = chartStyles.cssText;
  assert.match(cssText, /prefers-reduced-motion/);
  assert.match(cssText, /touch-action: pan-y/);
  assert.match(cssText, /11px/);
  assert.match(cssText, /var\(--family-font\)/);
  assert.doesNotMatch(cssText, /--status-/);
  assert.doesNotMatch(cssText, /Roboto/);
  assert.match(cssText, /\.family-chart-line\s*\{\s*stroke-width: 4;/);
  assert.match(cssText, /\.family-chart-shadow\s*\{[^}]*stroke-width: 7;/);
  assert.match(cssText, /\.family-chart-time-line\s*\{\s*stroke-dasharray: 3 3;/);
  assert.match(cssText, /\.family-chart:focus-visible\s*\{[^}]*outline: 3px solid var\(--primary-color\);[^}]*outline-offset: -3px;/);
  assert.match(cssText, /@media \(hover: hover\)\s*\{\s*\.family-chart\s*\{\s*cursor: pointer;/);
  assert.match(cssText, /--family-chart-background,\s*color-mix\(in srgb, var\(--family-surface/);
  assert.match(cssText, /border-radius: var\(--family-chart-radius, var\(--tile-border-radius, 12px\)\);/);
});

test("chartStyles: the head wraps and the title can hold a launcher button", () => {
  const block = (selector) => chartStyles.cssText.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))[1];
  assert.match(block(".family-chart-head"), /flex-wrap: wrap;/);
  const title = block(".family-chart-title");
  assert.doesNotMatch(title, /white-space: nowrap|text-overflow|overflow: hidden/, "no forced ellipsis or clipped focus ring");
  assert.match(title, /overflow-wrap: anywhere;/);
});

// ---------------------------------------------------------------- 1.8.0: periods, bands, markers

/** The rendered frame; Lit's per-process marker digits (`<!--?lit$123456789$-->`) are cut to `<!--?lit$-->`. */
const frameHtml = (host, index = 0) =>
  host.shadowRoot.querySelectorAll(".family-chart-frame")[index].outerHTML.replace(/lit\$\d+\$/g, () => "lit$");
const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
/**
 * Two representative 1.7.0 charts: price bars (gap, negative bar, H/L, now marker) and a two-axis
 * line chart with a gradient. The fixtures were written from the unmodified v1.7.0 source before
 * the periods work started; they are never regenerated.
 */
const snapshotCharts = () => {
  const series = price().series[0];
  return [
    price(),
    price({
      id: "weather",
      label: "Weather",
      description: undefined,
      series: [
        { ...series, id: "temperature", label: "Temperature", kind: "line", curve: "smooth", intervalMs: undefined, maxGapMs: 2 * HOUR,
          colorAt: (point) => (point.v > 0.2 ? "red" : "green") },
        { ...series, id: "rain", label: "Rain", kind: "line", curve: "linear", intervalMs: undefined, axis: "secondary", emphasis: "secondary",
          color: "var(--rain)", extremes: false },
      ],
      axes: {
        primary: { includeZero: true, format: (value) => value.toFixed(2) },
        secondary: { min: 0, max: 1, format: (value) => `${Math.round(value * 100)}%` },
      },
    }),
  ];
};

test("a chart without lanes, bands or markers renders byte-identical to 1.7.0", async () => {
  const host = mountHost(snapshotCharts());
  await host.updateComplete;
  for (const [index, name] of ["chart-1.7.0-price.html", "chart-1.7.0-weather.html"].entries()) {
    assert.equal(frameHtml(host, index), readFileSync(fixture(name), "utf8"), name);
  }
  host.remove();
});

const {
  CHART_LANE_PX,
  chartBandSwatch,
  chartPeriodColor,
  chartPeriodLine,
  chartPeriodSwatch,
  chartReadout,
  chartTotalHeight,
} = await import("../dist/index.js");
const { nothing } = await import("lit");

/** The price chart with a charging plan under it: two cars in the 6-hour window. */
const plan = (overrides = {}) => price({
  id: "plan",
  description: undefined,
  lanes: [
    {
      id: "xc40",
      label: "XC40",
      periods: [
        { start: MIDNIGHT + HOUR, end: MIDNIGHT + 2 * HOUR, tone: "active", label: "Charging" },
        { start: MIDNIGHT + 2 * HOUR, end: MIDNIGHT + 3 * HOUR },
        { start: MIDNIGHT + 3 * HOUR, end: MIDNIGHT + 4 * HOUR, tone: "extra", label: "Extra while cheap" },
        { start: MIDNIGHT + 9 * HOUR, end: MIDNIGHT + 10 * HOUR },
      ],
      marker: { t: MIDNIGHT + 5 * HOUR, label: "Ready by 05:00" },
    },
    {
      id: "ex30",
      label: "Volvo EX30 Ultra",
      periods: [{ start: MIDNIGHT, end: MIDNIGHT + 1.5 * HOUR, tone: "warning", color: "tomato" }],
      marker: { t: MIDNIGHT + 8 * HOUR },
    },
  ],
  ...overrides,
});
/** The same prices in a 10-hour window: the plan and a band run four hours past the last published price. */
const longPlan = (overrides = {}) => price({
  id: "long",
  description: undefined,
  domain: { start: MIDNIGHT, end: MIDNIGHT + 10 * HOUR },
  lanes: [
    {
      id: "xc40",
      label: "XC40",
      periods: [{ start: MIDNIGHT + 7 * HOUR, end: MIDNIGHT + 9 * HOUR, tone: "warning", label: "Not enough time" }],
      marker: { t: MIDNIGHT + 9.5 * HOUR, label: "Ready by 09:30" },
    },
    { id: "ex30", label: "EX30", periods: [{ start: MIDNIGHT + HOUR, end: MIDNIGHT + 2 * HOUR, label: "Planned" }] },
  ],
  bands: [{ start: MIDNIGHT + 6 * HOUR, end: MIDNIGHT + 10 * HOUR, label: "no price yet" }],
  ...overrides,
});
const kwh = (value) => formatHassNumber(GB, value, { digits: 4, unit: "€/kWh" });

/** A host that composes the frame the way a card with lanes does: the period line goes under the chart. */
function mountPlanHost(charts) {
  const tag = `chart-plan-host-${++hostCount}`;
  class Host extends LitElement {
    static styles = [chartStyles];
    constructor() {
      super();
      this.chartOptions = charts;
      this.charts = new FamilyChartController(this);
    }
    render() {
      return html`${this.chartOptions.map((options) => {
        const view = this.charts.render(options);
        return chartFrame({ title: options.label, readout: view.readout, legend: view.legend, body: view.svg, below: view.periods });
      })}`;
    }
  }
  customElements.define(tag, Host);
  const host = document.createElement(tag);
  document.body.append(host);
  return host;
}
const press = async (host, name, index = 0) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  slider(host, index).dispatchEvent(event);
  await host.updateComplete;
  return event;
};
const periodLine = (host, index = 0) => host.shadowRoot.querySelectorAll(".family-chart-periods")[index];
const lineItems = (host, index = 0) => [...periodLine(host, index).querySelectorAll(".family-chart-readout-period")];

test("lanes: the SVG grows by the lane rows; the plot, the time labels and the pointer scale stay", async () => {
  const host = mountHost([plan(), price({ id: "plain" })]);
  await host.updateComplete;
  const svg = slider(host);
  assert.equal(chartTotalHeight(190, 2), 240);
  assert.equal(svg.getAttribute("viewBox"), "0 0 360 240", "190 + 2 × 22 + 6");
  assert.equal(slider(host, 1).getAttribute("viewBox"), "0 0 360 190");
  for (const label of svg.querySelectorAll(".family-chart-time")) assert.equal(label.getAttribute("y"), "184", "time labels stay under the plot");
  assert.equal(svg.querySelector(".family-chart-grid").getAttribute("y1"), "166");

  const lanes = [...svg.querySelectorAll("g.family-chart-lane")];
  assert.deepEqual(lanes.map((lane) => lane.dataset.lane), ["xc40", "ex30"]);
  const tracks = lanes.map((lane) => lane.querySelector("rect.family-chart-lane-track"));
  assert.deepEqual(tracks.map((track) => [track.getAttribute("y"), track.getAttribute("height"), track.getAttribute("rx")]), [["202", "10", "5"], ["224", "10", "5"]]);
  const plotLeft = svg.querySelector(".family-chart-grid").getAttribute("x1");
  const plotRight = Number(svg.querySelector(".family-chart-grid").getAttribute("x2"));
  assert.equal(tracks[0].getAttribute("x"), plotLeft);
  assert.ok(Math.abs(Number(tracks[0].getAttribute("x")) + Number(tracks[0].getAttribute("width")) - plotRight) < 1e-9);
  const labels = lanes.map((lane) => lane.querySelector("text.family-chart-lane-label"));
  assert.deepEqual(labels.map((label) => label.textContent), ["XC40", "Volvo E…"], "cut to 8 characters");
  assert.deepEqual(lanes.map((lane) => lane.querySelector(":scope > title").textContent), ["XC40", "Volvo EX30 Ultra"], "the full label is the lane's title");
  assert.deepEqual(labels.map((label) => label.getAttribute("y")), ["207", "229"]);
  assert.equal(Number(labels[0].getAttribute("x")), plotRight + 10);
  // Each label knows the room it was given, up to the right edge of the chart.
  for (const label of labels) assert.ok(Math.abs(Number(label.dataset.room) - (360 - Number(label.getAttribute("x")))) < 0.06);
  assert.ok(plotRight < Number(slider(host, 1).querySelector(".family-chart-grid").getAttribute("x2")), "the gutter widened for the lane label");

  // The now marker and the cursor continue through the lanes; the time labels between stay clear.
  for (const name of ["family-chart-now", "family-chart-cursor"]) {
    const [inPlot, inLanes] = [...svg.querySelectorAll(`line.${name}`)].sort((a, b) => Number(a.getAttribute("y1")) - Number(b.getAttribute("y1")));
    assert.equal(svg.querySelectorAll(`line.${name}`).length, 2, name);
    assert.deepEqual([inPlot.getAttribute("y1"), inPlot.getAttribute("y2")], ["15", "166"]);
    assert.equal(inLanes.dataset.part, "lanes");
    assert.deepEqual([inLanes.getAttribute("y1"), inLanes.getAttribute("y2")], ["196", String(196 + 2 * CHART_LANE_PX)]);
    assert.equal(inLanes.getAttribute("x1"), inPlot.getAttribute("x1"));
    assert.equal(slider(host, 1).querySelectorAll(`line.${name}`).length, 1, "one line without lanes");
  }

  // The pointer still maps the plot: hovering the far left selects the first hour in both charts.
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 360, height: 240 });
  svg.dispatchEvent(pointer("pointermove", { pointerType: "mouse", clientX: 10, clientY: 230 }));
  await host.updateComplete;
  assert.equal(slider(host).getAttribute("aria-valuenow"), "0");
  host.remove();
});

test("periods carry their tone; active is taller, warning and extra are patterned; the lane marker is a tick", async () => {
  const host = mountHost([plan()]);
  await host.updateComplete;
  const svg = slider(host);
  const [xc40, ex30] = svg.querySelectorAll("g.family-chart-lane");
  const periods = [...xc40.querySelectorAll("rect.family-chart-period")];
  assert.deepEqual(periods.map((period) => period.dataset.tone), ["active", "planned", "extra"], "the period after the window is dropped");
  // Active stands 1 px over the track on each side: it differs without colour and without motion.
  assert.deepEqual(periods.map((period) => [period.getAttribute("y"), period.getAttribute("height"), period.getAttribute("rx")]), [["201", "12", "6"], ["202", "10", "5"], ["202", "10", "5"]]);
  for (const period of periods) assert.equal(period.getAttribute("style"), null, "the tone colour comes from chartStyles");
  const hour = (Number(svg.querySelector(".family-chart-grid").getAttribute("x2")) - 8) / 6;
  assert.ok(Math.abs(Number(periods[0].getAttribute("x")) - (8 + hour)) < 1e-6);
  assert.ok(Math.abs(Number(periods[0].getAttribute("width")) - hour) < 1e-6);
  const warning = ex30.querySelector("rect.family-chart-period");
  assert.equal(warning.dataset.tone, "warning");
  assert.equal(warning.getAttribute("style"), "fill:tomato", "an explicit colour overrides the tone colour");
  // Warning is barred upright and extra hatched diagonally: two patterns, neither needs colour.
  const bars = ex30.querySelector("rect.family-chart-period-hatch");
  assert.equal(bars.dataset.pattern, "bars");
  assert.equal(bars.getAttribute("style"), `fill:url(#${chartDefId("plan", "ex30", "bars")})`);
  const hatch = xc40.querySelector("rect.family-chart-period-hatch");
  assert.equal(hatch.dataset.pattern, "hatch");
  assert.equal(xc40.querySelectorAll("rect.family-chart-period-hatch").length, 1, "planned and active are plain");
  const barsPattern = svg.querySelector(`pattern#${chartDefId("plan", "ex30", "bars")}`);
  const hatchPattern = svg.querySelector(`pattern#${chartDefId("plan", "xc40", "hatch")}`);
  assert.equal(barsPattern.getAttribute("patternTransform"), null, "upright bars");
  assert.equal(hatchPattern.getAttribute("patternTransform"), "rotate(45)", "diagonal hatch");
  assert.ok(barsPattern.querySelector("line.family-chart-period-bars-line"));

  const marker = xc40.querySelector("line.family-chart-lane-marker");
  assert.ok(Math.abs(Number(marker.getAttribute("x1")) - (8 + 5 * hour)) < 1e-6);
  assert.deepEqual([marker.getAttribute("y1"), marker.getAttribute("y2")], ["198", "216"], "inside its 22 px row");
  assert.equal(marker.querySelector("title").textContent, "Ready by 05:00");
  assert.equal(ex30.querySelector(".family-chart-lane-marker"), null, "a marker after the window is not drawn");
  assert.equal(xc40.hasAttribute("data-muted"), false);
  host.remove();
});

test("pattern ids are unique per chart and lane, so charts can share a shadow root", async () => {
  const host = mountHost([plan({ id: "garage" }), plan({ id: "street" })]);
  await host.updateComplete;
  const ids = [...host.shadowRoot.querySelectorAll("[id]")].map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids in one shadow root");
  for (const [index, chart] of ["garage", "street"].entries()) {
    const svg = slider(host, index);
    const id = chartDefId(chart, "xc40", "hatch");
    const patterns = [...svg.querySelectorAll("defs pattern")];
    assert.deepEqual(patterns.map((pattern) => pattern.id), [id, chartDefId(chart, "ex30", "bars")], "one per lane and pattern in use");
    for (const pattern of patterns) assert.equal(pattern.getAttribute("patternUnits"), "userSpaceOnUse");
    assert.ok(patterns[0].querySelector("line.family-chart-period-hatch-line"));
    const hatch = svg.querySelector('rect.family-chart-period-hatch[data-pattern="hatch"]');
    assert.equal(hatch.getAttribute("style"), `fill:url(#${id})`);
    const extra = svg.querySelector('rect.family-chart-period[data-tone="extra"]');
    for (const attribute of ["x", "y", "width", "height", "rx"]) assert.equal(hatch.getAttribute(attribute), extra.getAttribute(attribute));
    assert.equal(extra.nextElementSibling, hatch, "the hatch lies over its period");
  }
  assert.notEqual(chartDefId("garage", "xc40", "hatch"), chartDefId("street", "xc40", "hatch"));
  assert.notEqual(chartDefId("garage", "xc40", "hatch"), chartDefId("garage", "xc40", "bars"));
  host.remove();
});

test("a muted lane is grey everywhere: no tone colour, no pattern, no pulse, and it does not read as charging", async () => {
  const muted = (extra = {}) => {
    const options = plan();
    options.lanes = options.lanes.map((lane) => ({ ...lane, muted: true, ...extra }));
    return options;
  };
  const host = mountPlanHost([muted(), muted({ mutedLabel: "Paused" })]);
  host.chartOptions[1].id = "labelled";
  host.requestUpdate();
  await host.updateComplete;
  const svg = slider(host);
  for (const lane of svg.querySelectorAll("g.family-chart-lane")) assert.ok(lane.hasAttribute("data-muted"));
  const periods = [...svg.querySelectorAll("rect.family-chart-period")];
  assert.equal(periods.length, 4);
  for (const period of periods) {
    assert.equal(period.dataset.tone, "muted");
    assert.equal(period.getAttribute("style"), null, "a paused plan ignores period colours");
    assert.equal(period.getAttribute("height"), "10", "nothing stands out, the active period included");
  }
  assert.equal(svg.querySelector(".family-chart-period-hatch"), null);
  assert.equal(svg.querySelector("defs pattern"), null);
  // Only the active tone is animated, so a muted lane stands still.
  assert.match(chartStyles.cssText, /\.family-chart-period\[data-tone="active"\]\s*\{[^}]*animation: family-chart-period-pulse/);
  assert.doesNotMatch(chartStyles.cssText, /\.family-chart-period\[data-tone="muted"\]\s*\{[^}]*animation/);

  // 01:00: the XC40's "Charging" hour and the EX30's tomato-coloured warning.
  await press(host, "Home");
  await press(host, "ArrowRight");
  assert.equal(slider(host).getAttribute("aria-valuetext"), `3 Nov, 1:00 · ${kwh(0.1)} · XC40 Charging (paused) · Volvo EX30 Ultra warning (paused)`);
  assert.deepEqual(lineItems(host).map((item) => [item.dataset.tone, item.textContent.trim()]), [["muted", "XC40 Charging (paused)"], ["muted", "Volvo EX30 Ultra warning (paused)"]]);
  for (const item of lineItems(host)) {
    assert.equal(item.querySelector("i").getAttribute("style"), `background:${chartPeriodColor("muted")}`, "the swatch does not keep the period's own colour");
  }
  assert.match(slider(host).querySelector("desc").textContent, /XC40: Charging \(paused\) 3 Nov, 1:00–3 Nov, 2:00, planned \(paused\) /);
  // With a muted label the lane says that instead.
  await press(host, "Home", 1);
  await press(host, "ArrowRight", 1);
  assert.equal(slider(host, 1).getAttribute("aria-valuetext"), `3 Nov, 1:00 · ${kwh(0.1)} · XC40 Paused · Volvo EX30 Ultra Paused`);
  assert.deepEqual(lineItems(host, 1).map((item) => item.textContent.trim()), ["XC40 Paused", "Volvo EX30 Ultra Paused"]);
  assert.match(slider(host, 1).querySelector("desc").textContent, /XC40: Paused 3 Nov, 1:00–3 Nov, 2:00, Paused 3 Nov, 2:00/);
  host.remove();
});

test("the frame keeps one shape whether the selected time has no, one or two periods", async () => {
  const host = mountPlanHost([plan(), price({ id: "plain" })]);
  await host.updateComplete;
  const frame = () => host.shadowRoot.querySelector(".family-chart-frame");
  const shape = () => ({
    rows: [...frame().children].map((child) => child.className.trim()),
    head: [...frame().querySelector(".family-chart-head").children].map((child) => child.className),
    readout: [...frame().querySelector(".family-chart-readout").children].map((child) => child.tagName.toLowerCase()),
    line: periodLine(host).tagName.toLowerCase(),
  });
  // 04:00 has no period, 00:00 the EX30's, 01:00 both cars'.
  const shapes = [];
  for (const [keys, expected] of [[["End", "ArrowLeft"], []], [["Home"], ["Volvo EX30 Ultra warning"]], [["ArrowRight"], ["XC40 Charging", "Volvo EX30 Ultra warning"]]]) {
    for (const key of keys) await press(host, key);
    assert.deepEqual(lineItems(host).map((item) => item.textContent.trim()), expected, keys.join());
    shapes.push(shape());
  }
  assert.deepEqual(shapes[1], shapes[0], "one period");
  assert.deepEqual(shapes[2], shapes[0], "two periods");
  assert.deepEqual(shapes[0].rows, ["family-chart-head", "family-chart-legend", "family-chart-body", "family-chart-periods"]);
  // The head readout is the 1.7.0 one: the time and the value, nothing that comes and goes.
  assert.deepEqual(shapes[0].readout, ["span", "strong"]);
  assert.equal(host.shadowRoot.querySelector(".family-chart-readout .family-chart-readout-period"), null);
  // The line is one row of fixed height, there even when it is empty.
  const line = chartStyles.cssText.match(/\.family-chart-periods\s*\{([^}]*)\}/)[1];
  assert.match(line, /height: 18px;/);
  assert.match(line, /white-space: nowrap;/);
  assert.match(line, /overflow: hidden;/);
  assert.match(line, /text-overflow: ellipsis;/);
  assert.match(line, /font-size: 12px;/);
  assert.match(line, /color: var\(--secondary-text-color\);/);
  // Each item carries the small swatch of its tone.
  assert.deepEqual(lineItems(host).map((item) => [item.dataset.lane, item.dataset.kind, item.dataset.tone]), [["xc40", "period", "active"], ["ex30", "period", "warning"]]);
  assert.equal(lineItems(host)[0].querySelector("i.family-chart-period-swatch").getAttribute("style"), `background:${chartPeriodColor("active")}`);
  assert.equal(lineItems(host)[1].querySelector("i").getAttribute("style"), `background:${chartPeriodSwatch("warning", "tomato")}`);
  // A chart without lanes has no period line and the frame of 1.7.0.
  const plain = host.shadowRoot.querySelectorAll(".family-chart-frame")[1];
  assert.deepEqual([...plain.children].map((child) => child.className), ["family-chart-head", "family-chart-legend", "family-chart-body"]);
  assert.equal(host.charts.render(price({ id: "plain" })).periods, nothing);
  host.remove();
});

test("hours without a value can be selected by keyboard and pointer; the lanes, their markers and bands are read there", async () => {
  const host = mountPlanHost([longPlan()]);
  await host.updateComplete;
  const svg = () => slider(host);
  const text = () => svg().getAttribute("aria-valuetext");
  assert.equal(svg().getAttribute("aria-valuemax"), "9", "ten hours, six of them with a price");
  // Following now at 02:30, an hour without a price: the cursor stays on now and reads no value.
  assert.equal(text(), "3 Nov, 2:30 · No data");
  assert.equal(svg().getAttribute("aria-valuenow"), "2");
  // End is the last hour of the window, not the last price.
  await press(host, "End");
  assert.equal(svg().getAttribute("aria-valuenow"), "9");
  assert.equal(text(), "3 Nov, 9:00 · No data · XC40 Ready by 09:30 · no price yet", "the lane marker in that hour and the band it lies in");
  assert.equal(svg().querySelector("title").textContent, text());
  const readout = host.shadowRoot.querySelector(".family-chart-readout");
  assert.equal(readout.querySelector("span").textContent, "3 Nov, 9:00");
  const dash = readout.querySelector("strong.family-chart-no-value");
  assert.equal(dash.getAttribute("aria-label"), "No data");
  // The dash keeps the width of the widest value (hidden under it), so the head wraps the same
  // way with and without a value and the frame does not jump between priced and unpriced hours.
  assert.deepEqual([...dash.children].map((child) => [child.tagName.toLowerCase(), child.textContent]), [["b", "–"], ["i", kwh(-0.05)]]);
  assert.equal(dash.querySelector("i.family-chart-value-sizer").getAttribute("aria-hidden"), "true");
  assert.match(chartStyles.cssText, /\.family-chart-value-sizer\s*\{[^}]*height: 0;[^}]*visibility: hidden;/);
  assert.deepEqual(lineItems(host).map((item) => [item.dataset.kind, item.textContent.trim()]), [["marker", "XC40 Ready by 09:30"]]);
  assert.ok(lineItems(host)[0].querySelector("i.family-chart-lane-marker-swatch"));
  // The cursor stands in the middle of that hour, in the plot and in the lanes; there is no dot and no selected bar.
  const hour = (Number(svg().querySelector(".family-chart-grid").getAttribute("x2")) - 8) / 10;
  for (const cursor of svg().querySelectorAll("line.family-chart-cursor")) assert.ok(Math.abs(Number(cursor.getAttribute("x1")) - (8 + 9.5 * hour)) < 1e-6);
  assert.equal(svg().querySelectorAll("g.family-chart-dot").length, 0);
  assert.equal(svg().querySelectorAll(".family-chart-bar.selected").length, 0);
  // The arrows walk on through the hours after the last price.
  await press(host, "ArrowLeft");
  assert.equal(text(), "3 Nov, 8:00 · No data · XC40 Not enough time · no price yet");
  assert.deepEqual(lineItems(host).map((item) => [item.dataset.kind, item.dataset.tone, item.textContent.trim()]), [["period", "warning", "XC40 Not enough time"]]);
  await press(host, "ArrowLeft");
  await press(host, "ArrowLeft");
  assert.equal(text(), "3 Nov, 6:00 · No data · no price yet", "in the band, before the period");
  await press(host, "ArrowLeft");
  assert.equal(text(), `3 Nov, 5:00 · ${kwh(0.2)}`, "back on the last price");
  assert.equal(svg().querySelectorAll(".family-chart-bar.selected").length, 1);
  assert.equal(svg().querySelectorAll("g.family-chart-dot").length, 1);
  await press(host, "ArrowRight");
  assert.equal(svg().getAttribute("aria-valuenow"), "6", "and past it again");
  // The hour whose price is missing is a stop too, where 1.7.0 skipped it.
  await press(host, "Home");
  assert.equal(text(), `3 Nov, 0:00 · ${kwh(-0.05)}`);
  await press(host, "ArrowRight");
  assert.equal(text(), `3 Nov, 1:00 · ${kwh(0.1)} · EX30 Planned`);
  await press(host, "ArrowRight");
  assert.equal(text(), "3 Nov, 2:00 · No data");
  await press(host, "PageUp");
  assert.equal(svg().getAttribute("aria-valuenow"), "3", "a page is an eighth of the stops");
  // The pointer reaches the same hours: hovering the 7th hour previews its period.
  svg().getBoundingClientRect = () => ({ left: 0, top: 0, width: 360, height: 240 });
  svg().dispatchEvent(pointer("pointermove", { pointerType: "mouse", clientX: 8 + 7.4 * hour, clientY: 100 }));
  await host.updateComplete;
  assert.equal(text(), "3 Nov, 7:00 · No data · XC40 Not enough time · no price yet");
  svg().dispatchEvent(pointer("pointerleave", { pointerType: "mouse" }));
  await host.updateComplete;
  assert.equal(svg().getAttribute("aria-valuenow"), "3", "leaving returns to the pinned hour");
  svg().dispatchEvent(pointer("pointerdown", { pointerType: "touch", clientX: 8 + 8.5 * hour, clientY: 100 }));
  await host.updateComplete;
  assert.equal(text(), "3 Nov, 8:00 · No data · XC40 Not enough time · no price yet", "a press pins it");
  // Escape follows now again.
  const escape = await press(host, "Escape");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(text(), "3 Nov, 2:30 · No data");
  host.remove();
});

test("the description lists every period, lane marker, marker and band with its time", async () => {
  const host = mountHost([plan(), longPlan({ markers: [{ t: MIDNIGHT + 6 * HOUR, label: "Day tariff" }, { t: MIDNIGHT + 3 * HOUR }] }), plan({ id: "described", description: "Prices and the plan." })]);
  await host.updateComplete;
  assert.equal(
    slider(host).querySelector("desc").textContent,
    "5 points from 3 Nov, 0:00 to 3 Nov, 6:00."
      + " XC40: Charging 3 Nov, 1:00–3 Nov, 2:00, planned 3 Nov, 2:00–3 Nov, 3:00, Extra while cheap 3 Nov, 3:00–3 Nov, 4:00, Ready by 05:00 (3 Nov, 5:00)."
      + " Volvo EX30 Ultra: warning 3 Nov, 0:00–3 Nov, 1:30.",
  );
  assert.equal(
    slider(host, 1).querySelector("desc").textContent,
    "5 points from 3 Nov, 0:00 to 3 Nov, 10:00."
      + " XC40: Not enough time 3 Nov, 7:00–3 Nov, 9:00, Ready by 09:30 (3 Nov, 9:30)."
      + " EX30: Planned 3 Nov, 1:00–3 Nov, 2:00."
      + " Day tariff: 3 Nov, 6:00."
      + " no price yet: 3 Nov, 6:00–3 Nov, 10:00.",
  );
  assert.equal(slider(host, 2).querySelector("desc").textContent, "Prices and the plan.", "a card's own description is used as given");
  // The text is kept while only the selection moves, and rebuilt when the plan changes.
  const before = slider(host).querySelector("desc").textContent;
  await press(host, "End");
  assert.equal(slider(host).querySelector("desc").textContent, before);
  host.chartOptions = [plan({ lanes: [{ id: "xc40", label: "XC40", periods: [{ start: MIDNIGHT + 4 * HOUR, end: MIDNIGHT + 5 * HOUR, label: "Moved" }] }] })];
  host.requestUpdate();
  await host.updateComplete;
  assert.equal(slider(host).querySelector("desc").textContent, "5 points from 3 Nov, 0:00 to 3 Nov, 6:00. XC40: Moved 3 Nov, 4:00–3 Nov, 5:00.");
  host.remove();
  const bare = mountHost([price({ id: "bare", description: undefined, lanes: [{ id: "a", label: "Robot", periods: [], marker: { t: MIDNIGHT + HOUR } }], bands: [{ start: MIDNIGHT - HOUR, end: MIDNIGHT + HOUR }] })]);
  await bare.updateComplete;
  assert.equal(slider(bare).querySelector("desc").textContent, "5 points from 3 Nov, 0:00 to 3 Nov, 6:00. Robot: marker at 3 Nov, 1:00. Shaded: 3 Nov, 0:00–3 Nov, 1:00.");
  bare.remove();
});

test("chartPeriodLine and chartReadout: the lane items escape their text; the readout takes them only on request", async () => {
  const host = mountHost([plan()]);
  await host.updateComplete;
  const options = plan({
    lanes: [{ id: "x", label: "<b>Car</b>", periods: [{ start: MIDNIGHT, end: MIDNIGHT + 6 * HOUR, label: "<i>Planned</i>" }] }],
  });
  const model = host.charts.render(options).model;
  host.remove();
  const container = document.createElement("div");
  render(chartPeriodLine(model), container);
  const line = container.querySelector(".family-chart-periods");
  assert.equal(line.children.length, 1);
  assert.equal(line.textContent.trim(), "<b>Car</b> <i>Planned</i>");
  assert.equal(line.querySelector("b"), null);
  assert.equal(line.firstElementChild.dataset.tone, "planned");
  // The default readout is the 1.7.0 one; `extra` stays last.
  render(chartReadout(model, { hass: GB, extra: html`<em class="extra">icon</em>` }), container);
  assert.deepEqual([...container.querySelector(".family-chart-readout").children].map((child) => child.tagName.toLowerCase()), ["span", "strong", "em"]);
  // A card whose head has the room can take the items there.
  render(chartReadout(model, { hass: GB, periods: true, extra: html`<em class="extra">icon</em>` }), container);
  const readout = container.querySelector(".family-chart-readout");
  assert.deepEqual([...readout.children].map((child) => child.tagName.toLowerCase()), ["span", "strong", "span", "em"]);
  assert.equal(readout.querySelector(".family-chart-readout-period").textContent.trim(), "<b>Car</b> <i>Planned</i>");
  assert.equal(readout.lastElementChild.className, "extra");
  // Without a period at the selected time the line is empty, not absent.
  const none = host.charts.render(plan({ lanes: [{ id: "x", label: "Car", periods: [] }] }));
  render(none.periods, container);
  assert.equal(container.querySelector(".family-chart-periods").children.length, 0);

  // A card's own valueText gets the periods and the time range they were read for.
  const custom = mountHost([plan({ valueText: (selection) => `${selection.periods.map(({ lane, period }) => `${lane.id}:${period?.tone ?? "-"}`).join(",")} ${(selection.range.end - selection.range.start) / HOUR}h` })]);
  await custom.updateComplete;
  assert.equal(slider(custom).getAttribute("aria-valuetext"), "xc40:-,ex30:- 0h", "following now at 02:30: the planned hour has no tone set");
  await press(custom, "Home");
  assert.equal(slider(custom).getAttribute("aria-valuetext"), "xc40:-,ex30:warning 1h");
  custom.remove();
});

test("chartFrame: `below` sits directly under the body; without it the frame is the 1.7.0 one", () => {
  const container = document.createElement("div");
  render(chartFrame({ title: "T", body: html`<p class="body">body</p>`, below: html`<div class="below">below</div>` }), container);
  const frame = container.querySelector(".family-chart-frame");
  assert.deepEqual([...frame.children].map((child) => child.className), ["family-chart-head", "body", "below"]);
  render(chartFrame({ title: "T", body: html`<p class="body">body</p>`, below: nothing }), container);
  assert.deepEqual([...container.querySelector(".family-chart-frame").children].map((child) => child.className), ["family-chart-head", "body"]);
  render(chartFrame({ title: "T", body: html`<p class="body">body</p>` }), container);
  assert.deepEqual([...container.querySelector(".family-chart-frame").children].map((child) => child.className), ["family-chart-head", "body"]);
});

test("chartLegend: period and band entries follow the series with a swatch that reads without colour", () => {
  const container = document.createElement("div");
  const series = [{ id: "price", label: "Price", points: [], format: String }];
  render(chartLegend(series, {
    gapNote: "Gaps mean missing data",
    periods: [
      { tone: "active", label: "Charging" },
      { tone: "planned", label: "Planned" },
      { tone: "extra", label: "Extra while cheap" },
      { tone: "warning", label: "Not enough time", color: "tomato" },
    ],
    bands: [{ label: "No price yet" }, { label: "Night", pattern: "tint", color: "teal" }],
  }), container);
  const entries = [...container.querySelectorAll(".family-chart-legend > span")];
  assert.deepEqual(entries.map((entry) => entry.textContent.trim()), ["Price", "Charging", "Planned", "Extra while cheap", "Not enough time", "No price yet", "Night", "Gaps mean missing data"]);
  assert.deepEqual(entries.slice(1, 5).map((entry) => entry.dataset.period), ["active", "planned", "extra", "warning"]);
  assert.deepEqual(entries.slice(5, 7).map((entry) => entry.dataset.band), ["hatched", "tint"]);
  const swatch = (tone) => container.querySelector(`[data-period=${tone}] i.family-chart-period-swatch`).getAttribute("style");
  assert.equal(swatch("active"), `background:${chartPeriodColor("active")}`);
  assert.match(swatch("active"), /--family-chart-period-active/);
  assert.match(swatch("planned"), /--family-chart-period-planned/);
  assert.equal(swatch("extra"), `background:${chartPeriodSwatch("extra")}`);
  assert.match(swatch("extra"), /^background:repeating-linear-gradient\(135deg, var\(--family-chart-period-hatch, .*\), var\(--family-chart-period-extra, /, "hatched, so it reads without colour");
  assert.match(swatch("warning"), /^background:repeating-linear-gradient\(90deg, var\(--family-chart-period-hatch, .*\), tomato$/, "upright bars, not the diagonal hatch");
  assert.notEqual(chartPeriodSwatch("warning"), chartPeriodColor("warning"));
  assert.equal(chartPeriodSwatch("muted"), chartPeriodColor("muted"));
  assert.equal(chartPeriodSwatch("planned"), chartPeriodColor("planned"));
  assert.match(chartPeriodSwatch("extra", "teal"), /, teal$/);
  const band = (pattern) => container.querySelector(`[data-band=${pattern}] i.family-chart-band-swatch`).getAttribute("style");
  assert.equal(band("hatched"), `background:${chartBandSwatch()}`);
  assert.match(band("hatched"), /^background:repeating-linear-gradient\(135deg, var\(--family-chart-band, /);
  assert.equal(band("tint"), "background:color-mix(in srgb, teal 55%, transparent)");
  assert.equal(chartBandSwatch("hatched", "tomato"), "repeating-linear-gradient(135deg, tomato 0 1.5px, transparent 1.5px 4px)");
  // Without periods and bands the legend is the 1.7.0 one.
  render(chartLegend(series), container);
  assert.equal(container.querySelectorAll(".family-chart-legend > span").length, 1);
  assert.equal(container.querySelector(".family-chart-period-swatch, .family-chart-band-swatch"), null);
});

test("bands are drawn behind the gridlines: hatched by default, tint on request, with a label when it fits", async () => {
  const host = mountHost([price({
    id: "bands",
    bands: [
      { start: MIDNIGHT + 4 * HOUR, end: MIDNIGHT + 9 * HOUR, label: "no price yet" },
      { start: MIDNIGHT, end: MIDNIGHT + HOUR, label: "no price yet", pattern: "tint" },
      { start: MIDNIGHT + 2 * HOUR, end: MIDNIGHT + 3 * HOUR, color: "tomato" },
      { start: MIDNIGHT + 3 * HOUR, end: MIDNIGHT + 4 * HOUR, pattern: "tint", color: "teal" },
    ],
  }), price({ id: "bands-2", bands: [{ start: MIDNIGHT, end: MIDNIGHT + HOUR }] })]);
  await host.updateComplete;
  const svg = slider(host);
  assert.equal(svg.getAttribute("viewBox"), "0 0 360 190", "bands do not change the height");
  const bands = [...svg.querySelectorAll("rect.family-chart-band")];
  assert.deepEqual(bands.map((band) => band.dataset.pattern), ["hatched", "tint", "hatched", "tint"]);
  for (const band of bands) {
    assert.equal(band.getAttribute("y"), "15");
    assert.equal(band.getAttribute("height"), "151", "plot.top to plot.bottom");
  }
  const plotRight = Number(svg.querySelector(".family-chart-grid").getAttribute("x2"));
  assert.ok(Math.abs(Number(bands[0].getAttribute("x")) + Number(bands[0].getAttribute("width")) - plotRight) < 1e-6, "clipped to the plot");
  assert.equal(bands[0].getAttribute("style"), `fill:url(#${chartDefId("bands", "0", "band")})`);
  assert.equal(bands[1].getAttribute("style"), null, "the tint comes from chartStyles");
  assert.equal(bands[2].getAttribute("style"), `fill:url(#${chartDefId("bands", "2", "band")})`);
  assert.equal(bands[3].getAttribute("style"), "fill:teal");
  const patterns = [...svg.querySelectorAll("defs pattern")];
  assert.deepEqual(patterns.map((pattern) => pattern.id), [chartDefId("bands", "0", "band"), chartDefId("bands", "2", "band")]);
  assert.equal(patterns[0].querySelector("line.family-chart-band-line").getAttribute("style"), null);
  assert.equal(patterns[1].querySelector("line").getAttribute("style"), "stroke:tomato");
  const ids = [...host.shadowRoot.querySelectorAll("[id]")].map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length, "band pattern ids are unique per chart");
  assert.ok(bands[3].compareDocumentPosition(svg.querySelector(".family-chart-grid")) & 4, "bands sit behind the gridlines");
  assert.ok(bands[3].compareDocumentPosition(svg.querySelector(".family-chart-bar")) & 4, "and behind the series");
  const labels = [...svg.querySelectorAll("text.family-chart-band-label")];
  assert.equal(labels.length, 1, "the one-hour band is too narrow for its label");
  assert.equal(labels[0].textContent, "no price yet");
  assert.equal(Number(labels[0].getAttribute("x")), Number(bands[0].getAttribute("x")) + 4);
  assert.equal(labels[0].getAttribute("y"), "23");
  assert.equal(host.shadowRoot.querySelector(".family-chart-value-sizer"), null, "the sized dash belongs to charts with lanes");
  // Without lanes the selection is the 1.7.0 one (series points only); a band over a selected
  // hour is still named: 00:00 lies in the tint band labelled "no price yet".
  await press(host, "Home");
  assert.equal(svg.getAttribute("aria-valuemax"), "4");
  assert.equal(svg.getAttribute("aria-valuetext"), `3 Nov, 0:00 · ${kwh(-0.05)} · no price yet`);
  await press(host, "End");
  assert.equal(svg.getAttribute("aria-valuetext"), `3 Nov, 5:00 · ${kwh(0.2)} · no price yet`);
  await press(host, "ArrowLeft");
  await press(host, "ArrowLeft");
  assert.equal(svg.getAttribute("aria-valuetext"), `3 Nov, 3:00 · ${kwh(0.25)}`, "the bands at 02:00 and 03:00 have no label");
  // A band never takes the pointer from the slider.
  assert.match(chartStyles.cssText, /\.family-chart-band\s*\{[^}]*pointer-events: none;/);
  host.remove();
});

test("markers cross the plot and, over the periods, the lanes; dash, colour and label are optional", async () => {
  const host = mountHost([plan({
    markers: [
      { t: MIDNIGHT + HOUR, label: "Cheap from", dash: true },
      { t: MIDNIGHT + 5 * HOUR, label: "Day tariff", color: "tomato" },
      { t: MIDNIGHT + 3 * HOUR },
      { t: MIDNIGHT + 7 * HOUR, label: "later" },
    ],
  }), price({ id: "no-lanes", markers: [{ t: MIDNIGHT + 3 * HOUR }] })]);
  await host.updateComplete;
  const svg = slider(host);
  const lines = [...svg.querySelectorAll("line.family-chart-marker")];
  assert.equal(lines.length, 6, "three markers inside the window, each across the plot and the lanes");
  const inPlot = lines.filter((line) => line.dataset.part !== "lanes");
  const inLanes = lines.filter((line) => line.dataset.part === "lanes");
  assert.deepEqual(inPlot.map((line) => [line.getAttribute("y1"), line.getAttribute("y2")]), [["1", "166"], ["1", "166"], ["15", "166"]], "a labelled marker reaches up to its label");
  assert.deepEqual(inLanes.map((line) => [line.getAttribute("y1"), line.getAttribute("y2")]), [["196", "240"], ["196", "240"], ["196", "240"]]);
  assert.deepEqual(inPlot.map((line) => line.getAttribute("x1")), inLanes.map((line) => line.getAttribute("x1")));
  assert.deepEqual(inPlot.map((line) => line.classList.contains("family-chart-marker-dash")), [true, false, false]);
  assert.deepEqual(inLanes.map((line) => line.classList.contains("family-chart-marker-dash")), [true, false, false]);
  assert.deepEqual(inPlot.map((line) => line.getAttribute("style")), [null, "stroke:tomato", null]);
  assert.equal(inLanes[1].getAttribute("style"), "stroke:tomato");
  const labels = [...svg.querySelectorAll("text.family-chart-marker-label")];
  assert.deepEqual(labels.map((label) => label.textContent), ["Cheap from", "Day tariff"]);
  assert.deepEqual(labels.map((label) => label.classList.contains("family-chart-marker-label-end")), [false, true], "anchored away from the nearer plot edge");
  assert.equal(Number(labels[0].getAttribute("x")), Number(inPlot[0].getAttribute("x1")) + 4);
  assert.equal(Number(labels[1].getAttribute("x")), Number(inPlot[1].getAttribute("x1")) - 4);
  for (const label of labels) assert.equal(label.getAttribute("y"), "8", "in the top margin, above the plot");
  // Draw order: series, markers in the plot, lane periods, markers across the lanes, then the
  // now marker and the cursor on top of everything.
  const after = (earlier, later, message) => assert.ok(earlier.compareDocumentPosition(later) & 4, message);
  const bars = [...svg.querySelectorAll(".family-chart-bar")];
  const periods = [...svg.querySelectorAll("rect.family-chart-period, rect.family-chart-period-hatch")];
  after(bars.at(-1), inPlot[0], "a marker lies over the series");
  after(inPlot.at(-1), svg.querySelector(".family-chart-now:not([data-part])"), "and under the now marker");
  after(periods.at(-1), inLanes[0], "in the lanes a marker lies over the periods");
  after(inLanes.at(-1), svg.querySelector('.family-chart-now[data-part="lanes"]'), "under the now marker");
  after(inLanes.at(-1), svg.querySelector('.family-chart-cursor[data-part="lanes"]'), "and under the cursor");
  after(svg.querySelector('.family-chart-now[data-part="lanes"]'), svg.querySelector('.family-chart-cursor[data-part="lanes"]'));
  // A marker is neutral by default, so it cannot be taken for the now marker.
  const marker = chartStyles.cssText.match(/\.family-chart-marker\s*\{([^}]*)\}/)[1];
  assert.match(marker, /stroke: var\(--family-chart-marker, color-mix\(in srgb, var\(--primary-text-color\) 55%, transparent\)\);\s*stroke-width: 1\.5;/);
  assert.doesNotMatch(marker, /--primary-color|--family-active/);
  const plain = [...slider(host, 1).querySelectorAll("line.family-chart-marker")];
  assert.equal(plain.length, 1, "without lanes a marker is one line across the plot");
  assert.deepEqual([plain[0].getAttribute("y1"), plain[0].getAttribute("y2")], ["15", "166"]);
  host.remove();
});

test("a colour that is not a colour never reaches a style attribute", async () => {
  const hostile = ["red;background:url(x)", "red;position:fixed"];
  const host = mountPlanHost([plan({
    id: "hostile",
    lanes: [{
      id: "car",
      label: "Car",
      periods: [
        { start: MIDNIGHT, end: MIDNIGHT + 2 * HOUR, color: hostile[0], label: "A" },
        { start: MIDNIGHT + 2 * HOUR, end: MIDNIGHT + 4 * HOUR, tone: "extra", color: hostile[1], label: "B" },
        { start: MIDNIGHT + 4 * HOUR, end: MIDNIGHT + 6 * HOUR, color: "rgb(1, 2, 3)", label: "C" },
      ],
    }],
    bands: [{ start: MIDNIGHT, end: MIDNIGHT + HOUR, color: hostile[0] }, { start: MIDNIGHT + HOUR, end: MIDNIGHT + 2 * HOUR, pattern: "tint", color: hostile[1] }],
    markers: [{ t: MIDNIGHT + HOUR, color: hostile[0] }, { t: MIDNIGHT + 2 * HOUR, color: hostile[1], dash: true }],
  })]);
  await host.updateComplete;
  await press(host, "Home");
  const svg = slider(host);
  assert.deepEqual([...svg.querySelectorAll("rect.family-chart-period")].map((period) => period.getAttribute("style")), [null, null, "fill:rgb(1, 2, 3)"], "the tone default instead");
  assert.equal(svg.querySelector("pattern line.family-chart-band-line").getAttribute("style"), null);
  assert.equal(svg.querySelector('rect.family-chart-band[data-pattern="tint"]').getAttribute("style"), null);
  for (const line of svg.querySelectorAll("line.family-chart-marker")) assert.equal(line.getAttribute("style"), null);
  assert.equal(lineItems(host)[0].querySelector("i").getAttribute("style"), `background:${chartPeriodColor("planned")}`);
  const styles = [...host.shadowRoot.querySelectorAll("[style]")].map((element) => element.getAttribute("style"));
  for (const style of styles) assert.doesNotMatch(style, /position|url\(x\)|;background/, style);
  host.remove();
  const container = document.createElement("div");
  render(chartLegend([], { periods: [{ tone: "warning", label: "W", color: hostile[0] }, { tone: "planned", label: "P", color: hostile[1] }], bands: [{ label: "B", color: hostile[0] }, { label: "T", pattern: "tint", color: hostile[1] }] }), container);
  assert.deepEqual([...container.querySelectorAll("i")].map((swatch) => swatch.getAttribute("style")), [
    `background:${chartPeriodSwatch("warning")}`,
    `background:${chartPeriodColor("planned")}`,
    `background:${chartBandSwatch()}`,
    `background:${chartBandSwatch("tint")}`,
  ]);
  for (const swatch of container.querySelectorAll("i")) assert.doesNotMatch(swatch.getAttribute("style"), /position|url\(x\)/);
});

test("a lane label wider than its room is squeezed into it, measured once per text", async () => {
  // happy-dom has no text metrics (its own method returns 0): stand in 12 px per character.
  const measured = [];
  const textPrototype = window.SVGTextElement.prototype;
  textPrototype.getComputedTextLength = function getComputedTextLength() {
    measured.push(this.textContent);
    return this.textContent.length * 12;
  };
  try {
    const host = mountHost([plan({ lanes: [{ id: "a", label: "WWWWWWWWWW", periods: [] }, { id: "b", label: "EX30", periods: [] }] })]);
    await host.updateComplete;
    const [wide, short] = slider(host).querySelectorAll("text.family-chart-lane-label");
    const room = Number(wide.dataset.room);
    assert.ok(room < 96, `the estimate gave ${room} px, the text measures 96`);
    assert.equal(wide.getAttribute("textLength"), String(room));
    assert.equal(wide.getAttribute("lengthAdjust"), "spacingAndGlyphs");
    assert.equal(short.getAttribute("textLength"), null, "a label that fits is left alone");
    assert.deepEqual(measured, ["WWWWWWW…", "EX30"]);
    host.requestUpdate();
    await host.updateComplete;
    assert.equal(measured.length, 2, "not measured again while text and room stay");
    assert.equal(slider(host).querySelector("text.family-chart-lane-label").getAttribute("textLength"), String(room));
    // A new label is measured afresh and loses the squeeze when it fits.
    host.chartOptions = [plan({ lanes: [{ id: "a", label: "Car", periods: [] }, { id: "b", label: "EX30", periods: [] }] })];
    host.requestUpdate();
    await host.updateComplete;
    const renamed = slider(host).querySelector("text.family-chart-lane-label");
    assert.equal(renamed.textContent, "Car");
    assert.equal(renamed.getAttribute("textLength"), null);
    assert.deepEqual(measured.slice(2), ["Car", "EX30"], "the gutter narrowed, so both labels have a new room");
    host.remove();
  } finally {
    delete textPrototype.getComputedTextLength;
  }
});

test("empty, loading and error states take the total height of a chart with lanes, and keep the period line", async () => {
  const empty = plan({ series: [{ ...price().series[0], points: [{ t: MIDNIGHT, v: null }] }], bands: [{ start: MIDNIGHT, end: MIDNIGHT + 6 * HOUR }] });
  const host = mountPlanHost([empty]);
  await host.updateComplete;
  assert.equal(slider(host), undefined, "bands and lanes are not data");
  assert.match(host.shadowRoot.querySelector(".family-chart-body.family-chart-empty").getAttribute("style"), /min-height:240px/);
  assert.ok(periodLine(host), "the line is there, so the frame does not grow when the data arrives");
  assert.equal(periodLine(host).children.length, 0);
  host.remove();
  const container = document.createElement("div");
  render(chartSkeleton({ height: 190, lanes: 2, label: "Loading plan" }), container);
  assert.match(container.querySelector(".family-chart-skeleton").getAttribute("style"), /height:240px/);
  render(chartSkeleton({ height: 40, lanes: 1, label: "Loading plan" }), container);
  assert.match(container.querySelector(".family-chart-skeleton").getAttribute("style"), /height:110px/, "82 + 22 + 6");
  render(chartState({ height: 190, lanes: 2, state: "error", message: "Could not load the plan." }), container);
  assert.match(container.querySelector(".family-chart-empty").getAttribute("style"), /min-height:240px/);
  assert.match(container.querySelector(".family-chart-empty").textContent, /Could not load the plan\./);
});

test("chartStyles: period, band and marker colours are overridable; outlines, patterns and the pulse do not rely on colour", () => {
  const cssText = chartStyles.cssText;
  const block = (selector) => cssText.match(new RegExp(`(?:^|[\\s,}])${selector.replace(/[.[\]"=]/g, "\\$&")}\\s*\\{([^}]*)\\}`))[1];
  assert.match(block(".family-chart-period"), /fill: var\(--family-chart-period-planned, color-mix\(in srgb, var\(--family-chart-series-1, var\(--family-active, var\(--primary-color\)\)\) 75%, transparent\)\);/);
  // Every period has an outline in a text-colour mix, so a pale tone is still a shape.
  assert.match(block(".family-chart-period"), /stroke: var\(--family-chart-period-outline, color-mix\(in srgb, var\(--primary-text-color\) 60%, transparent\)\);\s*stroke-width: 1;/);
  assert.match(block('.family-chart-period[data-tone="active"]'), /fill: var\(--family-chart-period-active, var\(--family-success, var\(--success-color, #43a047\)\)\);/);
  assert.match(block('.family-chart-period[data-tone="active"]'), /animation: family-chart-period-pulse var\(--family-chart-period-active-duration, 2\.4s\) ease-in-out infinite;/);
  assert.match(block('.family-chart-period[data-tone="extra"]'), /fill: var\(--family-chart-period-extra, color-mix\(/);
  assert.match(block('.family-chart-period[data-tone="warning"]'), /fill: var\(--family-chart-period-warning, var\(--family-warning, var\(--warning-color, #ff9800\)\)\);/);
  assert.match(block('.family-chart-period[data-tone="muted"]'), /fill: var\(--family-chart-period-muted, color-mix\(in srgb, var\(--primary-text-color\) 22%, transparent\)\);/);
  assert.match(cssText, /@keyframes family-chart-period-pulse\s*\{\s*0%,\s*100%\s*\{\s*opacity: 1;\s*\}\s*50%\s*\{\s*opacity: 0\.55;\s*\}\s*\}/);
  const reduced = cssText.slice(cssText.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.family-chart-period\[data-tone="active"\]\s*\{\s*animation: none;\s*\}/);
  assert.match(block(".family-chart-lane-track"), /fill: none;[^}]*stroke: var\(--family-chart-grid,/);
  assert.match(block(".family-chart-period-hatch-line"), /stroke: var\(--family-chart-period-hatch, color-mix\(in srgb, var\(--primary-text-color\) 50%, transparent\)\);/);
  assert.match(block(".family-chart-band-line"), /stroke: var\(--family-chart-band, color-mix\(in srgb, var\(--primary-text-color\) 14%, transparent\)\);/);
  assert.match(block('.family-chart-band[data-pattern="tint"]'), /fill: var\(--family-chart-band,[^;]*;\s*opacity: 0\.55;/);
  assert.match(block(".family-chart-marker-dash"), /stroke-dasharray: 3 3;/);
  assert.doesNotMatch(block(".family-chart-period"), /gradient/, "periods are flat");
  // Text anchors stay left to right inside a right-to-left document.
  assert.match(cssText, /svg\.family-chart\s*\{\s*direction: ltr;\s*\}/);
  // Swatches keep their paint in forced colours and in print.
  const kept = cssText.match(/\.family-chart-legend i,\s*\.family-chart-period-swatch,\s*\.family-chart-band-swatch,\s*\.family-chart-lane-marker-swatch\s*\{([^}]*)\}/)[1];
  assert.match(kept, /forced-color-adjust: none;/);
  assert.match(kept, /print-color-adjust: exact;/);
  // The swatches are outlined like the periods they stand for.
  assert.match(cssText, /\.family-chart-readout-period \.family-chart-period-swatch\s*\{[^}]*border: 1px solid var\(--family-chart-period-outline,/);
});
