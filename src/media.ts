import { css, type ReactiveController, type ReactiveControllerHost } from "lit";

/** Add after dialogStyles; apply className:"media" only to expanded media routes. */
export const mediaDialogStyles = css`
  .family-dialog.media {
    max-width: none;
    height: var(--family-available-height);
  }
  .family-dialog.media .family-dialog-body {
    padding: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: black;
  }
  .family-dialog.media .family-dialog-body > div:not([hidden]) {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .family-dialog.media .family-media-content {
    flex: 1;
    min-width: 0;
    min-height: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
  }
`;

/** Local video magnification only. These helpers never issue camera/PTZ commands. */
export interface ZoomPoint {
  x: number;
  y: number;
}
export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}
export const initialZoom = (): ZoomState => ({ scale: 1, x: 0, y: 0 });

export function clampZoom(
  state: ZoomState,
  width: number,
  height: number,
): ZoomState {
  const scale = Math.min(5, Math.max(1, state.scale));
  const limitX = (Math.max(0, width) * (scale - 1)) / 2;
  const limitY = (Math.max(0, height) * (scale - 1)) / 2;
  return {
    scale,
    x: Math.max(-limitX, Math.min(limitX, state.x)),
    y: Math.max(-limitY, Math.min(limitY, state.y)),
  };
}

export function moveZoom(
  start: ZoomState,
  before: ZoomPoint[],
  after: ZoomPoint[],
  width: number,
  height: number,
): ZoomState {
  if (!before.length || before.length !== after.length) return start;
  if (before.length === 1)
    return clampZoom(
      {
        ...start,
        x: start.x + after[0].x - before[0].x,
        y: start.y + after[0].y - before[0].y,
      },
      width,
      height,
    );
  const distance = (points: ZoomPoint[]) =>
    Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  if (distance(before) < 1) return start;
  const center = (points: ZoomPoint[]) => ({
    x: (points[0].x + points[1].x) / 2 - width / 2,
    y: (points[0].y + points[1].y) / 2 - height / 2,
  });
  const a = center(before),
    b = center(after);
  const scale = Math.min(
    5,
    Math.max(1, (start.scale * distance(after)) / distance(before)),
  );
  const ratio = scale / start.scale;
  return clampZoom(
    {
      scale,
      x: b.x - (a.x - start.x) * ratio,
      y: b.y - (a.y - start.y) * ratio,
    },
    width,
    height,
  );
}

type MediaHost = Pick<ReactiveControllerHost, "requestUpdate"> &
  Partial<Pick<ReactiveControllerHost, "addController">>;
const isControlEvent = (event: Event): boolean =>
  event.composedPath().some((node) => {
    const element = node as Element;
    return (
      typeof element.matches === "function" &&
      element.matches(
        "button, a, input, select, textarea, [role=button], [data-media-control]",
      )
    );
  });

