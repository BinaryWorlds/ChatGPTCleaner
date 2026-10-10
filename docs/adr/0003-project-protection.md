# ADR 0003 — Explicit Project Protection

**Status:** Accepted

## Context

The strongest product requirement is that chats belonging to Projects are never intentionally deleted.

Relying only on the current behavior of a standalone-conversation endpoint is fragile because the internal ChatGPT API is undocumented.

## Decision

Before accepting an initial-load or Refresh snapshot, enumerate conversation
IDs belonging to every discovered ChatGPT Project.

Do not rely solely on the standalone endpoint to exclude Project chats.

Project chats do not appear as deletable rows. They may be displayed in a
separate read-only view that has no selection or deletion path.

Any incomplete Project enumeration blocks accepting the replacement snapshot.

## Alternatives considered

- Trust `/backend-api/conversations` to exclude Project chats.
- Detect Project membership only from optional fields on standalone records.
- Let the user override Project protection.

Rejected because they weaken the primary safety invariant.

## Consequences

Snapshot loading requires additional reads. An incomplete candidate is never
accepted; the previous snapshot's availability follows
[Refresh failure classification](../PROJECT_SPEC.md#28-inventory-flow).
Protection reflects accepted membership, not an atomic server-side check at
DELETE time; [ADR 0008](0008-inventory-snapshot-deletion-safety.md) defines this
freshness boundary.
