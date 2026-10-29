import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
const window = new Window({ url: "http://localhost" });
for (const key of [
  "window",
  "document",
  "Document",
  "HTMLElement",
  "Element",
  "HTMLDialogElement",
  "customElements",
  "CSSStyleSheet",
  "Event",
  "CustomEvent",
  "PointerEvent",
]) {
  Object.defineProperty(globalThis, key, {
    value: window[key],
    configurable: true,
  });
}
const { render, html } = await import("lit");
const {
  FamilyFlowController,
  renderFamilyDialog,
  buildGlow,
  glowStyles,
  componentStyles,
  familyStyles,
  dialogStyles,
  pendingIndicator,
  actionPill,
  stateChip,
  metricTile,
  showEntityMoreInfo,
} = await import("../dist/index.js");

function setup(options = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  let updates = 0;
  const flow = new FamilyFlowController(
    {
      requestUpdate() {
        updates++;
      },
    },
    options,
  );
  const draw = (
    content = html`<input aria-label="Name" data-family-initial-focus />`,
  ) => {
    render(
      renderFamilyDialog(flow, { title: flow.current || "Closed", content }),
      container,
    );
    const dialog = container.querySelector("dialog");
    if (dialog && !dialog.dataset.mocked) {
      dialog.dataset.mocked = "yes";
      dialog.showModal = () => {
        dialog.open = true;
      };
      dialog.close = () => {
        dialog.open = false;
        dialog.dispatchEvent(new Event("close"));
      };
      dialog.getBoundingClientRect = () => ({
        left: 20,
        right: 300,
        top: 20,
        bottom: 400,
      });
    }
    flow.hostUpdated();
    return dialog;
  };
  return { flow, container, draw, updates: () => updates };
}
test("Back pops one child; X closes whole flow", () => {
  const { flow } = setup();
  flow.open("settings");
  flow.push("history");
  flow.push("session");
  assert.deepEqual(flow.stack, ["settings", "history", "session"]);
  flow.back();
  assert.equal(flow.current, "history");
  flow.close();
  assert.equal(flow.active, false);
});
test("dirty dismissal is shared by close, back and navigation", () => {
  for (const intent of ["close", "back", "replace"]) {
    let dirty = false,
      discarded = 0;
    const { flow } = setup({
      guard: () => ({
        dirty,
        discard: () => {
          dirty = false;
          discarded++;
        },
      }),
    });
    flow.open("settings");
    flow.push("editor");
    dirty = true;
    flow[intent]("other");
    assert.equal(flow.current, "editor");
    assert.ok(flow.confirmation);
    flow.discardAndContinue();
    assert.equal(discarded, 1);
    assert.equal(
      flow.current,
      intent === "close" ? undefined : intent === "back" ? "settings" : "other",
    );
  }
});
test("Keep editing and Escape from confirmation preserve draft", () => {
  let dirty = false;
  const { flow } = setup({ guard: () => ({ dirty }) });
  flow.open("editor");
  dirty = true;
  flow.close();
  const event = new Event("cancel", { cancelable: true });
  flow.onCancel(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(flow.current, "editor");
  assert.equal(flow.confirmation, "");
  assert.equal(dirty, true);
});
test("pending blocks close without pretending request was cancelled", () => {
  let pending = false;
  const { flow } = setup({ guard: () => ({ pending }) });
  flow.open("save");
  pending = true;
  assert.equal(flow.close(), false);
  assert.equal(flow.active, true);
  assert.match(flow.notice, /request/);
  pending = false;
  flow.close();
  assert.equal(flow.active, false);
});
test("pending state is rechecked after discard dialog opened", () => {
  let dirty = false,
    pending = false,
    discarded = false;
  const { flow } = setup({
    guard: () => ({
      dirty,
      pending,
      discard: () => {
        discarded = true;
        dirty = false;
      },
    }),
  });
  flow.open("editor");
  dirty = true;
  flow.close();
  pending = true;
  flow.discardAndContinue();
  assert.equal(discarded, false);
  assert.equal(flow.active, true);
  pending = false;
  flow.discardAndContinue();
  assert.equal(discarded, true);
  assert.equal(flow.active, false);
});
test("old operation token cannot close a subsequently opened or navigated flow", () => {
  const { flow } = setup();
  flow.open("editor");
  const old = flow.generation;
  flow.close();
  flow.open("editor");
  assert.equal(flow.isCurrent(old), false);
  const next = flow.generation;
  flow.push("child");
  assert.equal(flow.isCurrent(next), false);
});
test("guarded HA handoff runs once after discard and closes the custom layer", () => {
  let dirty = false,
    count = 0;
  const { flow, draw } = setup({
    guard: () => ({
      dirty,
      discard: () => {
        dirty = false;
      },
    }),
  });
  flow.open("settings");
  draw();
  dirty = true;
  flow.handoff(() => {
    count++;
    assert.equal(flow.active, false);
  });
  assert.equal(count, 0);
  flow.discardAndContinue();
  flow.discardAndContinue();
  assert.equal(count, 1);
});
test("same native dialog and input survive telemetry and child navigation", () => {
  const { flow, draw, container } = setup();
  flow.open("settings");
  const first = draw();
  const input = container.querySelector("input");
  input.value = "draft";
  input.focus();
  input.setSelectionRange(2, 2);
  assert.equal(draw(), first);
  assert.equal(container.querySelector("input"), input);
  assert.equal(input.value, "draft");
  assert.equal(input.selectionStart, 2);
  flow.push("child");
  assert.equal(draw(), first);
  assert.equal(first.open, true);
});
test("Back and X are accessible and distinct", () => {
  const { flow, draw, container } = setup();
  flow.open("settings");
  flow.push("price");
  draw();
  assert.ok(container.querySelector('[aria-label="Back"]'));
  assert.ok(container.querySelector('[aria-label="Close price"]'));
  container.querySelector('[aria-label="Back"]').click();
  assert.equal(flow.current, "settings");
  draw();
  assert.equal(container.querySelector('[aria-label="Back"]'), null);
});
test("backdrop requires pointer down and up outside, never a content drag", () => {
  const { flow, draw } = setup();
  flow.open("details");
  const dialog = draw();
  const point = (type, x, y) =>
    dialog.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y }));
  point("pointerdown", 50, 50);
  point("pointerup", 0, 0);
  assert.equal(flow.active, true);
  point("pointerdown", 0, 0);
  dialog.dispatchEvent(new PointerEvent("pointercancel"));
  point("pointerup", 0, 0);
  assert.equal(flow.active, true);
  point("pointerdown", 0, 0);
  point("pointerup", 0, 0);
  assert.equal(flow.active, false);
});
test("final close restores focus; teardown never steals focus", () => {
  const button = document.createElement("button");
  document.body.append(button);
  button.focus();
  const { flow, draw } = setup();
  flow.open("details", button);
  draw();
  flow.close();
  assert.equal(document.activeElement, button);
  flow.open("details", button);
  const dialog = draw();
  const external = document.createElement("button");
  document.body.append(external);
  external.focus();
  flow.hostDisconnected();
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, external);
});
test("hidden draft remains intact while discard confirmation is visible", () => {
  let dirty = false;
  const { flow, draw, container } = setup({ guard: () => ({ dirty }) });
  flow.open("editor");
  draw();
  const input = container.querySelector("input");
  input.value = "unchanged draft";
  dirty = true;
  flow.close();
  draw();
  assert.equal(container.querySelector("input"), input);
  assert.ok(input.closest("[hidden]"));
  flow.keepEditing();
  draw();
  assert.equal(input.value, "unchanged draft");
  assert.equal(input.closest("[hidden]"), null);
});
test("Keep editing restores the draft focus and scroll position", () => {
  let dirty = false;
  const { flow, draw, container } = setup({ guard: () => ({ dirty }) });
  flow.open("editor");
  const dialog = draw();
  const input = container.querySelector("input");
  input.focus();
  dialog.querySelector(".family-dialog-body").scrollTop = 120;
  dirty = true;
  flow.close();
  draw();
  flow.keepEditing();
  draw();
  assert.equal(document.activeElement, input);
  assert.equal(dialog.querySelector(".family-dialog-body").scrollTop, 120);
});
test("child starts at top and Back restores parent scroll", () => {
  const { flow, draw } = setup();
  flow.open("settings");
  const dialog = draw();
  dialog.querySelector(".family-dialog-body").scrollTop = 240;
  flow.push("child");
  draw();
  assert.equal(dialog.querySelector(".family-dialog-body").scrollTop, 0);
  dialog.querySelector(".family-dialog-body").scrollTop = 80;
  flow.back();
  draw();
  assert.equal(dialog.querySelector(".family-dialog-body").scrollTop, 240);
});
test("native more-info adapter includes the entity and bubbles across shadow boundaries", () => {
  const target = document.createElement("div");
  let captured;
  target.addEventListener("hass-more-info", (e) => {
    captured = e;
  });
  showEntityMoreInfo(target, "sensor.example");
  assert.equal(captured.detail.entityId, "sensor.example");
  assert.equal(captured.bubbles, true);
  assert.equal(captured.composed, true);
});
test("Space Hub glow stays inactive without an active domain state", () => {
  const colors = { weak: "red", strong: "blue" };
  assert.equal(buildGlow(colors, "static", false).style, "");
  assert.equal(buildGlow(colors, "none", true).style, "");
  assert.match(buildGlow(colors, "static", true).style, /0 18px 40px/);
  assert.match(buildGlow(colors, "pulse", true).style, /2.4s/);
  assert.match(glowStyles.cssText, /z-index:\s*0/);
  assert.match(glowStyles.cssText, /z-index:\s*1/);
  assert.match(glowStyles.cssText, /prefers-reduced-motion/);
});
test("shared actions prevent duplicate pending clicks and chips escape labels", () => {
  const node = document.createElement("div");
  let clicks = 0;
  render(
    html`${actionPill({
      label: "Save",
      pending: true,
      onClick: () => clicks++,
    })}${stateChip({ label: "<script>alert(1)</script>" })}${metricTile({
      label: "Power",
      value: "0",
      available: false,
    })}`,
    node,
  );
  assert.equal(node.querySelector("button").disabled, true);
  assert.equal(node.querySelector("script"), null);
  assert.match(node.textContent, /Unavailable/);
});

