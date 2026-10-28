import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import {
  initialZoom,
  clampZoom,
  moveZoom,
  MediaZoomController,
  ensureCameraStreamElements,
  createMediaFullscreenAPI,
  isMediaFullscreen,
  toggleMediaFullscreen,
  mediaDialogStyles,
} from "../dist/media.js";

const withWindow = async (callback) => {
  const win = new Window({ url: "http://localhost" });
  const previous = {
    window: globalThis.window,
    customElements: globalThis.customElements,
  };
  globalThis.window = win;
  globalThis.customElements = win.customElements;
  try {
    await callback(win);
  } finally {
    globalThis.window = previous.window;
    globalThis.customElements = previous.customElements;
    await win.happyDOM.close();
  }
};

test("media dialog is an additive bounded variant with the ordinary header retained", () => {
  const css = mediaDialogStyles.cssText;
  assert.match(
    css,
    /\.family-dialog\.media\s*\{[^}]*height: var\(--family-available-height\)/,
  );
  assert.match(
    css,
    /\.family-dialog\.media \.family-dialog-body\s*\{[^}]*padding: 0/,
  );
  assert.match(css, /\.family-media-content\s*\{[^}]*min-height: 0/);
  assert.doesNotMatch(
    css,
    /z-index|\.family-dialog-header|100vh|position: fixed/,
  );
});

test("zoom geometry retains camera-card focal anchoring and bounded pan", () => {
  assert.deepEqual(
    moveZoom(
      initialZoom(),
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      [
        { x: 50, y: 100 },
        { x: 250, y: 100 },
      ],
      400,
      200,
    ),
    { scale: 2, x: 50, y: 0 },
  );
  assert.deepEqual(clampZoom({ scale: 9, x: 9999, y: -9999 }, 400, 200), {
    scale: 5,
    x: 800,
    y: -400,
  });
  assert.deepEqual(
    clampZoom({ scale: 0.5, x: 100, y: 20 }, 400, 200),
    initialZoom(),
  );
  assert.deepEqual(moveZoom(initialZoom(), [], [], 400, 200), initialZoom());
  assert.deepEqual(
    moveZoom(
      initialZoom(),
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      400,
      200,
    ),
    initialZoom(),
  );
});

test("gestures preserve inline scrolling, pinch/pan expanded media and reset cleanly", async () =>
  withWindow(async (win) => {
    const viewport = win.document.createElement("div");
    win.document.body.append(viewport);
    Object.defineProperties(viewport, {
      clientWidth: { value: 400 },
      clientHeight: { value: 200 },
    });
    let enabled = false,
      updates = 0,
      attached;
    const zoom = new MediaZoomController(
      {
        requestUpdate() {
          updates++;
        },
        addController(value) {
          attached = value;
        },
      },
      { enabled: () => enabled },
    );
    assert.equal(attached, zoom);
    assert.equal(zoom.touchMove.passive, false);
    viewport.addEventListener("touchstart", zoom.touchStart, {
      passive: false,
    });
    viewport.addEventListener("touchmove", zoom.touchMove, { passive: false });
    viewport.addEventListener("touchend", zoom.touchEnd, { passive: false });
    viewport.addEventListener("touchcancel", zoom.touchEnd, { passive: false });
    viewport.addEventListener(
      "click",
      (event) => zoom.consumeClick(event),
      true,
    );
    const touch = (type, points, target = viewport) => {
      const event = new win.Event(type, {
        cancelable: true,
        bubbles: true,
        composed: true,
      });
      Object.defineProperty(event, "touches", {
        value: points.map(([clientX, clientY]) => ({ clientX, clientY })),
      });
      target.dispatchEvent(event);
      return event;
    };
    touch("touchstart", [
      [100, 100],
      [200, 100],
    ]);
    assert.equal(
      touch("touchmove", [
        [50, 100],
        [250, 100],
      ]).defaultPrevented,
      false,
    );
    assert.deepEqual(zoom.state, initialZoom());
    enabled = true;
    touch("touchstart", [
      [100, 100],
      [200, 100],
    ]);
    assert.equal(
      touch("touchmove", [
        [50, 100],
        [250, 100],
      ]).defaultPrevented,
      true,
    );
    assert.equal(zoom.transform, "translate(50px, 0px) scale(2)");
    touch("touchend", [[150, 100]]);
    touch("touchmove", [[180, 100]]);
    assert.equal(zoom.state.x, 80);
    const click = new win.Event("click", { cancelable: true, bubbles: true });
    viewport.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true);
    const nextClick = new win.Event("click", {
      cancelable: true,
      bubbles: true,
    });
    viewport.dispatchEvent(nextClick);
    assert.equal(nextClick.defaultPrevented, false);
    const control = win.document.createElement("button");
    viewport.append(control);
    assert.equal(
      touch(
        "touchstart",
        [
          [10, 10],
          [30, 10],
        ],
        control,
      ).defaultPrevented,
      false,
    );
    assert.equal(
      touch(
        "touchmove",
        [
          [0, 10],
          [40, 10],
        ],
        control,
      ).defaultPrevented,
      false,
    );
    assert.equal(zoom.state.scale, 2);
    zoom.hostDisconnected();
    assert.deepEqual(zoom.state, initialZoom());
    assert.ok(updates > 0);
  }));

