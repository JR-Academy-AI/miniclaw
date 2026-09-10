# AGENTS.md

Guidance for any AI coding agent (Codex, Claude Code, …) working in this repository. This file is the single source of agent instructions: `CLAUDE.md` only imports it. Edit this file, never `CLAUDE.md`.

## Mandatory rules — read before any code task

The files in `rules/` are **mandatory** for all code (core, TUI, adapters, skills, scripts). Before writing, changing or reviewing code, read all of them. Before committing, walk through the checklist in `05-review-checklist.md`.

- @rules/00-overview.md — overview, priority when principles conflict, how to record exceptions
- @rules/01-solid.md — SOLID, dependency direction
- @rules/02-dry.md — DRY, rule of three, false DRY
- @rules/03-kiss-yagni.md — KISS limits, YAGNI
- @rules/04-other-principles.md — separation of concerns, composition, Law of Demeter, fail fast, least astonishment
- @rules/05-review-checklist.md — pre-commit checklist
- @rules/06-changelog.md — every feature updates `CHANGELOG.md`
- @rules/07-nested-agents-md.md — directory-level `AGENTS.md` for big modules, components and multi-provider directories

Directory-level `AGENTS.md` files hold rules specific to that directory. Not every tool loads them automatically, so **before changing code in a directory, read the `AGENTS.md` in that directory and in every parent directory up to the root.**

## Project status

miniclaw is a lightweight, local-first OpenClaw: a TUI-driven environment that runs AI automation tasks (one-off, scheduled, computer use) on top of the **Claude Code and Codex agent runtimes**. It orchestrates those runtimes; it never implements its own agent loop or LLM layer.

The project is **building v0.1** (ROADMAP M11). The stack was decided on 2026-09-10 (PRD §10): TypeScript (strict, ESM/NodeNext), Ink 6 + React 19, Node ≥ 20, `@anthropic-ai/claude-agent-sdk`, and vitest. Code lives in `src/` (`core/`, `adapters/`, `infra/`, `tui/`, `app/`). The directory is not a git repository yet.

## Where each kind of truth lives

| Topic | Source of truth |
|-------|-----------------|
| Product scope, priorities (P0/P1/P2), milestones, open questions | `docs/PRD.md` |
| Build order: v0.1 (chat) → v0.5 (skills), work packages M0–M12, dependencies, exit criteria, parallel lanes | `docs/ROADMAP.md` |
| Runtime Gateway: admission / rate limits (RPM-derived concurrency), per-Run budgets, error classification, recovery, engine detection (`/doctor`), usage schema | `docs/GATEWAY.md` |
| Two-layer harness: Domain Runtimes (research / browser / document / coding), capability vocabulary + effect classes, policy decision order, hard floor, enforcement points, approvals | `docs/HARNESS.md` |
| Memory system design | `docs/MEMORY.md` |
| Skills: discovery, per-Run selection and mounting, per-runtime delivery, provider matrix, engine-agnostic skill tool contract (`mc-skills`), API engine proposal | `docs/SKILLS.md` |
| Skills marketplace (client only): third-party sources, package identity, install flow, lockfile/updates, trust tiers, static scanning, quarantine, supply-chain security | `docs/SKILLS-MARKETPLACE.md` |
| Workspace: default working directory, per-Run temp dirs, cleanup rules, saved / external workspaces | `docs/WORKSPACE.md` (rules the agent sees: `templates/workspace/PROTOCOL.md`) |
| Memory update eval: write gate, health checks, regression suite | `docs/MEMORY-EVAL.md` |
| Memory promotion (short-term → long-term): per-user rubric, scoring, user rules, profile-derived criteria | `docs/MEMORY-PROMOTION.md` |
| First-run onboarding journey: engine connection, default Profile, "About you" interview (form / guided extraction), review → E1 write, deterministic CORE, starter tasks, resume / rerun | `docs/ONBOARDING.md` |
| Memory schema shipped to every user | `templates/memory/` (`manifest.yaml` + `PROTOCOL.md`) |
| TUI visual language (colors, glyphs, motion, breakpoints) | `design/tokens.json` (values) · `docs/DESIGN.md` (rules and rationale) |
| Code principles, review checklist, changelog and nested-AGENTS.md rules (**mandatory**) | `rules/` |
| Agent instructions | this file (`CLAUDE.md` only imports it) |
| Change history | `CHANGELOG.md` |

Docs are written in Chinese. Keys, file names and headings inside `templates/memory/` stay in English. The TUI's UI language is **English by default**: every string miniclaw itself renders (tabs, statuses, prompts, errors, welcome screen) is English, while user content is shown as-is. Copy rules live in `docs/DESIGN.md` §3.1.