test("glow scope keeps wrappers neutral and every shared surface above the underlayer", () => {
  const style = document.createElement("style");
  style.textContent = `${familyStyles.cssText} ${componentStyles.cssText} ${glowStyles.cssText}`;
  document.head.append(style);
  const scope = document.createElement("main");
  scope.className = "family-tile-group";
  scope.innerHTML = `<div class="family-notice">Preceding notice</div>
    <section class="layout-grid"><div class="family-tile-wrap">
      <div class="glow-under"></div><div class="family-tile-face">Active tile</div>
    </div></section><article class="family-surface">Following panel</article>`;
  document.body.append(scope);
  try {
    const computed = (selector) => window.getComputedStyle(scope.querySelector(selector));
    assert.equal(window.getComputedStyle(scope).isolation, "isolate");
    for (const selector of [".layout-grid", ".family-tile-wrap"]) {
      const styles = computed(selector);
      assert.ok(["", "auto"].includes(styles.zIndex));
      assert.ok(["", "auto"].includes(styles.isolation));
      assert.ok(["", "none"].includes(styles.transform));
      assert.ok(["", "none"].includes(styles.filter));
      assert.ok(["", "1"].includes(styles.opacity));
    }
    assert.equal(computed(".glow-under").zIndex, "0");
    assert.equal(computed(".glow-under").pointerEvents, "none");
    for (const selector of [".family-notice", ".family-tile-face", ".family-surface"]) {
      assert.equal(computed(selector).position, "relative");
      assert.equal(computed(selector).zIndex, "1");
    }
  } finally {
    scope.remove();
    style.remove();
  }
});