/** Apply transform to the media only; leave controls outside that surface. */
export class MediaZoomController implements ReactiveController {
  state: ZoomState = initialZoom();
  private gesture?: { points: ZoomPoint[]; state: ZoomState };
  private suppressClick = false;
  constructor(
    private host: MediaHost,
    private options: { enabled: () => boolean },
  ) {
    host.addController?.(this);
  }
  get transform(): string {
    return `translate(${this.state.x}px, ${this.state.y}px) scale(${this.state.scale})`;
  }
  reset = (): void => {
    const changed =
      this.state.scale !== 1 || this.state.x !== 0 || this.state.y !== 0;
    this.state = initialZoom();
    this.gesture = undefined;
    this.suppressClick = false;
    if (changed) this.host.requestUpdate();
  };
  dispose = (): void => {
    this.reset();
  };
  hostDisconnected(): void {
    this.dispose();
  }
  private points(event: TouchEvent): ZoomPoint[] {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return Array.from(event.touches)
      .slice(0, 2)
      .map((touch) => ({
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      }));
  }
  touchStart = Object.assign(
    (event: TouchEvent): void => {
      if (!this.options.enabled() || isControlEvent(event)) {
        this.gesture = undefined;
        return;
      }
      const points = this.points(event);
      if (
        points.length === 2 ||
        (points.length === 1 && this.state.scale > 1)
      ) {
        event.preventDefault();
        this.suppressClick = true;
        this.gesture = { points, state: this.state };
      } else {
        this.gesture = undefined;
        this.suppressClick = false;
      }
    },
    { passive: false },
  );
  touchMove = Object.assign(
    (event: TouchEvent): void => {
      if (!this.options.enabled() || !this.gesture) return;
      event.preventDefault();
      const viewport = event.currentTarget as HTMLElement;
      this.state = moveZoom(
        this.gesture.state,
        this.gesture.points,
        this.points(event),
        viewport.clientWidth,
        viewport.clientHeight,
      );
      this.host.requestUpdate();
    },
    { passive: false },
  );
  touchEnd = Object.assign(
    (event: TouchEvent): void => {
      this.gesture = undefined;
      if (event.type !== "touchcancel" && event.touches.length)
        this.touchStart(event);
    },
    { passive: false },
  );
  /** Call in the viewport's capture-phase click handler before playback actions. */
  consumeClick = (event: Event): boolean => {
    if (isControlEvent(event) || !this.suppressClick) return false;
    this.suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
}

export type CameraStreamTag = "ha-camera-stream" | "ha-web-rtc-player";
type CameraHelpers = {
  createCardElement(
    config: Record<string, unknown>,
  ): unknown | Promise<unknown>;
};
const cameraLoads = new WeakMap<
  CustomElementRegistry,
  Map<CameraStreamTag, Promise<void>>
>();

/** Ask HA to import its native media elements, with no stream or device commands. */
export function ensureCameraStreamElements(
  entityId: string,
  tag: CameraStreamTag,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  if (typeof window === "undefined" || typeof customElements === "undefined")
    return Promise.reject(
      new Error("Home Assistant camera elements require a browser."),
    );
  const registry = customElements;
  if (registry.get(tag)) return Promise.resolve();
  let loads = cameraLoads.get(registry);
  if (!loads) {
    loads = new Map();
    cameraLoads.set(registry, loads);
  }
  const existing = loads.get(tag);
  if (existing) return existing;
  const requestedTimeout = options.timeoutMs;
  const timeoutMs =
    typeof requestedTimeout === "number" &&
    Number.isFinite(requestedTimeout) &&
    requestedTimeout > 0
      ? Math.min(60_000, requestedTimeout)
      : 10_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const load = (async () => {
    const loader = (
      window as Window & { loadCardHelpers?: () => Promise<CameraHelpers> }
    ).loadCardHelpers;
    if (!loader)
      throw new Error("Home Assistant camera helpers are not available yet.");
    const helpers = await loader();
    await helpers.createCardElement({
      type: "picture-entity",
      entity: entityId,
      camera_view: "live",
    });
    await registry.whenDefined(tag);
  })();
  const pending = Promise.race([
    load,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error("Home Assistant camera elements did not load in time."),
          ),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (loads?.get(tag) === pending) loads.delete(tag);
  });
  loads.set(tag, pending);
  return pending;
}

export interface MediaFullscreenAPI {
  readonly isEnabled: boolean;
  readonly isFullscreen: boolean;
  readonly element?: Element | null;
  request(element: Element): Promise<void>;
  exit(): Promise<void>;
}
export const isMediaFullscreen = (
  api: MediaFullscreenAPI,
  target: Element,
): boolean => api.isEnabled && api.isFullscreen && api.element === target;

/** False asks the caller to use its top-layer fallback; unrelated fullscreen is untouched. */
export async function toggleMediaFullscreen(
  api: MediaFullscreenAPI,
  target: Element,
): Promise<boolean> {
  if (!api.isEnabled) return false;
  try {
    if (api.isFullscreen) {
      if (!isMediaFullscreen(api, target)) return false;
      await api.exit();
      return !api.isFullscreen;
    }
    await api.request(target);
    return isMediaFullscreen(api, target);
  } catch {
    return false;
  }
}

type FullscreenRoot = (Document | ShadowRoot) & {
  webkitFullscreenElement?: Element | null;
};
type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void | Promise<void>;
};
type FullscreenElement = Element & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};

