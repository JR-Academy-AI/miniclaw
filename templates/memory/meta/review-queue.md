# Review Queue

<!-- Changes the consolidator is not allowed to auto-apply (see manifest.yaml > consolidation.require_review).
     miniclaw shows these in the TUI; the user approves or rejects each one.

     Format:
     - [ ] <timestamp> | #<id> | op: <op> | target: <domain/slug> | reason: <delete|conflict|ambiguous_target|identity_change|supersede_explicit|private|eval_warn|eval_block|rubric_suggestion>
       Proposed: <what would change>
       Evidence: <sources>
       Eval: <failed checks and findings, when reason is eval_warn or eval_block>

     eval_block items are not applied unless the user approves them one by one; they are never batch-approved.
     rubric_suggestion items propose a new rule for meta/rubric.md; approving adds it as a user rule, rejecting mutes it for promotion.suggestions.cooldown_days.
-->
