# Archive (L4)

Cold storage. Never injected into prompts; searched only when the user asks about the past or current memory has no answer.

Layout mirrors the source tier:

```
archive/
├── short-term/YYYY/        # expired daily logs and weekly rollups
├── agenda/YYYY/            # past agenda items that were not meetings
├── meetings/YYYY/          # meetings older than the retention window
├── projects/               # projects done / archived for 30+ days
└── <domain>/               # anything else archived by consolidation
```

Archived files keep their frontmatter, with `status: archived` and `archived: <date>` added.
