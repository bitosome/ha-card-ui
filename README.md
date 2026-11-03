# Home Assistant Card UI

Build-time UI library for the bitosome Home Assistant cards and Budget Manager.
Space Hub Card is the visual reference, particularly its activation glow beneath
all sibling tile faces. This package owns reusable presentation and interaction
behavior; integrations continue to own physical actions, persistence and domain policy.

## Install and release

Install the exact release tarball and commit the generated package lock:

```sh
npm install --save-exact https://github.com/bitosome/ha-card-ui/releases/download/v1.5.0/bitosome-ha-card-ui-1.5.0.tgz
```

Lit 2 or 3 is a peer dependency. Import from `@bitosome/ha-card-ui` and bundle with
your existing build. No HACS resource, runtime CDN import, integration, globally
registered custom element or npm account is required. Different card versions can
coexist safely. Updating the library requires rebuilding and releasing consumers;
it never silently replaces code running in another card.

## Shared components

Compose `designTokens`, `familyStyles`, `componentStyles`, `headerStyles`,
`metricStyles`, `telemetryStyles`, `navigationStyles`, `dialogStyles`, `glowStyles`
in Lit `static styles` (or use each `.cssText` in a vanilla panel).

Templates: `actionPill`, `togglePill`, `levelMeter`, `stateChip`, `metricTile`, `notice`,
`asyncState`, `disclosure`, `uiIcon`, `tileGlow`, `renderFamilyDialog`, `pendingIndicator`. All templates remain in the consumer's
shadow root. Values are escaped by Lit. Actions receive callbacks; no component
calls a Home Assistant service itself. `showEntityMoreInfo` is a small native HA
event adapter.

## Navigation and edits

Use one `FamilyFlowController` and one `renderFamilyDialog` per card/panel.
Main readings and frequent controls stay on the card. Substantial Settings,
Details and History open the common dialog. Child pages use `push`, Back pops
one page, and X/Escape/backdrop requests closing the whole flow. A confirmation
is part of the same dialog; Escape from it returns to editing.

Settings launchers use `UI_ICONS.settings` (`mdi:cog-outline`), details use
`UI_ICONS.details`, and history uses `UI_ICONS.history`. A launcher is a button
with `aria-haspopup="dialog"`, an explicit contextual name and at least a 44px
tap target. Pass its `event.currentTarget` to `flow.open` so closing also returns
focus correctly after a touch tap. Do not label dialog launchers as tabs or
use `aria-expanded` as if they expanded inline content. A pencil edits a named
record; a chevron indicates navigation/disclosure, not a replacement settings icon.

```ts
private flow = new FamilyFlowController<'settings' | 'price'>(this, {
  guard: (intent, route) => ({
    dirty: intent !== 'navigate' && this.draftChanged,
    pending: this.saving,
    discard: () => this.resetDraft(),
  }),
});
// In render():
renderFamilyDialog(this.flow, {
  title: this.flow.current === 'price' ? 'Price per cup' : 'Settings',
  content: this.renderPage(),
});
```

The shared guard handles Back, X, Escape and backdrop together. `pending` blocks
dismissal only when the consumer chooses that policy. A dispatched transaction
is not an unsaved draft. Capture `flow.generation` before async work and call
`flow.isCurrent(token)` before changing or closing its UI. Keep financial request
identity and physical-command confirmation in domain code.

Use `flow.handoff(() => showEntityMoreInfo(this, entityId))` to guard and close
the custom top layer before native HA UI opens. `forceClose` is reserved for a
confirmed save or deliberate teardown. Do not bypass a dirty guard for navigation.

Vanilla panels supply `{requestUpdate()}` as the host, call `flow.hostUpdated()`
after rendering and `flow.hostDisconnected()` on teardown. Lit hosts receive
these callbacks automatically. Mark a preferred input or safe Cancel button
`data-family-initial-focus`; otherwise route changes focus the heading. Telemetry
updates do not reset focus or caret position.

Robot room defaults and per-room settings use the same modal flow. Room toggles,
order, selected-setting pills and active-queue Apply/Cancel remain on the main
card. Moving an editor into a modal does not change its persistence contract:
shared autosave remains shared autosave, and an explicit save remains explicit.
Opening or closing settings must never dispatch a device command.

Inline exceptions are intentional: room selection and native HA sorting; small
activity disclosures; chart point selection; media playback. HA-owned card
configuration and entity more-info stay inside their native Home Assistant UI;
never put another custom modal around that existing editor or dialog.

## Camera and media interactions

`MediaZoomController` reuses Camera Card's local 1–5× pinch zoom and bounded pan.
It never issues PTZ or other device commands. Supply a Lit host (or an object with
`requestUpdate()`) and `{ enabled: () => expanded }`. Bind `touchStart`, `touchMove`
and `touchEnd` to the viewport's touch events; also bind `touchEnd` to `touchcancel`.
The callbacks carry `passive: false` for Lit; imperative listeners must supply
`{ passive: false }`. Call `consumeClick(event)` in a capture-phase click listener
before playback actions to suppress the click synthesized after a gesture.

