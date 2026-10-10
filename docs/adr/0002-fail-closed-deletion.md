# ADR 0002 — Fail-Closed Deletion Model

**Status:** Accepted

## Context

Deletion is destructive. A false positive can permanently remove an important conversation; a false negative can be retried later.

## Decision

When the required source, inventory, and local-protection conditions are
not satisfied, destructive execution is blocked. This is a client safety
boundary, not an atomic guarantee about later server-side membership changes.

Examples:

```text
no complete accepted Project-protection snapshot or a blocking Refresh failure
required API contract invalid
source ChatGPT tab invalid
protected-ID storage invalid
```

Raw UI selection is never sent to DELETE.

Only the confirmed monotonic subset of a validated `DeletionPlan` may enter
destructive execution. UI eligibility alone is insufficient.

An incomplete Refresh candidate is never accepted. Failure classification
determines whether the previous accepted snapshot remains READY or deletion
becomes BLOCKED; see [the inventory contract](../PROJECT_SPEC.md#28-inventory-flow)
and [ADR 0008](0008-inventory-snapshot-deletion-safety.md). Destructive-lock
contention prevents execution but is an operation notice, not canonical BLOCKED.

## Alternatives considered

- Best-effort deletion with warnings.
- Silently skip malformed records and continue.
- Trust the UI table's current selection/eligibility.

All were rejected because they move safety decisions into weaker or stale layers.

## Consequences

Backend/API changes may temporarily disable deletion until the integration is updated. This is intentional.