test("pending actions replace their decorative icon, block repeats and restore ready behavior", () => {
  const node = document.createElement("div");
  let calls = 0;
  const draw = (pending) => render(actionPill({
    label: "Unlock", icon: "mdi:lock-outline", pending,
    pendingLabel: "Unlocking…", onClick: () => calls++,
  }), node);
  draw(true);
  const button = node.querySelector("button");
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal(button.textContent.trim(), "Unlocking…");
  assert.equal(button.querySelector("ha-icon"), null);
  const indicator = button.querySelector(".family-pending-indicator");
  assert.equal(indicator.getAttribute("aria-hidden"), "true");
  assert.equal(indicator.hasAttribute("role"), false);
  button.click();
  assert.equal(calls, 0);
  draw(false);
  assert.equal(button.getAttribute("aria-busy"), "false");
  assert.equal(button.querySelector(".family-pending-indicator"), null);
  assert.equal(button.querySelector("ha-icon").icon, "mdi:lock-outline");
  button.click();
  assert.equal(calls, 1);
});

test("balanced confirmation footer is opt-in and stays hidden behind a dirty guard", () => {
  let dirty = false;
  const { flow, container } = setup({ guard: () => ({ dirty }) });
  flow.open("confirm");
  const options = {
    title: "Unlock car?", content: "This unlocks the car remotely.",
    footer: html`<button class="family-action">Cancel</button><button class="family-action primary">Unlock</button>`,
  };
  render(renderFamilyDialog(flow, options), container);
  assert.equal(container.querySelector("footer").classList.contains("equal"), false);
  render(renderFamilyDialog(flow, { ...options, footerLayout: "equal" }), container);
  assert.equal(container.querySelector("footer").classList.contains("equal"), true);
  assert.equal(container.querySelectorAll("footer button").length, 2);
  dirty = true;
  flow.close();
  render(renderFamilyDialog(flow, { ...options, footerLayout: "equal" }), container);
  assert.equal(container.querySelector("footer"), null);
  assert.ok(container.querySelector('[aria-label="Unsaved changes"]'));
  flow.discardAndContinue();
  container.remove();
});