Apply `zoom.transform` only to the media surface, with a centered transform origin.
Keep controls outside that transformed surface and clip the viewport. Use
`touch-action: none` only while expanded; normal dashboard scrolling remains
available inline. Buttons, links, form fields and `[data-media-control]` elements
are excluded from gestures. Display a reset control when `zoom.state.scale > 1`.
Call `reset()` when the source or expanded state changes. Lit teardown resets
automatically; imperative users call `dispose()`. The pure `initialZoom`,
`moveZoom`, `clampZoom`, `ZoomPoint` and `ZoomState` APIs are also exported.

`ensureCameraStreamElements(entityId, tag, { timeoutMs? })` asks HA's card helpers
to import the actual requested `ha-camera-stream` or `ha-web-rtc-player`. It shares
concurrent loads, times out after ten seconds by default and permits retries after
failure. Consumers still own loading/error UI and must ignore async results after
disconnect or a configuration change. No HACS runtime dependency or global custom
element is installed by this library.

`toggleMediaFullscreen(api, target)` enters or exits fullscreen only for that
target and verifies real entry. `false` means unsupported, rejected or no actual
transition; use `MediaFullscreenFallbackController` for the in-place viewport fallback. Do not replace another
element's fullscreen or open a fallback over an unsuccessful exit while the target
is still fullscreen. `isMediaFullscreen(api, target)` reports actual ownership.
Use `createMediaFullscreenAPI(document)` for standard/WebKit native methods and
nested shadow-root ownership, or pass a compatible `screenfull` adapter. Consumers
own native fullscreen-change listeners and safe-area controls. The fallback
controller below owns Escape, focus restoration and the existing player lifetime.

For fullscreen media, compose `mediaFullscreenStyles` and create
`new MediaFullscreenFallbackController(host, { onChange(active) { … } })`.
After the native attempt fails without another fullscreen owner, call
`open(existingFrame, opener)`. The original player remains mounted: supported
browsers promote the frame using a manual Popover top layer, with a fixed viewport
fallback on older engines. This is an immersive stream with no dialog header.
Call `close()` from the same fullscreen button; Escape exits too. The controller
contains keyboard focus, restores the opener, cooperates across independently
bundled cards when locking page scrolling, and cleans up on host disconnection.
Its `active` getter can enable zoom and the fullscreen-exit icon. It marks the
frame with `data-media-fullscreen`; use `object-fit: contain` while expanded.
Keep safe-area padding on controls inside the frame. `mediaDialogStyles` remains
available for existing general-purpose media dialogs, but camera fullscreen uses
the in-place controller in both Camera Card and the printer card.

## Activation glow

`buildGlow(colors, mode, active)` is extracted from Space Hub's original helper.
Place `.family-tile-group` on the common ancestor of **all adjacent surfaces**,
including headers, notices, metric grids, list panels and embedded cards. A grid
inside that scope is ordinary layout; do not isolate it again. An isolated grid
can paint its entire glow above a following panel even when each of its own
tile faces is correctly layered.

Use `.family-tile-wrap` wrappers, `tileGlow(...)` at z-index 0 and
`.family-tile-face` (or `.family-surface`) at z-index 1. Shared notices are also
foreground surfaces. Give custom neighboring panels the same foreground layer
and an opaque theme surface so light remains visible in gaps, never over their
contents. A transparent surface intentionally reveals what is behind it.

Never add `isolation`, `transform`, `filter`, partial `opacity`, non-auto
`z-index` or other stacking-context properties to individual wrappers or
intermediate layout groups. The glow and every neighboring face must participate
in the same context. Do not add a colored glow shadow to a foreground face.
Do not fix overlap by clipping the tile group: that removes the glow in gaps
and can clip keyboard focus. Bound the **outer dashboard card** with
`overflow: clip` so its halo cannot paint over independent neighboring cards.
Keep enough outer padding for focus rings (at least outline width plus offset);
do not clip individual tiles, wrappers or grids. Custom dialogs must use native
`showModal()` so they enter the top layer and remain outside this clipping.
Check artwork, focus, and dialog bounds at mobile sizes after adding the boundary.

Verify real browser painting with active first and last tiles, simultaneous
active tiles, preceding and following panels, and light/dark themes. Compare
glow-on and glow-off screenshots: neighboring opaque surface interiors should
be unchanged, while the gaps retain the halo. CSS contract tests alone cannot
verify browser paint order.
Idle is normally quiet. Domain code chooses genuine activation and semantic
colors. Reduced-motion users get a static indication. User-configured colors and
existing Space Hub state semantics remain authoritative.

## Maintenance

