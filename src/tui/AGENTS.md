# TUI

- Render core events and collect user intents; do not call SDKs or decide policy here.
- Use `chatReducer` in the application controller. Render committed blocks with Ink Static.
- Approval input owns the keyboard while pending. Enter always denies; only explicit a/s keys approve.
- Read colors, borders and glyphs from theme tokens; use ASCII alternatives in degraded terminals.
- `App` callbacks own lifecycle; Ctrl+C and /exit must call the controller to close the engine.
- Tests use fake events and approval brokers; do not invoke paid inference.