## Repository layout

Top level only. The annotated full tree lives in `docs/README.md` (项目结构). When adding, moving or removing a top-level directory, update both.

```
AGENTS.md  CLAUDE.md  CHANGELOG.md  README.md
src/                 v0.1 implementation (core / adapters / infra / tui / app)
fixtures/            SDK evidence; M0 workflow in fixtures/m0/README.md
package.json         development commands and dependencies
rules/               mandatory code principles (loaded above) [AGENTS.md]
docs/                PRD + subsystem design docs          [AGENTS.md]
design/              Reef tokens + zero-dependency preview [AGENTS.md]
templates/memory/    per-user memory template (see its README.md and PROTOCOL.md)
templates/workspace/ agent-facing workspace rules, injected into every Run (PROTOCOL.md)
```

`[AGENTS.md]` marks directories with their own instructions, each paired with a one-line `CLAUDE.md`. Planned code directories, created only once the stack is chosen: `core/ adapters/ domains/ infra/ skills/ tui/ app/` (`rules/04-other-principles.md`).

## Commands

```bash
# Design preview (Node ≥ 20, zero dependencies). Modes: welcome | palette | screen
node design/preview/index.mjs welcome
node design/preview/index.mjs screen --static --light --depth 256 --width 90 --ascii

# Validate the memory template manifest after editing it
python3 -c "import yaml; yaml.safe_load(open('templates/memory/manifest.yaml'))"
```

The preview honors `NO_COLOR`, `FORCE_COLOR`, `COLORTERM`/`TERM` (color depth), `MINICLAW_THEME=light|dark`, `MINICLAW_ASCII=1`, `MINICLAW_REDUCED_MOTION=1` and `CI`. The TUI must keep the same behavior.

## Architecture (planned)

- **Dependency direction is fixed:** `TUI → core (interfaces + orchestration) ← adapters / skills / infra`. Core never imports a concrete SDK (Claude Agent SDK, Codex SDK, screenshot/input libraries). SDKs live only in their adapter directory. Wiring happens in a single composition root (`app/`).
- **Core modules have hard boundaries:** `router` picks runtime and model profile but never executes. `scheduler` decides *when*, not *how*. `skill registry` discovers and loads but never runs skills. `adapter` translates the unified interface to one runtime and makes no routing decisions. `memory manager` owns the memory lifecycle. `runtime gateway` admits, guards and recovers Runs. It does not route, schedule or check permissions. `policy engine` is the only place that decides permissions. Enforcement points (engine sandbox/rules, engine per-call callbacks, miniclaw MCP tool servers) ask it and never re-implement the decision.
- **Two-layer harness** (`docs/HARNESS.md`): L1 is the engine's own harness (Claude Code / Codex). L2 is a miniclaw **Domain Runtime** per task type (`research`, `browser`, `document`, `coding`). A Domain Runtime compiles to an engine-agnostic `HarnessSpec` that each adapter translates. It never patches the engine loop. The naming clash: bare "runtime" in older docs means the engine, while "Domain Runtime" means the L2 layer. Capability effects in HARNESS §6.2 are the single risk classification, and the GATEWAY side-effect gate uses it. The hard floor (HARNESS §6.4) is not configurable, and agents can never read or write miniclaw's own policy, task grants or other users' data.
- **Every Run goes through the Runtime Gateway** (`docs/GATEWAY.md`). This covers interactive, scheduled and memory-consolidation Runs. It is the only path from core to an adapter, and calling an adapter directly is a design error. It enforces per-quota-pool admission (concurrency, rate, daily budget; computer use concurrency is 1), per-Run guards (turns, tokens, cost, time, loop detection), and one `ErrorKind` taxonomy that each adapter maps its raw errors into. **Side-effect gate:** a Run that already had side effects is never automatically re-run from scratch. It may only be resumed or handed to the user. Runtimes already retry single API calls, so miniclaw retries only at Run level, and sparingly.
- **Extension is registration, not branching:** a new runtime, skill or routing strategy is added by implementing an interface and registering it. `if (runtime === 'codex')` in core flows is forbidden. Capability differences are declared via `capabilities`; adapters never throw `NotImplemented`. All adapters must pass one shared contract test suite.
- **Domain model:** Profile + Skills + Policy + Memory → **Task** → (manual or Schedule trigger) → **Run** (persisted event log + output). Each Run captures to short-term memory; consolidation feeds long-term memory back into future Tasks.
- **Per-user isolation:** runtime data lives under `~/.miniclaw/users/<user_id>/` (`model-profiles/`, `skills/`, `tasks/`, `runs/`, `workspace/`, `state/`, `memory/`). Only `~/.miniclaw/skills/` is shared across users.
- **Workspace** (`docs/WORKSPACE.md`): a Run with no working directory runs in a fresh `workspace/tmp/<run_id>/`, never in the shell cwd. Deliverables go to `MINICLAW_OUT` (`runs/<run_id>/artifacts/`) and are never cleaned. Automatic cleanup touches only `workspace/tmp/`, never deletes a dir a resumable Run still references, and never follows symlinks. Only the user can make a workspace permanent (`/workspace save`); agents cannot.
- **Safety defaults:** computer use, shell, deletion and outbound actions require confirmation by default. Unattended scheduled Runs may only use operations pre-authorized when the task was created.

