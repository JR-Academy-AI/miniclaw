# miniclaw Memory Template

This directory is the **memory template shared by every miniclaw user**. It is not anyone's memory.

On a user's first login, miniclaw copies this directory to `~/.miniclaw/users/<user_id>/memory/`, fills the instance placeholders, and runs onboarding to populate it. Every user starts from the same structure, so every agent, skill and scheduled task can rely on the same paths.

Design doc: [`docs/MEMORY.md`](../../docs/MEMORY.md)

## Layout

```
memory/
├── manifest.yaml            # schema: tiers, domains, budgets, retention, self-update, privacy
├── PROTOCOL.md              # rules the agent follows to read / capture / consolidate
├── core/
│   └── CORE.md              # L0  always loaded: who, current focus, next 7 days, standing instructions
├── short-term/              # L2  recent context, expires
│   ├── inbox.md             #     candidate memories awaiting consolidation
│   ├── daily/_template.md   #     one log per day
│   └── weekly/_template.md  #     rollups before daily logs are archived
├── long-term/               # L3  the User OS
│   ├── INDEX.md             #     one line per entry, always loaded
│   ├── profile/             #     identity · preferences · goals
│   ├── agenda/              #     agenda (events, deadlines, recurring) · todos
│   ├── meetings/            #     meeting logs, one file per meeting
│   ├── companies/           #     employer, own company, clients, partners …
│   ├── projects/            #     one file per project
│   ├── people/              #     people the user works with
│   └── knowledge/           #     facts · lessons · feedback · references
├── archive/                 # L4  cold storage, search only
└── meta/
    ├── state.yaml           #     instance state (template version, last consolidation)
    ├── changelog.md         #     append-only log of every memory change
    ├── review-queue.md      #     changes waiting for user approval
    ├── rubric.md            #     the user's own rules for what is worth promoting to long-term
    ├── eval-log.md          #     eval gate verdict for every proposed change, plus its outcome
    ├── health.md            #     latest weekly health report on memory updates
    └── staging/             #     (created at runtime) changes proposed by consolidation, before eval
```

Eval design (gate, health checks, regression suite): [`docs/MEMORY-EVAL.md`](../../docs/MEMORY-EVAL.md). Promotion from short-term to long-term (rubric, scoring, user rules): [`docs/MEMORY-PROMOTION.md`](../../docs/MEMORY-PROMOTION.md)

(L1 "working memory" is the runtime's context window and is not stored here.)

## Placeholders

| Placeholder | Filled when | Value |
|-------------|-------------|-------|
| `{{user_id}}`, `{{created_at}}`, `{{template_version}}` | memory is instantiated | user id, ISO timestamp, `manifest.yaml > template_version` |
| `{{date}}`, `{{week}}`, `{{slug}}`, `{{title}}`, `{{name}}` | a new entry is created from a `_template.md` | entry-specific |

`_template.md` files are copied into the instance unchanged and stay there, so agents always have the entry format at hand.

## Changing the template

- Bump `template_version` in `manifest.yaml` on every change, and `schema_version` when the structure or frontmatter changes incompatibly.
- Additive changes (new domain, new optional field, new section) are migrated into existing instances automatically. New files are added; existing user content is never overwritten.
- Breaking changes need a migration script, and miniclaw backs up the instance before running it.
- Keep keys, file names and section headings in English. Users' own content is written in their preferred language.
