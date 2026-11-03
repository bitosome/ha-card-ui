import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
const window = new Window({ url: "http://localhost" });
for (const key of ["window", "document", "Document", "HTMLElement", "Element", "customElements", "CSSStyleSheet", "Event", "CustomEvent"]) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true });
}
const { render } = await import("lit");
const {
  actionPill,
  togglePill,
  stateChip,
  notice,
  asyncState,
  componentStyles,
  familyStyles,
  TONE_ICONS,
} = await import("../dist/index.js");

const mount = (template) => {
  const container = document.createElement("div");
  render(template, container);
  return container;
};

test("actionPill supports quiet emphasis, initial focus and contextual names", () => {
  const quiet = mount(actionPill({ label: "Reload", emphasis: "quiet", onClick() {} })).querySelector("button");
  assert.ok(quiet.classList.contains("quiet"));
  assert.ok(!quiet.classList.contains("primary"));
  assert.ok(!quiet.hasAttribute("data-family-initial-focus"));
  const cancel = mount(actionPill({ label: "Cancel", initialFocus: true, ariaLabel: "Cancel power off", hasPopup: "dialog", onClick() {} })).querySelector("button");
  assert.ok(cancel.hasAttribute("data-family-initial-focus"));
  assert.equal(cancel.getAttribute("aria-label"), "Cancel power off");
  assert.equal(cancel.getAttribute("aria-haspopup"), "dialog");
  const legacy = mount(actionPill({ label: "Delete", primary: true, destructive: true, onClick() {} })).querySelector("button");
  assert.ok(legacy.classList.contains("primary") && legacy.classList.contains("destructive"));
  const plain = mount(actionPill({ label: "Open", onClick() {} })).querySelector("button");
  assert.ok(!plain.hasAttribute("aria-label") && !plain.hasAttribute("aria-haspopup"));
});

test("togglePill exposes aria-pressed and a visible check when selected", () => {
  let clicks = 0;
  const on = mount(togglePill({ label: "Schedule", icon: "mdi:calendar", pressed: true, onClick: () => clicks++ })).querySelector("button");
  assert.equal(on.getAttribute("aria-pressed"), "true");
  const icons = [...on.querySelectorAll("ha-icon")].map((node) => node.icon);
  assert.deepEqual(icons, ["mdi:calendar", "mdi:check"], "keeps its identity icon and adds a check");
  on.click();
  assert.equal(clicks, 1);
  const off = mount(togglePill({ label: "Schedule", icon: "mdi:calendar", pressed: false, onClick() {} })).querySelector("button");
  assert.equal(off.getAttribute("aria-pressed"), "false");
  assert.equal(off.querySelector("ha-icon").icon, "mdi:calendar");
  assert.ok(off.querySelector(".family-toggle-check"), "the check keeps its slot so selection never shifts layout");
  const busy = mount(togglePill({ label: "Schedule", pressed: true, pending: true, onClick() {} })).querySelector("button");
  assert.ok(busy.disabled);
  assert.equal(busy.getAttribute("aria-busy"), "true");
  assert.ok(busy.querySelector(".family-pending-indicator"));
});

test("stateChip carries an accessible name, secondary line and popup hint", () => {
  const chip = mount(stateChip({ label: "Front left", ariaLabel: "Front left door open", tone: "warning", secondary: "since 14:35" })).querySelector(".family-chip");
  assert.equal(chip.hasAttribute("role"), false, "no role=img, which would hide the visible lines");
  assert.equal(chip.querySelector(".family-chip-text").getAttribute("aria-hidden"), "true");
  assert.equal(chip.querySelector(".family-visually-hidden").textContent, "Front left door open, since 14:35");
  assert.equal(chip.querySelector(".family-chip-secondary").textContent, "since 14:35");
  const named = mount(stateChip({ label: "Front left", ariaLabel: "Front left door open", secondary: "since 14:35", onClick() {} })).querySelector("button");
  assert.equal(named.getAttribute("aria-label"), "Front left door open, since 14:35");
  const button = mount(stateChip({ label: "Charging", onClick() {}, hasPopup: "dialog", className: "charge" })).querySelector("button");
  assert.equal(button.getAttribute("aria-haspopup"), "dialog");
  assert.ok(button.classList.contains("charge"));
  const plain = mount(stateChip({ label: "Idle" })).querySelector(".family-chip");
  assert.ok(!plain.hasAttribute("aria-label"));
  assert.equal(plain.querySelector(".family-visually-hidden"), null);
  assert.equal(plain.querySelector(".family-chip-text").hasAttribute("aria-hidden"), false);
});

