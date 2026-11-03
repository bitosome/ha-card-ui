import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
const window = new Window({ url: "http://localhost" });
for (const key of ["window", "document", "Document", "HTMLElement", "Element", "customElements", "CSSStyleSheet", "Event", "CustomEvent"]) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true });
}
const { render } = await import("lit");
const { mediaButton, mediaControls, mediaZoomReset, mediaNavigation, mediaMessage, mediaControlStyles } = await import("../dist/index.js");

const mount = (template) => {
  const container = document.createElement("div");
  render(template, container);
  return container;
};

test("media buttons name their next action and swap to the active icon", () => {
  let clicks = 0;
  const row = mount(mediaControls([
    mediaButton({ icon: "mdi:high-definition", activeIcon: "mdi:standard-definition", label: "Use SD stream", active: true, onClick: () => clicks++ }),
    mediaButton({ icon: "mdi:fullscreen", activeIcon: "mdi:fullscreen-exit", label: "Enter fullscreen", onClick() {} }),
  ])).querySelector(".family-media-controls");
  assert.equal(row.getAttribute("role"), "toolbar");
  const [hd, full] = row.querySelectorAll("button.family-media-button");
  assert.ok(hd.classList.contains("active"));
  assert.equal(hd.querySelector("ha-icon").icon, "mdi:standard-definition");
  assert.equal(hd.getAttribute("aria-label"), "Use SD stream");
  assert.equal(hd.hasAttribute("aria-pressed"), false, "view controls do not expose a pressed state");
  assert.ok(hd.hasAttribute("data-media-control"), "zoom gestures ignore the controls");
  assert.equal(full.querySelector("ha-icon").icon, "mdi:fullscreen");
  hd.click();
  assert.equal(clicks, 1);
  const preset = mount(mediaButton({ icon: "mdi:home", label: "Home", pressed: true, pending: true, onClick() {} })).querySelector("button");
  assert.equal(preset.getAttribute("aria-pressed"), "true");
  assert.equal(preset.getAttribute("aria-busy"), "true");
  assert.ok(preset.querySelector(".family-pending-indicator"));
});

test("zoom reset only shows when zoomed and navigation arrows are labelled", () => {
  assert.equal(mount(mediaZoomReset({ scale: 1, onClick() {} })).querySelector("button"), null);
  const reset = mount(mediaZoomReset({ scale: 2.5, onClick() {}, hass: { locale: { language: "en", number_format: "language" } } })).querySelector("button");
  assert.match(reset.textContent, /2\.5×/);
  assert.equal(reset.getAttribute("aria-label"), "Reset zoom");
  const nav = mount(mediaNavigation({ onPrevious() {}, onNext() {} }));
  assert.deepEqual([...nav.querySelectorAll(".family-media-nav")].map((b) => b.getAttribute("aria-label")), ["Previous camera", "Next camera"]);
  const message = mount(mediaMessage("Loading camera…", { icon: "mdi:camera-outline" })).querySelector(".family-media-message");
  assert.equal(message.getAttribute("role"), "status");
  assert.match(message.textContent, /Loading camera…/);
});

test("the control row is Camera Card's compact row, and fullscreen keeps it", () => {
  const css = mediaControlStyles.cssText;
  assert.match(css, /\.family-media-controls\s*\{[^}]*top: var\(--family-media-inset-top, 8px\);[^}]*right: var\(--family-media-inset-right, 8px\);[^}]*justify-content: flex-end;[^}]*gap: 8px;/);
  assert.match(css, /\.family-media-button\s*\{[^}]*width: var\(--family-media-button-size, 44px\);[^}]*border-radius: var\(--tile-border-radius, 12px\);[^}]*background: rgba\(0, 0, 0, 0\.42\);/);
  // Fullscreen only grows the insets for notches; there is no separate desktop layout.
  assert.match(css, /:fullscreen\s*\{\s*--family-media-inset-top: max\(8px,/);
  assert.match(css, /\.family-media-fullscreen,\s*\[data-media-fullscreen\]\s*\{\s*--family-media-inset-top: max\(8px,/);
  const row = css.match(/\.family-media-controls\s*\{[^}]*\}/)[0];
  assert.doesNotMatch(row, /%/, "no percentage positions in the shared row");
});
