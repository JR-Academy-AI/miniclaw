---
id: short-term/inbox
type: inbox
updated: {{created_at}}
---

# Memory Inbox

<!-- Queue of candidate memories captured during sessions and Runs.
     Agents append here. Promotion (docs/MEMORY-PROMOTION.md) scores each item against meta/rubric.md;
     the consolidator only processes promoted items. Finished items ([x], [-]) older than 7 days are removed.

     Format:
     - [ ] <timestamp> | src: <session:id|run:id|daily:date|user> | op: <add|update|merge|supersede|archive|delete|rule> | target: <domain/slug> | conf: <high|medium|low> | sens: <normal|private|secret>
       <the fact, one or two sentences>

     States (set by miniclaw, with "| promo: <decision> <score> (<reason>)" appended to the first line):
     [ ] pending   [>] promote   [?] ask the user   [~] hold   [-] discard   [x] consolidated (→ #change-id)
-->