## Memory template

`templates/memory/` is the one schema every user's memory is instantiated from (`~/.miniclaw/users/<user_id>/memory/`). It is not anyone's actual memory. Tiers: L0 `core/CORE.md` (always injected) · L1 working (context window, not stored) · L2 `short-term/` · L3 `long-term/` (the "User OS": profile, agenda, meetings, companies, projects, people, knowledge) · L4 `archive/`.

- Agents write only to `short-term/` during normal work. `long-term/` and `CORE.md` change only through consolidation or an explicit user instruction ("remember …"), and even then the agent only stages changes in `meta/staging/`. The memory manager applies each change after the eval gate (`docs/MEMORY-EVAL.md`). Eval may send more changes to review but never fewer. Every change is logged in `meta/changelog.md` and every verdict in `meta/eval-log.md`. Risky changes go to `meta/review-queue.md`.
- Consolidation only consumes inbox candidates that **promotion** marked `[>]` (`docs/MEMORY-PROMOTION.md`). Promotion scores candidates against the user's own `meta/rubric.md`, in this order: privacy floor, then user rules, then profile-derived criteria, then weighted importance dimensions. User rules change only when the user says so, never automatically. No agent, consolidator or scorer may write the rubric.
- Memory is runtime-agnostic: miniclaw injects `PROTOCOL.md` + `CORE.md` + `long-term/INDEX.md` itself and must not rely on a runtime's built-in memory.
- When changing the template, bump `template_version` in `manifest.yaml`, and bump `schema_version` for incompatible structure or frontmatter changes. Keep changes additive where possible, since migrations must never overwrite user content. `{{user_id}}`, `{{created_at}}` and `{{template_version}}` are filled at instantiation. Entry placeholders (`{{slug}}`, `{{date}}` …) stay inside `_template.md` files. Files listed in `instantiate_exclude` are template docs and are not copied.
- Naming clash: the memory domain `profile/` means the user's personal profile. The PRD's "Profile" means a model/runtime profile (stored as `model-profiles/`).

## TUI design system ("reef")

`design/tokens.json` is the single source for every color, glyph, border, spinner timing and layout breakpoint. Never hardcode a hex value or glyph in UI code. Resolve colors through the semantic (`success`, `permission`, `scheduled` …), module (`chat`, `tasks` …) and profile (`thinker`, `coder` …) mappings. Every color has dark and light values plus an ansi16 fallback. Every glyph has an ASCII fallback. The reef gradient is reserved for brand moments (logo, welcome, "thinking"). `design/preview/` is a design prototype, not the TUI implementation. Its `sample-data.mjs` stands in for data that will come from core.

## Working rules (summary; `rules/` is authoritative)

- Every feature, behavior change, fix or security change adds an entry under `## [Unreleased]` in `CHANGELOG.md` in the same change. Entries are prefixed with the module (`scheduler:`, `adapter/codex:`, `memory:` …) and written from the user's point of view.
- Big modules, TUI component groups and multi-provider directories (e.g. runtime adapters) need their own `AGENTS.md` (≤ 80 lines, templates in `rules/07-nested-agents-md.md`) plus a one-line `CLAUDE.md` containing `@AGENTS.md`, committed with the code.
- KISS limits: functions ≤ 40 lines, files ≤ 300 lines, ≤ 3 parameters, nesting ≤ 3. Justified exceptions need an inline `原则例外:` comment.
- Scope per version is in PRD §9, and the build order is in `docs/ROADMAP.md`. **v0.1 (M0 + M11) is only: TUI → Claude engine → chat**, with engine detection, a minimal permission gate and a transcript log. There are no tasks, Gateway admission, scheduler, profiles, memory, Domain Runtimes or skills yet. Even so, v0.1's permission gate must isolate the user's engine config and gate every tool call through the PreToolUse hook (ROADMAP M11). Build v0.1 simplifications against the final interfaces so later versions extend them instead of replacing them. M-numbers are work-package IDs, not execution order.
