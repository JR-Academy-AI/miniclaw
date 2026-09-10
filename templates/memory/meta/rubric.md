---
id: meta/rubric
type: rubric
user_id: {{user_id}}
updated: {{created_at}}
derived_from: []           # profile sources and their `updated` stamps at the last rebuild of Derived criteria
thresholds:                # final score 0–100
  promote: 70              # ≥ 70  promote to long-term (still goes through the eval gate and review)
  ask: 55                  # 55–69 ask the user "remember this?"
  hold: 35                 # 35–54 keep in short-term and re-score later; < 35 discard
weights:                   # each dimension is scored 0–3; see Dimension guide
  durability: 3
  relevance: 3
  actionability: 2
  impact: 2
  novelty: 2
  explicitness: 2
  confidence: 1
---

# Memory Rubric

<!-- Decides which short-term candidates are worth long-term memory. Design: docs/MEMORY-PROMOTION.md.
     Priority: privacy floor (never overridable) > User rules > Derived criteria > weighted score.
     You can edit anything in this file. The consolidator and the scorer can never write it. -->

## User rules

<!-- Only the user adds or removes these: explicit instructions ("from now on keep …", "don't keep …"),
     onboarding answers, and rule suggestions the user accepted.
     effect: always (promote) · never (discard) · boost:+N · lower:-N  (N = 5–30 points)
     match:  a target glob (companies/acme, people/*), a tag (#health), or a topic in plain words

     - <id> | <effect> | match: <…> | src: <user|onboarding|suggestion:#id> | added: <date>
       <the rule in the user's own words>
-->

## Derived criteria

<!-- Rebuilt by miniclaw from profile/identity, profile/goals, profile/preferences, CORE current focus and active projects
     whenever they change. A matching line raises the relevance score to at least `boost` (1–3). It never changes other dimensions.
     state: on (rebuilt freely) · pinned (kept through rebuilds) · off (kept, disabled; will not come back on its own)

     - <id> | boost:<1-3> | state: <on|pinned|off> | match: <…> | from: [[profile/goals]]
       <why this matters to the user>
-->

## Dimension guide

<!-- How the scorer reads each dimension. Rewrite a row to make it stricter or looser. -->

| Dimension | 0 | 3 |
|-----------|---|---|
| durability | true only today: mood, chatter, a one-off state | true for months: role, decisions, relationships |
| relevance | unrelated to the user's goals, focus, projects or people | directly about a current goal, active project or key person |
| actionability | nothing to do | a commitment, deadline, decision or action item |
| impact | would not change how an agent helps the user | changes future agent behavior: a preference, correction or standing rule |
| novelty | already in long-term memory, or recorded in code / git / files | a new fact, or a real change to a known one |
| explicitness | inferred by the agent | stated directly by the user, or the user asked to remember it |
| confidence | speculation, one weak source | confirmed, several sources |
