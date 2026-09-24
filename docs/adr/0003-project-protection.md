# ADR 0003 — Explicit Project Protection

**Status:** Accepted

## Context

The strongest product requirement is that chats belonging to Projects are never intentionally deleted.

Relying only on the current behavior of a standalone-conversation endpoint is fragile because the internal ChatGPT API is undocumented.

## Decision

Before destructive execution, enumerate conversation IDs belonging to every discovered ChatGPT Project.

Do not rely solely on the standalone endpoint to exclude Project chats.

Project chats do not appear as deletable rows. They may be displayed in a
separate read-only view that has no selection or deletion path.

Any incomplete Project enumeration blocks deletion.

## Alternatives considered

- Trust `/backend-api/conversations` to exclude Project chats.
- Detect Project membership only from optional fields on standalone records.
- Let the user override Project protection.

Rejected because they weaken the primary safety invariant.

## Consequences

Preflight requires additional read requests and may fail closed when Project enumeration cannot complete.