test("nonvisual status and busy indicators preserve readable, bounded control styling", () => {
  const style = document.createElement("style");
  style.textContent = `${familyStyles.cssText} ${componentStyles.cssText} ${dialogStyles.cssText}`;
  document.head.append(style);
  const node = document.createElement("div");
  document.body.append(node);
  render(html`${actionPill({ label: "Save", pending: true, onClick: () => {} })}
    ${pendingIndicator()}<span class="family-visually-hidden" role="status">Saving</span>
    <footer class="family-dialog-footer equal"><button class="family-action">Cancel</button><button class="family-action">Confirm a longer action</button></footer>`, node);
  try {
    const buttonStyle = window.getComputedStyle(node.querySelector("button"));
    assert.equal(buttonStyle.opacity, "1");
    assert.equal(buttonStyle.cursor, "progress");
    const liveStyle = window.getComputedStyle(node.querySelector('[role="status"]'));
    assert.equal(liveStyle.position, "absolute");
    assert.notEqual(liveStyle.display, "none");
    assert.notEqual(liveStyle.visibility, "hidden");
    const spinnerStyle = window.getComputedStyle(node.querySelector(".family-pending-indicator"));
    assert.equal(spinnerStyle.width, "22px");
    assert.equal(spinnerStyle.height, "22px");
    const footer = window.getComputedStyle(node.querySelector("footer"));
    assert.equal(footer.display, "grid");
    assert.match(footer.gridTemplateColumns, /repeat\(2,/);
    assert.ok([...node.querySelectorAll("footer button")].every(button => window.getComputedStyle(button).minHeight === "48px"));
    // DOM fixtures cannot simulate motion media queries; ensure the opt-out remains shipped.
    assert.match(componentStyles.cssText, /prefers-reduced-motion: reduce[\s\S]*family-pending-indicator[\s\S]*animation: none/);
  } finally {
    node.remove(); style.remove();
  }
});
