# Engine adapters

- Implement `core/engine.ts`; keep SDK imports inside the matching adapter.
- Gate every tool invocation before execution. An unavailable or failed gate must deny.
- Keep provider errors, session mechanics and usage translation out of core and TUI.
- Every send yields exactly one terminal event, including interruption and SDK failures.
- Fixture replay tests are offline contract evidence; never describe them as a fresh live smoke test.
