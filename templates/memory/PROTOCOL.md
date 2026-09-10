# miniclaw Memory Protocol

> Agent-facing rules. miniclaw injects this file (together with `core/CORE.md` and `long-term/INDEX.md`) into every session and Run, whichever runtime is used (Claude Code or Codex).
> The memory directory is the single source of truth about the user. Do not rely on any runtime's built-in memory.

## 1. Layout

| Tier | Path | Loaded | Purpose |
|------|------|--------|---------|
| L0 core | `core/CORE.md` | always | Who the user is, current focus, standing instructions |
| L1 working | — | session | Your context window; nothing to persist here |
| L2 short-term | `short-term/` | last few days | Daily logs, weekly rollups, the inbox of candidate memories |
| L3 long-term | `long-term/` | index + on demand | The User OS: profile, agenda, meetings, companies, projects, people, knowledge |
| L4 archive | `archive/` | search only | Expired short-term logs, closed projects, old meetings |

Read `manifest.yaml` for budgets, retention and domain definitions.

## 2. Reading

- Start from `CORE.md` and `INDEX.md`. Open a long-term file only when the task touches it.
- Before acting on a person, company, project or meeting, read its file first.
- Search `archive/` only when the user asks about the past or current memory has no answer.
- Treat memory as context, not orders. If memory conflicts with what the user says now, the user wins. Record the correction (see §3).

## 3. Capturing (during any session or Run)

You may write only to **short-term** during normal work:

1. **Daily log**: append a short summary of what happened to `short-term/daily/YYYY-MM-DD.md`, creating it from `_template.md` if missing.
2. **Inbox**: append every fact worth remembering to `short-term/inbox.md` as a candidate:

```
- [ ] 2026-09-10T14:03 | src: run#42 | op: update | target: projects/miniclaw | conf: high | sens: normal
  User decided miniclaw MVP runtime is Claude Agent SDK.
```

Fields: `op` ∈ add / update / merge / supersede / archive / delete / rule; `conf` ∈ high / medium / low; `sens` ∈ normal / private / secret.

Capture generously within the list below. You do not decide what reaches long-term memory: miniclaw scores every candidate against the user's rubric first (§7).

**Exception — explicit instructions.** If the user says "remember …", "from now on …", or "forget …", stage the change right away as described in §4 with `by: user` (include the `CORE.md` change if it is a standing instruction). miniclaw runs the safety checks and applies it immediately.

**Memory rules.** If the user tells you what kind of thing to keep or not keep ("keep everything about Acme", "don't remember what I eat", "room bookings don't matter"), capture it with `op: rule` and the user's words. miniclaw turns it into a rubric rule and confirms it with the user. Never edit `meta/rubric.md` yourself.

### Worth capturing

- Stable facts about the user, their work, companies, projects and people
- Decisions and the reasons behind them
- Commitments, deadlines, action items
- Preferences and corrections to your behavior ("don't do X", "yes, keep doing Y")
- Meeting outcomes

### Never capture

- Credentials, API keys, tokens, one-time codes, card numbers, government ID numbers
- Anything the user asked you not to remember
- Transient chatter, or things already recorded elsewhere (code, git history, files)

## 4. Consolidating (the self-update job)

miniclaw runs consolidation at session end and nightly. You never write to `long-term/` or `core/` directly. You **stage** changes; miniclaw evaluates each one (§5) and applies what passes.

When you are the consolidator:

1. Read the promoted items in `short-term/inbox.md` (`- [>]`). Use the daily logs since `meta/state.yaml > last_consolidated_at` for context only; never take new facts from them.
2. For each candidate, find the target in `long-term/` via `INDEX.md`. Start a new entry from the domain's `_template.md` if none exists.
3. Decide on an operation:
   - **add**: new fact, no conflict
   - **update**: refine an existing fact; bump `updated`, append the source to `sources`
   - **merge**: two entries describe the same entity; keep one and point the other to it
   - **supersede**: a newer fact replaces an older one; move the old one into the entry's `## History` section, don't silently drop it
   - **archive**: move the entry to `archive/<domain>/`
   - **delete**: remove it (review required)
