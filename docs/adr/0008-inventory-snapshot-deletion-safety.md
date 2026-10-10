# ADR 0008 — Inventory Snapshot Deletion Safety

**Status:** Accepted

## Context

The earlier workflow revalidated complete Project and standalone inventory
between typed confirmation and the first DELETE, making start depend on a second
full crawl. ChatGPT does not expose an atomic “delete only if still outside all
Projects” operation, so that crawl could reduce but could not eliminate the
underlying race.

## Decision

The manager's last successfully completed initial load or explicit Refresh is
the authoritative ChatGPT inventory snapshot. A snapshot is accepted only after
complete standalone pagination, Project discovery, and every Project's complete
conversation pagination validate successfully. Project membership takes
precedence over standalone membership.

Deletion preview and confirmation use eligible IDs from that snapshot plus the
current local protected-ID state. After confirmation, starting the destructive
run acquires the existing Web Lock, freshly loads local protected IDs, and
shrinks the confirmed subset before execution. Resume and Retry Failed apply
the same local-protection guarantee. None of these entry points reloads
standalone or Project inventory or can add IDs.

Refresh builds a replacement off to the side. Success atomically replaces the
snapshot and clears selection and any stale preview. Failure preserves the last
valid snapshot for display. Exhausted transient network/429/server failures
preserve READY when an accepted snapshot exists; source/authentication,
contract, pagination/ceiling, or protected-storage failures block deletion.
Retained display data is not authority to bypass those blockers. The canonical
classification is in [the inventory contract](../PROJECT_SPEC.md#28-inventory-flow). Successful DELETE outcomes remove conversations from the local
snapshot without triggering an automatic Refresh.

The narrow DELETE transport continues to validate its bound source tab and may
perform authentication/session requests. Those transport checks are not
inventory freshness checks.

## Consequences

Project exclusion is guaranteed according to the last successfully loaded
snapshot, not according to a fresh check immediately before DELETE. Users must
use Refresh when ChatGPT inventory may have changed externally. The extension
does not claim atomic protection against a conversation moving into a Project
after the snapshot was loaded.

The full-standalone-revalidation preference and destructive inventory
revalidation pipeline are removed.
