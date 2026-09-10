# Claude Code adapter

- Reuse the SDK query for multi-turn conversation; interrupt stops a turn without clearing context.
- Preserve authentication through the normal config location, but load no filesystem setting sources, external MCP servers, hooks or skills. Full config-directory separation has not been proved with login reuse.
- Never inherit provider environment variables. Never read or copy credentials.
- Keep an explicit tool list without Skill or Agent; PreToolUse is the only approval gate. canUseTool denies unexpected fallback calls.
- Deduplicate assistant snapshots by message ID; streaming message_delta updates final token counts. Result usage is per turn; modelUsage and estimated cost are cumulative per query.
- An `is_error: true` result is an error even when subtype is `success`. Allowed rate-limit telemetry is not a terminal failure.
- Offline tests live beside the adapter. Real samples live in `fixtures/claude-code/`; do not overwrite them for unit tests.
