# Minimal permission policy

- Keep decisions pure; filesystem canonicalization belongs to infra and is injected into the gate.
- Evaluate hard-floor rules before every action, including a repeated session grant.
- Session grants cover only the exact tool and input; never persist them.
- Audit the final decision before allowing execution. Audit failures must propagate.
- Deny dynamic or opaque shell execution in v0.1. This policy is not an OS sandbox.
- Run `npx vitest run src/core/policy` after policy changes.
