# ADR 0006 — Single Destructive Run

**Status:** Accepted

## Context

Two manager pages deleting concurrently can create ambiguous progress, duplicate work, protection races, and unnecessary rate-limit pressure.

## Decision

At most one destructive execution may run across extension manager contexts.

Prefer the Web Locks API with a stable extension-origin lock.

Acquire the lock atomically after typed confirmation and immediately before destructive execution.

Hold the lock while running and paused. Release it on completion, Stop, fatal termination, or manager-context teardown.

Do not persist a manual lock flag in storage.

Other manager contexts may browse but must not mutate protection state while the destructive lock is held.

## Alternatives considered

- Ignore concurrent managers.
- Persist a boolean lock in browser storage.
- Let each manager run independently.

Rejected because browser-managed locking has simpler crash/release semantics.

## Consequences

A second manager cannot begin destructive work until the active run ends.
