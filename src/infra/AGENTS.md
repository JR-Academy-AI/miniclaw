# Local infrastructure

- Keep filesystem and process effects here; depend only on core contracts.
- Never read credentials or invoke macOS Keychain tools. Engine-owned auth status may report selected nonsecret status fields only.
- Use private per-session workspace and transcript paths; never clean them automatically in v0.1.
- Canonical path inspection is defense in depth, not an atomic OS sandbox. Refuse uninspectable recursive paths.
- Persist each event before returning; propagate log failures so tools do not run without an audit.
- Run `npx vitest run src/infra` after changes.