test("camera bootstrap awaits the requested native player, deduplicates and uses no device API", async () =>
  withWindow(async (win) => {
    const calls = [];
    win.loadCardHelpers = async () => ({
      createCardElement(config) {
        calls.push(config);
        win.customElements.define(
          "ha-camera-stream",
          class extends win.HTMLElement {},
        );
      },
    });
    const a = ensureCameraStreamElements(
      "camera.synthetic",
      "ha-web-rtc-player",
      { timeoutMs: 100 },
    );
    const b = ensureCameraStreamElements("camera.other", "ha-web-rtc-player", {
      timeoutMs: 100,
    });
    assert.equal(a, b);
    let finished = false;
    a.then(() => {
      finished = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(finished, false);
    assert.deepEqual(calls, [
      {
        type: "picture-entity",
        entity: "camera.synthetic",
        camera_view: "live",
      },
    ]);
    win.customElements.define(
      "ha-web-rtc-player",
      class extends win.HTMLElement {},
    );
    await a;
    await ensureCameraStreamElements("camera.other", "ha-web-rtc-player");
    assert.equal(calls.length, 1);
  }));

test("bootstrap failures and timeouts are bounded and retryable", async () =>
  withWindow(async (win) => {
    await assert.rejects(
      ensureCameraStreamElements("camera.synthetic", "ha-camera-stream", {
        timeoutMs: 20,
      }),
      /not available/,
    );
    win.loadCardHelpers = async () => ({
      createCardElement() {
        throw new Error("Synthetic import failure");
      },
    });
    await assert.rejects(
      ensureCameraStreamElements("camera.synthetic", "ha-camera-stream", {
        timeoutMs: 20,
      }),
      /Synthetic import failure/,
    );
    win.loadCardHelpers = async () => ({ createCardElement() {} });
    await assert.rejects(
      ensureCameraStreamElements("camera.synthetic", "ha-camera-stream", {
        timeoutMs: 20,
      }),
      /did not load in time/,
    );
    win.loadCardHelpers = async () => ({
      createCardElement() {
        win.customElements.define(
          "ha-camera-stream",
          class extends win.HTMLElement {},
        );
      },
    });
    await ensureCameraStreamElements("camera.synthetic", "ha-camera-stream", {
      timeoutMs: 20,
    });
  }));

test("helper-loading delay itself is bounded", async () =>
  withWindow(async (win) => {
    win.loadCardHelpers = () => new Promise(() => {});
    await assert.rejects(
      ensureCameraStreamElements("camera.synthetic", "ha-camera-stream", {
        timeoutMs: 20,
      }),
      /did not load in time/,
    );
    win.customElements.define(
      "ha-camera-stream",
      class extends win.HTMLElement {},
    );
    await ensureCameraStreamElements("camera.synthetic", "ha-camera-stream");
  }));

test("fullscreen toggles only the requested owner and verifies real entry", async () =>
  withWindow(async (win) => {
    const target = win.document.createElement("div"),
      other = win.document.createElement("div");
    let requests = 0,
      exits = 0;
    const api = {
      isEnabled: true,
      isFullscreen: false,
      element: null,
      async request(element) {
        requests++;
        this.isFullscreen = true;
        this.element = element;
      },
      async exit() {
        exits++;
        this.isFullscreen = false;
        this.element = null;
      },
    };
    assert.equal(await toggleMediaFullscreen(api, target), true);
    assert.equal(isMediaFullscreen(api, target), true);
    assert.equal(await toggleMediaFullscreen(api, target), true);
    assert.equal(exits, 1);
    api.isFullscreen = true;
    api.element = other;
    assert.equal(await toggleMediaFullscreen(api, target), false);
    assert.equal(exits, 1);
    assert.equal(requests, 1);
    api.isFullscreen = false;
    api.element = null;
    api.request = async () => {};
    assert.equal(await toggleMediaFullscreen(api, target), false);
    api.request = async () => {
      throw new Error("Rejected");
    };
    assert.equal(await toggleMediaFullscreen(api, target), false);
    api.isEnabled = false;
    assert.equal(await toggleMediaFullscreen(api, target), false);
  }));

test("native adapter resolves nested shadow fullscreen ownership and exits", async () =>
  withWindow(async (win) => {
    const outer = win.document.createElement("div"),
      inner = win.document.createElement("div"),
      frame = win.document.createElement("div");
    outer.attachShadow({ mode: "open" }).append(inner);
    inner.attachShadow({ mode: "open" }).append(frame);
    const doc = win.document;
    Object.defineProperties(doc, {
      fullscreenEnabled: { value: true, configurable: true },
      fullscreenElement: { value: null, writable: true, configurable: true },
    });
    Object.defineProperty(outer.shadowRoot, "fullscreenElement", {
      value: inner,
      configurable: true,
    });
    Object.defineProperty(inner.shadowRoot, "fullscreenElement", {
      value: frame,
      configurable: true,
    });
    frame.requestFullscreen = async () => {
      doc.fullscreenElement = outer;
    };
    doc.exitFullscreen = async () => {
      doc.fullscreenElement = null;
    };
    const api = createMediaFullscreenAPI(doc);
    assert.equal(await toggleMediaFullscreen(api, frame), true);
    assert.equal(api.element, frame);
    assert.equal(isMediaFullscreen(api, frame), true);
    assert.equal(await toggleMediaFullscreen(api, frame), true);
    assert.equal(api.isFullscreen, false);
  }));

test("native adapter supports prefixed WebKit methods without changing unrelated fullscreen", async () =>
  withWindow(async (win) => {
    const doc = win.document,
      target = doc.createElement("div");
    Object.defineProperties(doc, {
      fullscreenEnabled: { value: false, configurable: true },
      fullscreenElement: { value: null, configurable: true },
      webkitFullscreenEnabled: { value: true },
      webkitFullscreenElement: { value: null, writable: true },
    });
    target.requestFullscreen = undefined;
    doc.exitFullscreen = undefined;
    target.webkitRequestFullscreen = () => {
      doc.webkitFullscreenElement = target;
    };
    doc.webkitExitFullscreen = () => {
      doc.webkitFullscreenElement = null;
    };
    const api = createMediaFullscreenAPI(doc);
    assert.equal(await toggleMediaFullscreen(api, target), true);
    assert.equal(api.element, target);
    assert.equal(await toggleMediaFullscreen(api, target), true);
    assert.equal(api.isFullscreen, false);
  }));
