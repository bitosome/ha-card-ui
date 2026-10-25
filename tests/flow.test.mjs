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
