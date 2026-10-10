# ADR 0009 — Bounded Parallel Deletion Scheduling

**Status:** Accepted

## Context

Sequential deletion leaves no other work in progress while one response is
slow. Increasing throughput must preserve explicit confirmation, Project/user
protection, a single destructive owner, retry limits, and predictable stopping.
ChatGPT's private API provides no documented safe concurrency guarantee.

## Decision

Use one manager-owned Application scheduler for bounded overlapping gateway
operations. Concurrency caps active operations; it does not create fixed batches.
Fill available slots only when the shared start limiter, item readiness, and
current run state allow it.

Initial attempts and retries share one paced gateway-start limiter. Per-item
backoff leaves unrelated eligible work available; HTTP 429 creates a global
cooldown. Retry Failed preserves active pacing/cooldown deadlines even when its
visible result/time counters reset. Gateway invocation includes source/session
preparation and does not guarantee server-observed fetch spacing.

Reserve an attempt synchronously, allow only one active attempt per ID, and
correlate completion before applying outcomes exactly once. Completion may be
out of order; failed-ID presentation retains confirmed-plan order.

Pause, Stop, and Fatal prevent new starts and drain already-started operations.
Keep the destructive lock until active work settles; Pause retains it for
Resume. Stop cannot resume its unprocessed queue. Manager teardown retains the
separate lifecycle limitation from [ADR 0005](0005-manager-owned-executor.md).

The [single-owner lock](0006-single-destructive-run.md),
[confirmed subset](0007-confirmed-deletion-set.md), and
[snapshot safety boundary](0008-inventory-snapshot-deletion-safety.md) remain
unchanged. The [specification](../PROJECT_SPEC.md#30-deletion-scheduling) owns
numeric settings, response classification, and lifecycle details.

## Alternatives considered

- Sequential execution: simpler, but one slow response prevents overlapping work.
- Fixed batches: wait unnecessarily for the slowest operation before refilling.
- Unbounded parallel requests: cannot enforce concurrency, pacing, or predictable drain.

## Consequences

The scheduler requires deterministic tests for out-of-order completion,
correlation, retry deadlines, and multiple active operations during lifecycle
transitions. Higher concurrency can increase API pressure and is neither a
recommended server limit nor a throughput promise. Private transport behavior
still requires controlled runtime verification. No queue, run state, or
confirmation is persisted.