test("notice shows a severity icon, title, body and several recovery actions", () => {
  const actions = [];
  const box = mount(notice({
    tone: "warning",
    title: "Water tank empty",
    message: "Refill it to continue mopping.",
    body: "Kitchen and Hall are waiting.",
    action: { label: "I refilled the tank", primary: true, onClick: () => actions.push("refill") },
    actions: [{ label: "Skip mopping", onClick: () => actions.push("skip") }],
  })).querySelector(".family-notice");
  assert.equal(box.getAttribute("role"), "status");
  assert.equal(box.querySelector(".family-notice-icon").icon, TONE_ICONS.warning);
  assert.equal(box.querySelector(".family-notice-title").textContent, "Water tank empty");
  assert.equal(box.querySelector(".family-notice-body").textContent, "Kitchen and Hall are waiting.");
  const buttons = box.querySelectorAll(".family-notice-actions button");
  assert.equal(buttons.length, 2);
  buttons.forEach((button) => button.click());
  assert.deepEqual(actions, ["refill", "skip"]);
  const error = mount(notice({ tone: "error", message: "Failed" })).querySelector(".family-notice");
  assert.equal(error.getAttribute("role"), "alert");
  const quiet = mount(notice({ message: "Saved", icon: false })).querySelector(".family-notice");
  assert.equal(quiet.querySelector(".family-notice-icon"), null);
  assert.equal(quiet.querySelector(".family-notice-actions"), null);
});

test("asyncState keeps loading, empty and failed history distinct", () => {
  const loading = mount(asyncState({ state: "loading" })).firstElementChild;
  assert.equal(loading.getAttribute("role"), "status");
  assert.equal(loading.hasAttribute("aria-busy"), false, "aria-busy would mute the live region");
  assert.ok(loading.querySelector(".family-pending-indicator"));
  const empty = mount(asyncState({ state: "empty", message: "No activity yet" })).firstElementChild;
  assert.equal(empty.textContent.trim(), "No activity yet");
  assert.notEqual(empty.getAttribute("role"), "alert");
  let retried = 0;
  const failed = mount(asyncState({ state: "error", message: "Could not load activity", onRetry: () => retried++ })).querySelector(".family-notice");
  assert.equal(failed.getAttribute("role"), "alert");
  const retry = failed.querySelector("button");
  assert.match(retry.textContent, /Try again/);
  retry.click();
  assert.equal(retried, 1);
  const retrying = mount(asyncState({ state: "error", onRetry() {}, retrying: true })).querySelector("button");
  assert.ok(retrying.disabled);
});

test("every tone resolves through one family alias chain that keeps HA theme overrides", () => {
  const css = componentStyles.cssText;
  for (const tone of ["success", "caution", "warning", "error", "unavailable"]) {
    assert.match(css, new RegExp(`\\[data-tone="${tone}"\\]\\s*\\{\\s*--family-tone: var\\(--family-${tone}`));
  }
  const family = familyStyles.cssText;
  // HA theme colours win, so user themes keep working; the family palette is the fallback.
  assert.match(family, /--family-success: var\(--success-color, var\(--status-success-color, #66bb6a\)\)/);
  assert.match(family, /--family-warning: var\(--warning-color, var\(--status-warn-color, #ff9800\)\)/);
  assert.match(family, /--family-error: var\(--error-color, var\(--status-alert-color, #e53935\)\)/);
  assert.match(family, /--family-unavailable: var\(--secondary-text-color\)/);
  // Unavailable chips are not overridden by the generic toned-chip text colour.
  assert.match(css, /\.family-chip\[data-tone\]:not\(\[data-tone="neutral"\]\):not\(\[data-tone="unavailable"\]\)/);
  assert.match(css, /\.family-chip\[data-tone="unavailable"\]\s*\{[^}]*color: var\(--family-unavailable/);
  assert.match(css, /\.family-action\.quiet\s*\{[^}]*background: transparent/);
  assert.match(css, /\.family-toggle\[aria-pressed="true"\]/);
});

test("an unpressed toggle centres its label instead of reserving an invisible check", () => {
  const css = componentStyles.cssText;
  // The check keeps its slot, so a card's own toggle padding can never make selection change width.
  assert.match(css, /\.family-toggle\[aria-pressed="false"\] \.family-toggle-check\s*\{\s*visibility: hidden;/);
  assert.doesNotMatch(css, /family-toggle-check\s*\{\s*display:\s*none/);
  assert.doesNotMatch(css, /padding-inline: 29px/);
  // Half of (22px check + 8px gap) moves the label to the visual centre without affecting layout.
  assert.match(css, /\.family-toggle:where\(\[aria-pressed="false"\]:has\(> \.family-toggle-check\)\) > :where\(:not\(\.family-toggle-check\)\)\s*\{\s*translate: 15px 0;/);
});
