# Memory Changelog

<!-- Append-only log of every change to long-term and core memory. Used for audit and undo.
     Format:
     - <timestamp> | #<change-id> | by: <consolidator|user|onboarding> | op: <add|update|merge|supersede|archive|delete> | target: <domain/slug> | src: <session:id|run:id|user>
       <one-line summary of the change>
-->

- {{created_at}} | #0001 | by: miniclaw | op: add | target: * | src: template {{template_version}}
  Memory instantiated from template.
