# ha-card-ui

Build-time UI library `@bitosome/ha-card-ui` (tokens, glows, primitives, modal and navigation lifecycle, level meter, media overlay controls). It is never installed in HA.

<!-- workspace-pointer -->
## Shared workspace rules

Part of the bitosome Home Assistant workspace. Shared rules, access (SSH, ha-mcp) and processes
are in `../AGENTS.md` (the workspace entry point) and `../home-assistant-knowledge/`; they take
precedence over this file. Build, test, release and known gotchas for this repo:
[repo catalog](../home-assistant-knowledge/docs/repo-catalog.md#ha-card-ui).

- Edit and release from this checkout; never patch production directly.
- Push, tag/release, HACS install, production changes, reloads and restarts need the owner's explicit approval.
- This is the shared UI library. Consumers are in `consumers.json`; release and roll out with `../home-assistant-knowledge/docs/playbooks/shared-ui-release.md`.
- After a release or install, update `docs/current-state.md` and `docs/changelog.md` in the knowledge repo.
