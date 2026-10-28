# Home Assistant Card UI

Build-time UI library for the bitosome Home Assistant cards and Budget Manager.
Space Hub Card is the visual reference, particularly its activation glow beneath
all sibling tile faces. This package owns reusable presentation and interaction
behavior; integrations continue to own physical actions, persistence and domain policy.

## Install and release

Install the exact release tarball and commit the generated package lock:

```sh
npm install --save-exact https://github.com/bitosome/ha-card-ui/releases/download/v1.1.0/bitosome-ha-card-ui-1.1.0.tgz
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

Templates: `actionPill`, `stateChip`, `metricTile`, `notice`, `disclosure`,
`uiIcon`, `tileGlow`, `renderFamilyDialog`. All templates remain in the consumer's
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
transition; use the shared top-layer media dialog fallback. Do not replace another
element's fullscreen or open a fallback over an unsuccessful exit while the target
is still fullscreen. `isMediaFullscreen(api, target)` reports actual ownership.
Use `createMediaFullscreenAPI(document)` for standard/WebKit native methods and
nested shadow-root ownership, or pass a compatible `screenfull` adapter. Consumers
own fullscreen-change listeners, safe-area controls, X/Escape/focus restoration and
ensuring only one active stream exists when moving into a fallback dialog.

For an expanded media fallback, compose `mediaDialogStyles` after the ordinary
`dialogStyles`, pass `className: "media"` to `renderFamilyDialog` and wrap the media
in `.family-media-content`. This additive variant uses the shell's available safe
area width and height, removes body padding and retains its ordinary title/X header.
The media frame should fill that wrapper with `object-fit: contain`; do not apply
the variant to Settings, Details or ordinary content dialogs.

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
