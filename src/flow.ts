import {
  html,
  nothing,
  type ReactiveController,
  type ReactiveControllerHost,
} from "lit";
import { ref } from "lit/directives/ref.js";
import {
  showFamilyDialog,
  closeFamilyDialog,
  disposeFamilyDialog,
  uiIcon,
  dialogClose,
} from "./primitives.js";

export type FlowIntent = "back" | "close" | "navigate";
export interface FlowGuard {
  /** A dispatched command is not a draft; consumers decide whether dismissal is safe. */
  pending?: boolean;
  dirty?: boolean;
  message?: string;
  discard?: () => void;
}
export interface FlowOptions<Route extends string> {
  guard?: (
    intent: FlowIntent,
    route: Route | undefined,
  ) => FlowGuard | undefined;
  onChange?: (route: Route | undefined, previous: Route | undefined) => void;
  onClose?: () => void;
}
export type FlowHost = Pick<ReactiveControllerHost, "requestUpdate"> &
  Partial<Pick<ReactiveControllerHost, "addController">>;

/** One navigation stack and one dismissal policy for Lit cards and imperative panels.
 * A single instance owns a stable native dialog. No global elements or device commands.
 */
export class FamilyFlowController<Route extends string = string>
  implements ReactiveController
{
  private routes: Route[] = [];
  private dialog?: HTMLDialogElement;
  private opener?: HTMLElement;
  private focusAfterUpdate = false;
  private revision = 0;
  private scrollPositions = new Map<Route, number>();
  private confirmationFocus?: HTMLElement;
  private confirmationScroll = 0;
  private returnToDraft = false;
  private deferred?: () => void;
  confirmation = "";
  notice = "";
  constructor(
    private host: FlowHost,
    private options: FlowOptions<Route> = {},
  ) {
    host.addController?.(this);
  }
  get current(): Route | undefined {
    return this.routes[this.routes.length - 1];
  }
  get stack(): readonly Route[] {
    return [...this.routes];
  }
  get active(): boolean {
    return this.routes.length > 0;
  }
  get canBack(): boolean {
    return this.routes.length > 1;
  }
  /** Capture before async work; completion must not close a subsequently opened flow. */
  get generation(): number {
    return this.revision;
  }
  isCurrent(generation: number): boolean {
    return this.active && generation === this.revision;
  }
  configure(options: FlowOptions<Route>): void {
    this.options = options;
  }
  private update(previous: Route | undefined): void {
    if (previous && this.dialog)
      this.scrollPositions.set(
        previous,
        this.dialog.querySelector(".family-dialog-body")?.scrollTop || 0,
      );
    this.confirmation = "";
    this.notice = "";
    this.deferred = undefined;
    this.revision++;
    this.focusAfterUpdate = true;
    this.options.onChange?.(this.current, previous);
    this.host.requestUpdate();
  }
  open(route: Route, opener?: HTMLElement): boolean {
    return this.attempt("navigate", () => {
      const previous = this.current;
      if (!this.active) this.opener = opener;
      this.scrollPositions.clear();
      this.routes = [route];
      this.update(previous);
    });
  }
  push(route: Route): boolean {
    return this.attempt("navigate", () => {
      const previous = this.current;
      this.routes.push(route);
      this.update(previous);
    });
  }
  replace(route: Route): boolean {
    return this.attempt("navigate", () => {
      const previous = this.current;
      this.routes.splice(Math.max(0, this.routes.length - 1), 1, route);
      this.update(previous);
    });
  }
  back = (): boolean =>
    this.canBack
      ? this.attempt("back", () => {
          const previous = this.current;
          this.routes.pop();
          this.update(previous);
        })
      : this.close();
  close = (): boolean => this.attempt("close", () => this.forceClose());
  requestBack = (): boolean => this.back();
  requestClose = (): boolean => this.close();
  /** Use only after confirmed save or to hand focus to native HA more-info. */
  forceClose(restoreFocus = true): void {
    if (!this.active) return;
    const previous = this.current;
    if (restoreFocus) closeFamilyDialog(this.dialog);
    else disposeFamilyDialog(this.dialog);
    this.routes = [];
    this.update(previous);
    this.options.onClose?.();
  }
  /** Close this top layer before opening HA's own UI, including after draft discard. */
  handoff(callback: () => void): boolean {
    return this.attempt("close", () => {
      this.forceClose(false);
      callback();
    });
  }
  private attempt(intent: FlowIntent, action: () => void): boolean {
    const guard = this.active
      ? this.options.guard?.(intent, this.current)
      : undefined;
    if (guard?.pending) {
      this.notice = guard.message || "Wait for the current request to finish.";
      this.host.requestUpdate();
      return false;
    }
    if (guard?.dirty) {
      if (!this.confirmation) {
        const root = this.dialog?.getRootNode() as
          | Document
          | ShadowRoot
          | undefined;
        this.confirmationFocus =
          root?.activeElement instanceof HTMLElement
            ? root.activeElement
            : undefined;
        this.confirmationScroll =
          this.dialog?.querySelector(".family-dialog-body")?.scrollTop || 0;
      }
      this.confirmation = guard.message || "Discard unsaved changes?";
      this.deferred = () => {
        // Recheck a possible in-flight save before discarding the draft.
        const latest = this.options.guard?.(intent, this.current);
        if (latest?.pending) {
          this.notice =
            latest.message || "Wait for the current request to finish.";
          this.host.requestUpdate();
          return;
        }
        latest?.discard?.();
        action();
      };
      this.focusAfterUpdate = true;
      this.host.requestUpdate();
      return false;
    }
    action();
    return true;
  }
  keepEditing = (): void => {
    this.confirmation = "";
    this.deferred = undefined;
    this.notice = "";
    this.returnToDraft = true;
    this.focusAfterUpdate = true;
    this.host.requestUpdate();
  };
  discardAndContinue = (): void => {
    this.deferred?.();
  };
  onCancel = (event: Event): void => {
    event.preventDefault();
    if (this.confirmation) this.keepEditing();
    else this.close();
  };
  dialogRef = (element: Element | undefined): void => {
    const next = element as HTMLDialogElement | undefined;
    if (this.dialog && next !== this.dialog) disposeFamilyDialog(this.dialog);
    this.dialog = next;
  };
  /** Imperative consumers call this after rendering. Lit invokes it automatically. */
  hostUpdated(): void {
    if (!this.dialog || !this.active) return;
    showFamilyDialog(this.dialog, {
      opener: this.opener,
      onBackdrop: this.close,
    });
    if (this.focusAfterUpdate) {
      this.focusAfterUpdate = false;
      const body = this.dialog.querySelector<HTMLElement>(
        ".family-dialog-body",
      );
      if (this.returnToDraft) {
        this.returnToDraft = false;
        if (body) body.scrollTop = this.confirmationScroll;
        if (
          this.confirmationFocus?.isConnected &&
          this.dialog.contains(this.confirmationFocus)
        ) {
          this.confirmationFocus.focus({ preventScroll: true });
          return;
        }
      }
      if (body && !this.confirmation && this.current)
        body.scrollTop = this.scrollPositions.get(this.current) || 0;
      const initial = this.dialog.querySelector<HTMLElement>(
        "[data-family-initial-focus]",
      );
      (this.confirmation
        ? this.dialog.querySelector<HTMLElement>("[data-family-keep]")
        : initial ||
          this.dialog.querySelector<HTMLElement>("[data-family-heading]")
      )?.focus({ preventScroll: true });
    }
  }
  hostDisconnected(): void {
    disposeFamilyDialog(this.dialog);
    this.dialog = undefined;
    this.routes = [];
    this.scrollPositions.clear();
    this.confirmationFocus = undefined;
    this.returnToDraft = false;
    this.deferred = undefined;
    this.confirmation = "";
    this.notice = "";
    this.revision++;
  }
}

