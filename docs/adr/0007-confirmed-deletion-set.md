# ADR 0007 — Confirmed Deletion Set Is Monotonic

**Status:** Accepted

## Context

Pause/Resume and Retry Failed must remain inside the already-approved set
without asking the user to confirm again.

## Decision

Destructive-modal confirmation creates an in-memory maximum set of
`confirmedConversationIds`.

Starting, Resume, and Retry Failed may **remove** IDs from that set, but may
never add IDs. They do not reload standalone or Project inventory. Current
local protection is loaded inside the destructive lock before DELETE continues
so protection changes cannot expand the set.

Example:

```text
confirmed: A B C D
remaining subset: A C D
=> allowed

confirmed: A B C D
attempted subset: A B C D E
=> E rejected
```

Any user action that introduces new IDs starts a new destructive batch and
requires a new destructive-modal confirmation.

Confirmed IDs are never persisted.

## Alternatives considered

- Require confirmation after every Resume/Retry.
- Continue the original plan without subset enforcement.
- Allow refreshed inventory to add newly eligible IDs automatically.

The chosen model preserves explicit user approval while keeping Resume/Retry usable.

## Consequences

The confirmed set is monotonic: later operations can only reduce it.