/** Native adapter resolves the actual element through nested shadow roots. */
export function createMediaFullscreenAPI(
  document: Document,
): MediaFullscreenAPI {
  const doc = document as FullscreenDocument;
  const rootElement = (root: FullscreenRoot): Element | null =>
    root.fullscreenElement ?? root.webkitFullscreenElement ?? null;
  return {
    get isEnabled() {
      return (
        doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true
      );
    },
    get isFullscreen() {
      return rootElement(doc) !== null;
    },
    get element() {
      let element = rootElement(doc);
      const seen = new Set<Element>();
      while (element?.shadowRoot && !seen.has(element)) {
        seen.add(element);
        const inner = rootElement(element.shadowRoot);
        if (!inner) break;
        element = inner;
      }
      return element;
    },
    async request(element: Element) {
      const target = element as FullscreenElement;
      const request =
        target.requestFullscreen ?? target.webkitRequestFullscreen;
      if (!request) throw new Error("Native fullscreen is not supported.");
      await request.call(target);
    },
    async exit() {
      const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      if (!exit) throw new Error("Native fullscreen is not supported.");
      await exit.call(doc);
    },
  };
}

/** Immersive, in-place viewport expansion. No modal shell or duplicate player. */
export const mediaFullscreenStyles = css`
  :host([data-media-fullscreen]),
  [data-media-fullscreen] {
    position: fixed !important;
    inset: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-sizing: border-box;
    width: 100vw !important;
    height: 100vh !important;
    height: 100dvh !important;
    max-width: none !important;
    max-height: none !important;
    z-index: 10000;
    background: black;
    overflow: hidden;
  }
  :host([data-media-fullscreen])::backdrop,
  [data-media-fullscreen]::backdrop {
    background: black;
  }
`;

type OverflowSnapshot = { value: string; priority: string };
interface MediaViewportLock {
  owners: MediaFullscreenFallbackController[];
  root: OverflowSnapshot;
  body?: OverflowSnapshot;
}
// Symbol.for makes independently bundled card copies cooperate on the same page.
const mediaLockKey = Symbol.for("bitosome.ha-card-ui.media-viewport-lock.v1");
type MediaDocument = Document & { [mediaLockKey]?: MediaViewportLock };
const saveOverflow = (element: HTMLElement): OverflowSnapshot => ({
  value: element.style.getPropertyValue("overflow"),
  priority: element.style.getPropertyPriority("overflow"),
});
const restoreOverflow = (
  element: HTMLElement,
  saved: OverflowSnapshot,
): void => {
  // Do not undo a new owner's deliberate style change while expanded.
  if (element.style.getPropertyValue("overflow") !== "hidden") return;
  if (saved.value)
    element.style.setProperty("overflow", saved.value, saved.priority);
  else element.style.removeProperty("overflow");
};
const focusedElement = (document: Document): HTMLElement | undefined => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement)
    active = active.shadowRoot.activeElement;
  return active instanceof (document.defaultView?.HTMLElement ?? HTMLElement)
    ? (active as HTMLElement)
    : undefined;
};
const mediaFocusable = (target: HTMLElement): HTMLElement[] => {
  const result: HTMLElement[] = [];
  const visit = (root: ParentNode): void => {
    for (const element of Array.from(root.children)) {
      const candidate = element as HTMLElement;
      if (candidate.matches("[hidden], [inert], [disabled]")) continue;
      const style =
        candidate.ownerDocument.defaultView?.getComputedStyle(candidate);
      if (style?.display === "none" || style?.visibility === "hidden") continue;
      if (
        candidate.tabIndex >= 0 &&
        candidate.matches(
          "button, a[href], input, select, textarea, [tabindex]",
        )
      )
        result.push(candidate);
      if (candidate.shadowRoot) visit(candidate.shadowRoot);
      else visit(candidate);
    }
  };
  if (target.shadowRoot) visit(target.shadowRoot);
  else visit(target);
  return result;
};

/**
 * Native-first callers use this only when native fullscreen is unavailable.
 * The original element is promoted to the browser top layer through a manual
 * popover where supported, avoiding HA transform/contain/overflow ancestors.
 * Older browsers keep the same fixed-viewport fallback. The player never moves
 * or remounts. Compose mediaFullscreenStyles in the target's styling root.
 */
