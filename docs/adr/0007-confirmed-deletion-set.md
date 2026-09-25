# ADR 0007 — Confirmed Deletion Set Is Monotonic

**Status:** Accepted

## Context

Pause/Resume and Retry Failed need fresh safety checks, but repeatedly asking the user to retype confirmation for the same already-approved IDs is unnecessary.

At the same time, revalidation must never introduce a conversation the user did not confirm.

## Decision

Typed confirmation creates an in-memory maximum set of `confirmedConversationIds`.

Resume and Retry Failed may revalidate and **remove** IDs from that set, but may never add IDs.

After acquiring the destructive run lock, a new batch or Retry Failed execution
revalidates the remaining confirmed IDs again before the first DELETE. This
post-lock check also may only remove IDs and does not require another typed
confirmation.

Example:

```text
confirmed: A B C D
revalidated: A C D
=> allowed

confirmed: A B C D
revalidated: A B C D E
=> E rejected
```

Any user action that introduces new IDs starts a new destructive batch and requires a new `DELETE N` confirmation.

Confirmed IDs are never persisted.

## Alternatives considered

- Require typed confirmation after every Resume/Retry.
- Continue the original plan without revalidation.
- Allow refreshed inventory to add newly eligible IDs automatically.

The chosen model preserves explicit user approval while keeping Resume/Retry usable.

## Consequences

Revalidation is monotonic: safety checks can only reduce the destructive set,
including the check performed after lock acquisition.
