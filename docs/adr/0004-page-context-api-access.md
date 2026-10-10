# ADR 0004 — Authenticated Page-Context API Access

**Status:** Accepted

## Context

ChatGPTCleaner uses undocumented ChatGPT web endpoints through the user's
existing authenticated session. Collecting credentials or adding a broad
authenticated request bridge would increase privilege and exposure.

## Decision

Execute fixed operations in the exact source tab captured at launch. Never
silently rebind, request pasted tokens, or expose an arbitrary URL/method proxy.
Use `activeTab` and `scripting` without persistent ChatGPT host, cookie, or
webRequest permissions.

Read operations construct their own GET URLs, include browser credentials,
and obtain the required Bearer credential inside the injected operation from
`/api/auth/session`. ISOLATED-world token caching remains page-context memory
only, avoiding a session request for each pagination page. A backend 401/403
clears the cache and permits one refresh before failing closed. Credentials
never cross the execution boundary, enter storage, or appear in logs.

Standalone reads use ISOLATED. Project reads may make the documented one-time
MAIN comparison for their initial authentication/transport fallback condition.
Reuse the world that first succeeds for that operation within the inventory
load; later failure does not trigger per-page world probing. MAIN code is
minimal and stateless, rechecks the exact origin, constructs fixed URLs, and
returns only untrusted data for validation outside the page. It cannot accept
arbitrary URLs or HTTP methods.

DELETE uses a separate narrow ISOLATED operation with a validated conversation
ID, fixed origin/path/method/headers, and credentials confined to page memory.
It returns only classified, sanitized results and correlated operation signals.
There is no destructive MAIN fallback: another-world retry after an ambiguous
result could repeat a remotely completed operation. Retry classification belongs
to the bounded executor policy.

Source/session checks during DELETE do not refresh inventory or establish an
account/workspace identity. Endpoint observations, pagination, and fallback
contracts belong in [the specification](../PROJECT_SPEC.md#14-authenticated-chatgpt-transport),
not in duplicated ADR implementation tables.

## Alternatives considered

- Ask users to paste tokens or persist cookies/credentials.
- Add broad host, cookie, or webRequest permissions.
- Expose a generic authenticated request proxy.

These increase credential exposure and extension privilege.

## Consequences

Private web-API changes can require integration maintenance. Page-returned data
remains untrusted; malformed or incompatible required reads cannot establish a
safe inventory. Narrow injected functions must remain serializable and keep
authentication inside the page boundary. Read concurrency and destructive
scheduling are independent Application policies.
