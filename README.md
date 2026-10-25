# Home Assistant Card UI

Build-time UI library for the bitosome Home Assistant cards and Budget Manager.
Space Hub Card is the visual reference, particularly its activation glow beneath
all sibling tile faces. This package owns reusable presentation and interaction
behavior; integrations continue to own physical actions, persistence and domain policy.

## Install and release

Install the exact release tarball and commit the generated package lock:

```sh
npm install --save-exact https://github.com/bitosome/ha-card-ui/releases/download/v1.0.0/bitosome-ha-card-ui-1.0.0.tgz
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

Inline exceptions are intentional: robot room selection, per-room settings,
native HA sorting, shared autosave, active-queue Apply/Cancel; small activity
disclosures; chart point selection; media playback. This library does not add
modals merely to make different domains look identical.

## Activation glow

`buildGlow(colors, mode, active)` is extracted from Space Hub's original helper.
Use a `.family-tile-group` isolated group with `.family-tile-wrap` wrappers,
`tileGlow(...)` at z-index 0 and `.family-tile-face` at z-index 1. Never isolate or
transform individual wrappers: every glow must stay below every sibling face.
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
