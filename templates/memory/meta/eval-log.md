# Eval Log

<!-- Append-only log of the eval gate (see manifest.yaml > eval). Written by miniclaw, not by agents.
     Shares change ids with changelog.md; blocked and dropped changes appear here but not in the changelog.

     Evaluation record:
     - <timestamp> | #<change-id> | by: <consolidator|user|onboarding> | op: <op> | target: <domain/slug> | verdict: <pass|warn|block|drop>
       checks: <check>=<pass|warn|block|drop>[(<finding>)] …

     Outcome record, appended later:
     - <timestamp> | #<change-id> | outcome: <applied|approved|rejected|undone|edited|dropped> | by: <miniclaw|user>

     Promotion record (docs/MEMORY-PROMOTION.md §6), one per scored inbox candidate:
     - <timestamp> | P#<id> | cand: <inbox item timestamp> | decision: <promote|ask|hold|discard|drop> | score: <0-100> | dims: dur=<0-3> rel= act= imp= nov= exp= conf= | rules: <rule and criterion ids, or explicit_remember|duplicate|privacy>
     - <timestamp> | P#<id> | outcome: <answered_yes|answered_no|consolidated → #change-id|expired|restated>

     Dropped changes record the check and the location (file + line) only, never the offending text.
     Records older than eval.log_retention_days move to archive/meta/.
-->