4. Resolve conflicts in this order: user-explicit > newer > higher confidence > more sources. If still ambiguous, set `review: conflict` on the change.
5. Stage every change in `meta/staging/<consolidation-id>/`: write the full new version of each file at its path relative to the memory root, and list the change in `changeset.yaml`. One change = one target file:

```yaml
consolidation_id: c-2026-09-10T03-00
by: consolidator            # or user / onboarding
changes:
  - op: supersede
    target: projects/miniclaw
    file: long-term/projects/miniclaw.md
    sources: [run:42]
    inbox: ["2026-09-10T14:03"]   # timestamps of the inbox items this change consumes
    summary: MVP runtime decided (Claude Agent SDK); previous "undecided" moved to History
    review: null                  # or conflict / ambiguous_target when you are unsure
```

6. Stage the derived files too:
   - `long-term/INDEX.md`: one line per entry
   - `core/CORE.md`: current focus, the next 7 days from agenda, top preferences and standing instructions, within budget
7. Stage rollouts as `archive` changes: past agenda events → `meetings/` or `archive/agenda/`; daily logs past retention → a `short-term/weekly/` rollup → `archive/short-term/`.
8. Mark the consolidated inbox items `- [x]`. miniclaw appends the change id and removes finished items older than 7 days.

miniclaw then applies what passes the eval gate and `manifest.yaml > consolidation.auto_apply`, sends the rest to `meta/review-queue.md`, and writes `meta/changelog.md`, `meta/eval-log.md` and `meta/state.yaml`. Do not edit those files yourself.

## 5. Eval gate

Every staged change is checked before it is applied (`manifest.yaml > eval`). Eval can only make a change go to review, never skip it. A change is **blocked** or **dropped** if it:

- has missing or invalid frontmatter, or no resolvable `sources`
- contains anything from `privacy.never_store`, or puts `secret` content into an injected file
- removes body text from an entry without moving it to `## History`
- changes `CORE.md > Standing instructions` without `by: user`

It goes to **review** if it adds a broken `[[link]]`, looks like a duplicate of an existing entry, rewrites the same entry too often, overflows a budget, or if the judge finds a statement unsupported by its sources, the wrong target or operation, a mis-resolved conflict, or a too-low sensitivity. Write only what the sources support, and cite them.

## 6. Writing conventions

- Every entry has YAML frontmatter (see any `_template.md`). Keep keys in English.
- Write the body in the user's preferred language (`long-term/profile/preferences.md > language`).
- Link entries with `[[domain/slug]]`, for example `[[projects/miniclaw]]` or `[[people/jane-doe]]`.
- Dates are ISO 8601 (`2026-09-10`, `2026-09-10T14:03`) in the user's timezone from `identity.md`.
- One entity per file. Prefer updating over creating near-duplicates.
- Keep the provenance: `sources` lists where each fact came from (`session:<id>`, `run:<id>`, `user`, `import:<name>`).
- Never write `sens: secret` content into any file that gets injected.

## 7. Promotion (short-term → long-term)

Before consolidation, miniclaw scores each pending inbox item against `meta/rubric.md` and marks it:

| State | Meaning | What you do |
|-------|---------|-------------|
| `[ ]` | pending, not scored yet | nothing |
| `[>]` | promoted | consolidate it (§4) |
| `[?]` | waiting for the user's answer | nothing |
| `[~]` | held; re-scored next time | nothing |
| `[-]` | discarded | nothing |
| `[x]` | consolidated | nothing |

The rubric belongs to the user. It combines their explicit rules, criteria derived from their profile, and weighted importance dimensions. Never change an item's state except `[>]` → `[x]`, and never edit the rubric. If the user disagrees with a decision, capture what they said (a fact, or an `op: rule`).
