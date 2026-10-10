# ADR 0005 — Manager Page Owns Destructive Execution

**Status:** Accepted

## Context

Deletion can take minutes and includes rate limiting, retries, progress, Pause/Resume/Stop, and user-visible state.

Manifest V3 service workers are ephemeral and should not be treated as a durable owner of a long-running destructive workflow.

## Decision

Long-running destructive execution lives in the manager extension page.

The background service worker remains minimal and does not own the deletion queue, timers, progress, or retry state.

Closing, reloading, or crashing the manager prevents new scheduler operations.
There is no background continuation or auto-resume.

An operation already started may finish remotely, including an operation still
performing source/session preparation before DELETE dispatch. Pause, Stop, and
Fatal similarly prevent new starts while active operations drain; they do not
undo remote effects. [The lifecycle contract](../PROJECT_SPEC.md#32-pause--resume--stop)
defines these transitions.

## Alternatives considered

- Run the queue in the MV3 service worker.
- Persist the queue and reconstruct it after worker/page restart.
- Build a resumable background-job system.

Rejected as less predictable and unnecessarily complex for the product scope.

## Consequences

Run orchestration exists only while the manager page exists. Browser-owned
locks release on context teardown, but previously started remote effects may
outlive it. The next manager starts fresh.
