# ADR 0002 — Fail-Closed Deletion Model

**Status:** Accepted

## Context

Deletion is destructive. A false positive can permanently remove an important conversation; a false negative can be retried later.

## Decision

When deletion safety cannot be proven, deletion is blocked.

Examples:

```text
Project protection incomplete
required API contract invalid
source ChatGPT tab invalid
session/workspace context changed
protected-ID storage invalid
another destructive run active
```

Raw UI selection is never sent to DELETE.

Only a validated `DeletionPlan` may enter destructive execution.

## Alternatives considered

- Best-effort deletion with warnings.
- Silently skip malformed records and continue.
- Trust the UI table's current selection/eligibility.

All were rejected because they move safety decisions into weaker or stale layers.

## Consequences

Backend/API changes may temporarily disable deletion until the integration is updated. This is intentional.