`npm ci && npm test` checks builds, navigation, guards, focus lifecycle, handoff,
late-operation tokens, component semantics and glow behavior without operating
devices. Tags publish a tested tarball and checksums through GitHub Releases.
Consumer release CI uses lockfile integrity to verify the exact package. Public
API changes use semantic versioning. See `consumers.json` for owning repositories.

Foundation extracted from MIT-licensed bitosome/space-hub-card v2.0.85, commit
fef0a785d900a2cea0b6b6ef02a274b674f3d171. Its theme tokens and glow remain the
reference; this package is now their canonical implementation.

### Pending actions and confirmation buttons

Use `pendingIndicator()` inside an action while its command is pending; pair it with a visible pending label and `aria-busy`. `actionPill({pending: true})` does this automatically. Reduced motion keeps the indicator static. A `family-visually-hidden` live region can announce progress without duplicating visible notices. Errors still need a visible recovery path.

Use `renderFamilyDialog(..., {footerLayout: "equal", ...})` for two confirmation actions. They share equal widths and a minimum 48px height; default dialog footer layouts are unchanged.

### Status colours, notices and states (1.4.0)

Every `data-tone` resolves through one chain defined in `familyStyles`: `--family-success`, `--family-warning` and `--family-error` follow the HA theme's `--success-color`, `--warning-color` and `--error-color`, so user themes keep working, and fall back to the family `--status-*` palette; `--family-caution` uses `--status-caution-color`. `--family-active` (from `--status-active-color`) is available to card CSS for work in progress. `--family-unavailable` is the readable secondary text colour; always pair it with a text label. Card CSS should use these `--family-*` aliases instead of `--status-*`, HA variables or private hex values, so a chip, notice and card-owned dot cannot show two greens. Tones are `neutral`, `accent`, `success`, `caution`, `warning`, `error` and `unavailable`; thresholds stay in the integration.

- `notice({tone, title, message, icon, body, action, actions, role})` shows the tone's severity icon (`TONE_ICONS`) unless `icon: false`, an optional bold title, extra body content and several recovery actions. Errors default to `role="alert"`, everything else to `status`.
- `asyncState({state: "loading" | "empty" | "error", message, onRetry, retryLabel, retrying})` keeps loading, `No activity yet` and `Could not load activity` distinct, with one retry action.
- `actionPill` adds `emphasis: "primary" | "secondary" | "quiet" | "destructive"` (the `primary`/`destructive` booleans still work), `ariaLabel`, `hasPopup`, `className` and `initialFocus`, which marks Cancel in a destructive confirmation as the dialog's first focus.
- `togglePill({label, pressed, onClick, icon})` is an enabled/selected pill with `aria-pressed`; it keeps its icon and shows a trailing check when pressed, without shifting layout. Unpressed, the check keeps its slot and the label is shifted visually so it reads centred, whatever padding the card sets (1.5.0); a left-aligned option list resets that with `translate: none` on the pill's children. String-template cards copy the markup: `class="family-action family-toggle"`, `aria-pressed`, a label `<span>` and a trailing `<ha-icon class="family-toggle-check">` as a direct child.
- `stateChip` adds `ariaLabel` (e.g. "Front left door open"; the secondary line is appended to the spoken name), a quieter `secondary` line, `hasPopup` and `className`. `tone: "unavailable"` renders an outlined chip in the unavailable text colour.

### Formatting and unavailable values (1.4.0)

`formatHassNumber`, `formatHassCurrency`, `formatHassTime`, `formatHassDate`, `formatHassDateTime`, `formatHassRelative` and `formatHassDuration` read the HA profile (`hass.locale` language, number format, 12/24-hour clock and local/server time zone) the same way the HA frontend does. Callers pass the quantity's precision (`digits`) and unit. Missing, `unavailable`/`unknown`, non-numeric (booleans, blanks, objects) and non-finite input returns `UNAVAILABLE_TEXT` (`Unavailable`), never `0`; use `NOT_CONFIGURED_TEXT` for unbound optional data and `isAvailableValue` to decide whether to show a unit. Style missing values with `.family-unavailable` or `data-tone="unavailable"`. Durations show the largest unit and the next non-zero one, e.g. `1 h 5 min`. Invalid locale tags, currencies or zones degrade to `Unavailable` (or the browser zone) instead of throwing during render.

### Level meters (1.5.0)

`levelMeter({value, label, valueText, tone, target, className})` is the one 0–100 % bar for battery charge, fan speed and similar levels, so every card shows the same 6px track, colours and target marker. It is a `role="meter"` with an accessible name; a missing value draws an empty track announced as Unavailable. The fill uses `tone` (default `accent`, the primary colour). `batteryTone(percent)` returns the shared vehicle battery bands: 60 % and above `success`, 20–59 % `warning`, below 20 % `error`. Cards that render HTML strings use `levelMeterMarkup()`, which escapes its text. The styles ship in `componentStyles`; the card sets only spacing through `className`.

