import assert from "node:assert/strict";
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
