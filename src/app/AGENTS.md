# App composition

- Assemble concrete engine, policy, transcript, workspace and TUI dependencies here only.
- Keep lifecycle orchestration separate from terminal rendering. The controller depends on core contracts, never SDK payloads.
- Allow one active user turn. Interrupt and shutdown must deny pending approvals before stopping the engine.
- Persist an event before exposing it to the view. A transcript failure stops the turn and remains visible.
- `/clear` clears only the view; it preserves the engine conversation and the persisted transcript.
- CLI help and demo must not require authentication or make paid requests.
- Default to Codex. Select Claude only through `--engine claude`; never silently fail over between engines.
- Keep engine registration and executable environment selection in `engines.ts`. Doctor must not load adapter SDKs.
- Run controller tests and the full typecheck after changing lifecycle behavior.