export interface FamilyDialogOptions {
  title: string;
  content: unknown;
  footer?: unknown;
  /** Two balanced confirmation actions. Default keeps the existing trailing action layout. */
  footerLayout?: "equal";
  wide?: boolean;
  long?: boolean;
  className?: string;
  bodyClass?: string;
  id?: string;
  ariaDescribedBy?: string;
}

/** Shared shell: one native top-layer dialog, Back within the flow, X for the flow. */
export function renderFamilyDialog(
  flow: FamilyFlowController<any>,
  options: FamilyDialogOptions,
) {
  if (!flow.active) return nothing;
  return html`<dialog
    class="family-dialog ${options.long ? "long" : ""} ${options.className ||
    ""}"
    id=${options.id || nothing}
    style=${options.wide ? "--family-dialog-width:720px" : ""}
    aria-label=${options.title}
    aria-describedby=${options.ariaDescribedBy || nothing}
    @cancel=${flow.onCancel}
    ${ref(flow.dialogRef)}
  >
    <header class="family-dialog-header">
      ${flow.canBack && !flow.confirmation
        ? html`<button
            type="button"
            class="family-icon-button"
            title="Back"
            aria-label="Back"
            @click=${flow.back}
          >
            ${uiIcon("back")}
          </button>`
        : nothing}
      <h2 tabindex="-1" data-family-heading>${options.title}</h2>
      ${dialogClose(`Close ${options.title}`, flow.close)}
    </header>
    <div class="family-dialog-body ${options.bodyClass || ""}">
      ${flow.notice
        ? html`<p class="family-notice" role="status">${flow.notice}</p>`
        : nothing}
      ${flow.confirmation
        ? html`<section aria-label="Unsaved changes">
            <p>${flow.confirmation}</p>
            <div class="family-actions">
              <button
                class="family-action"
                type="button"
                data-family-keep
                @click=${flow.keepEditing}
              >
                Keep editing
              </button>
              <button
                class="family-action destructive"
                type="button"
                @click=${flow.discardAndContinue}
              >
                Discard changes
              </button>
            </div>
          </section>`
        : nothing}
      <div ?hidden=${!!flow.confirmation}>${options.content}</div>
    </div>
    ${options.footer != null &&
    options.footer !== nothing &&
    options.footer !== false &&
    !flow.confirmation
      ? html`<footer class="family-dialog-footer ${options.footerLayout === "equal" ? "equal" : ""}">${options.footer}</footer>`
      : nothing}
  </dialog>`;
}