export class MediaFullscreenFallbackController implements ReactiveController {
  private target?: HTMLElement;
  private opener?: HTMLElement;
  private previousPopover: string | null = null;
  private previousTabIndex: string | null = null;
  private popoverOpen = false;
  constructor(
    private host: MediaHost,
    private options: { onChange?: (active: boolean) => void } = {},
  ) {
    host.addController?.(this);
  }
  get active(): boolean {
    return !!this.target;
  }
  open(target: HTMLElement, opener?: HTMLElement): void {
    if (this.target === target || !target.isConnected) return;
    this.close(false);
    this.target = target;
    this.opener = opener ?? focusedElement(target.ownerDocument);
    this.previousPopover = target.getAttribute("popover");
    this.previousTabIndex = target.getAttribute("tabindex");
    target.setAttribute("data-media-fullscreen", "");
    if (this.previousTabIndex === null) target.tabIndex = -1;
    const doc = target.ownerDocument as MediaDocument;
    let lock = doc[mediaLockKey];
    if (!lock) {
      lock = {
        owners: [],
        root: saveOverflow(doc.documentElement),
        body: doc.body ? saveOverflow(doc.body) : undefined,
      };
      doc[mediaLockKey] = lock;
      doc.documentElement.style.setProperty("overflow", "hidden");
      doc.body?.style.setProperty("overflow", "hidden");
    }
    lock.owners.push(this);
    doc.addEventListener("keydown", this.onKeyDown, true);
    target.addEventListener("toggle", this.onToggle);
    if (typeof target.showPopover === "function") {
      try {
        target.setAttribute("popover", "manual");
        target.showPopover();
        this.popoverOpen = true;
      } catch {
        this.restorePopover(target);
      }
    }
    this.options.onChange?.(true);
    this.host.requestUpdate();
    const controls = mediaFocusable(target);
    (this.opener && controls.includes(this.opener)
      ? this.opener
      : controls[0] ?? target
    ).focus({ preventScroll: true });
  }
  close(restoreFocus = true): void {
    const target = this.target;
    if (!target) return;
    this.target = undefined;
    const doc = target.ownerDocument as MediaDocument;
    doc.removeEventListener("keydown", this.onKeyDown, true);
    target.removeEventListener("toggle", this.onToggle);
    if (this.popoverOpen) {
      try {
        target.hidePopover();
      } catch {
        /* Browser may have already hidden it. */
      }
    }
    this.popoverOpen = false;
    this.restorePopover(target);
    target.removeAttribute("data-media-fullscreen");
    if (this.previousTabIndex === null) target.removeAttribute("tabindex");
    else target.setAttribute("tabindex", this.previousTabIndex);
    const lock = doc[mediaLockKey];
    const wasTop = lock?.owners[lock.owners.length - 1] === this;
    if (lock) {
      lock.owners = lock.owners.filter((owner) => owner !== this);
      if (!lock.owners.length) {
        restoreOverflow(doc.documentElement, lock.root);
        if (doc.body && lock.body) restoreOverflow(doc.body, lock.body);
        delete doc[mediaLockKey];
      }
    }
    this.options.onChange?.(false);
    this.host.requestUpdate();
    const opener = this.opener;
    this.opener = undefined;
    if (restoreFocus && wasTop && opener?.isConnected)
      opener.focus({ preventScroll: true });
  }
  hostDisconnected(): void {
    this.close(false);
  }
  hostUpdated(): void {
    if (this.target && !this.target.isConnected) this.close(false);
  }
  private restorePopover(target: HTMLElement): void {
    if (this.previousPopover === null) target.removeAttribute("popover");
    else target.setAttribute("popover", this.previousPopover);
  }
  private onToggle = (event: Event): void => {
    if ((event as ToggleEvent).newState === "closed" && this.popoverOpen) {
      // A queued close from a previous expansion must not close a reopened one.
      try {
        if (this.target?.matches(":popover-open")) return;
      } catch {
        /* Older engines. */
      }
      this.close();
    }
  };
  private onKeyDown = (event: KeyboardEvent): void => {
    const target = this.target;
    if (!target) return;
    const doc = target.ownerDocument as MediaDocument;
    const owners = doc[mediaLockKey]?.owners;
    if (owners?.[owners.length - 1] !== this) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
    } else if (event.key === "Tab") {
      const controls = mediaFocusable(target);
      const active = focusedElement(doc);
      const index = active ? controls.indexOf(active) : -1;
      const next = !controls.length
        ? target
        : event.shiftKey
          ? controls[(index <= 0 ? controls.length : index) - 1]
          : controls[(index + 1) % controls.length];
      event.preventDefault();
      event.stopImmediatePropagation();
      next.focus({ preventScroll: true });
    }
  };
}
