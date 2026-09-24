# ADR 0004 — Authenticated Page-Context API Access

**Status:** Accepted

## Context

ChatGPTCleaner needs to interact with undocumented ChatGPT web endpoints using the user's existing authenticated browser session without collecting or persisting credentials.

## Decision

Use the already-authenticated `chatgpt.com` browser context.

Fixed `/backend-api/*` GETs execute in the already-authenticated source-tab
context with `credentials: "include"` and `Accept: application/json`. The
current backend contract requires a Bearer credential. The injected operation
obtains it from `/api/auth/session`. In the private ISOLATED world, the token is
cached only in page-context memory so standalone pagination does not repeat the
session request per page. A backend 401 or 403 clears that cache and permits one
refresh. The token never crosses the page-execution boundary and is never logged
or persisted. The extension does not infer an account/workspace identity. A
valid backend 2xx succeeds, while a repeated 401, 403, or redirect fails closed.

Standalone reads use the least-privileged `ISOLATED` world. For each narrow
operation, a world that completes a valid 2xx read is reused for the rest of the
high-level inventory operation. A later failure stops fail-closed instead of
reprobing worlds on every page. Project operations may compare `MAIN` once when
their first ISOLATED attempt produces the documented authentication/transport
fallback condition.

MAIN is necessary because it shares the host page's JavaScript execution
environment, while ISOLATED has an extension-private JavaScript environment.
The MAIN-world read function is minimal and stateless, verifies the exact page
origin, constructs its URL internally, and supports only the three Phase 5 GET
operations. It cannot accept a URL or HTTP method from callers.

Phase 6 adds a separate destructive operation in ISOLATED world. It accepts
only a validated conversation ID and internally fixes the origin, path shape,
method, credentials mode, and headers for one conversation DELETE. Its bearer
credential is obtained and retained only inside page-context memory, as with
the read transport. It returns no credential, URL, headers, body, or raw error.

The destructive operation does not fall back from ISOLATED to MAIN. Retrying a
destructive request in another execution world after an ambiguous transport
result could duplicate an already-dispatched DELETE. Any such ambiguity is
therefore classified conservatively by the existing bounded executor policy.

Expose only narrow fixed ChatGPT operations. Do not implement a generic authenticated `fetch(url)` proxy.

Because requests execute in the user-invoked source tab under `activeTab` and
`scripting`, no persistent ChatGPT host permission, cookie permission, or
webRequest permission is added.

Never require users to paste tokens and never persist auth secrets.

The manager validates and binds its single source tab once at the start of each
initial inventory, preflight, Resume, or Retry Failed operation. Pagination
reuses that exact tab ID without silently rebinding; an actual request failure
stops the operation fail-closed. The MVP does not add a separate
identity-context mechanism.

## Alternatives considered

- Ask the user to paste a bearer token.
- Read/persist cookies or tokens.
- Add broad host/cookie/webRequest permissions.
- Implement a generic authenticated request proxy.

Rejected because they increase credential exposure and extension privilege.

## Consequences

Production integration depends on undocumented ChatGPT web behavior and may need maintenance after upstream changes.

Page-world return values remain untrusted and are validated outside MAIN before
they reach Application. Redirects, non-JSON success responses, and JSON parse
failures block inventory loading.

Standalone inventory may keep at most three fixed-offset GETs in flight. The
Application scheduler commits validated results by ascending offset and waits
for the bounded window before scheduling another, which makes retry throttling
conservative. Project reads remain sequential. This concurrency changes only
read throughput and does not affect destructive execution or its rate limiter.
