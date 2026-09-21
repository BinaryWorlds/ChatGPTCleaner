# ADR 0005 — Manager Page Owns Destructive Execution

**Status:** Accepted

## Context

Deletion can take minutes and includes rate limiting, retries, progress, Pause/Resume/Stop, and user-visible state.

Manifest V3 service workers are ephemeral and should not be treated as a durable owner of a long-running destructive workflow.

## Decision

Long-running destructive execution lives in the manager extension page.

The background service worker remains minimal and does not own the deletion queue, timers, progress, or retry state.

Closing/reloading/crashing the manager prevents new destructive requests from starting. There is no background continuation or auto-resume.

An already-dispatched network request may still complete remotely.

## Alternatives considered

- Run the queue in the MV3 service worker.
- Persist the queue and reconstruct it after worker/page restart.
- Build a resumable background-job system.

Rejected as less predictable and unnecessarily complex for MVP.

## Consequences

The destructive run exists only while the manager page exists. This is intentional.
