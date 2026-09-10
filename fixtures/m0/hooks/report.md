# M0 · Claude per-call hook verification

Status: existing real SDK fixtures independently verified; remaining live probes pending isolated authentication.

## Reproduce the independent check

From the repository root:

```sh
node fixtures/m0/hooks/verify-existing.mjs
```

The verifier performs no model calls. It reads prior Claude-agent fixtures without changing them, checks actual `tool_result` blocks and callback IDs, and writes `evidence/existing-verification.json` with SHA-256 source snapshots. SHA-256 here covers nonsensitive fixture files, never credentials.

## Verified against existing fixtures

Engine reported by `gate.jsonl`: Claude Code `2.1.267`.

| Requirement | Observed evidence | Scope |
|---|---|---|
| Per-call `PreToolUse` | All four `tool_use.id` values match exactly one hook callback and one `tool_result` | Bash ×2, Read, Write; does not prove every possible tool or subagent |
| Hook deny / allow | First Bash returns `is_error: true`; second returns actual stdout `step2` | Engine execution evidence, not final assistant prose |
| Hook ask → `canUseTool` | Read and Write IDs appear in both callbacks; Read returns fixture content; Write returns permission rejection | No allow rules in historical spike; no explicit deny rule supplied, so deny-only configuration still needs a dedicated check |
| Explicit hook timeout | 3-second timeout with 8-second callback delay returns `is_error: true` and states the tool was not executed | This tested version fails closed |
| Long approval wait | Actual Bash stdout `asked`; result duration 79,162 ms with 75,000 ms configured wait | Proves this 75-second case, not absence of any timeout |
| Default hook wait | Actual Bash stdout `slow-hook`; result duration 82,188 ms with 75,000 ms configured wait | Do not infer a universal default deadline |
| Interrupt pending hook | `non_execution_kind: user-rejected`, terminal `aborted_tools`; following result `still-alive` | Real rejection and same-session recovery |

Files supplying these results are enumerated and content-locked in the generated evidence JSON. Historical callback wall-clock timing was not stored in the JSONL, so wait-duration claims also depend on the checked-in spike script. Filesystem absence of the denied `out.txt` was not recorded; denial is established by engine tool-result metadata only.

## Not yet empirically verified

- `allowedTools` auto-allow bypasses `canUseTool`, while still invoking `PreToolUse`.
- Multiple hook decisions merge with deny priority, in either callback order.
- Explicit deny-only engine rules combined with hook ask reach `canUseTool`.
- The separate skill-frontmatter `allowed-tools` path, MCP tools and subagents. A programmatic `allowedTools` test would establish that API surface only.

The installed SDK declaration documents `allowedTools` as auto-allowing, but a type comment is not live verification. No additional Claude calls were made for the replay. New probes must use the auth lane's verified configuration isolation; `settingSources: []` and `persistSession: false` alone do not prove the engine never writes runtime data under the user's config directory.
