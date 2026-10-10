# ADR 0006 — Single Destructive Run

**Status:** Accepted

## Context

Two manager pages deleting concurrently can create ambiguous progress, duplicate work, protection races, and unnecessary rate-limit pressure.

## Decision

At most one destructive execution may run across extension manager contexts.

Use the Web Locks API with a stable extension-origin lock.

Acquire the lock atomically after destructive-modal confirmation and immediately before
destructive execution. Inside the lock, freshly load local protected IDs and
shrink the confirmed remaining set before issuing DELETE. Starting the run
performs no standalone or Project inventory reads; Project eligibility comes
from the last successful inventory snapshot.

Hold the lock while running, pausing, paused, and draining Stop/Fatal work.
Completion, Stop, or Fatal releases it only after every active gateway operation
settles. A fatal state can be published before drain completes. Browser context
teardown releases the lock separately, without undoing remote effects.

Lock contention is an operation notice and starts no DELETE. It does not turn
otherwise READY availability into BLOCKED; a later eligible command may retry
acquisition.

Do not persist a manual lock flag in storage.

Other manager contexts may browse but must not mutate protection state while the destructive lock is held.

## Alternatives considered

- Ignore concurrent managers.
- Persist a boolean lock in browser storage.
- Let each manager run independently.

Rejected because browser-managed locking has simpler crash/release semantics.

## Consequences

A second manager cannot begin destructive work until the active run ends.
The lock excludes overlapping destructive executors and coordinates protection
writes, but does not provide fresh ChatGPT inventory membership. Its lifetime
must cover all active operations, not just the first fatal result. See
[ADR 0009](0009-bounded-parallel-deletion.md) for concurrent drain behavior.
