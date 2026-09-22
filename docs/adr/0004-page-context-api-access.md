# ADR 0004 — Authenticated Page-Context API Access

**Status:** Accepted

## Context

ChatGPTCleaner needs to interact with undocumented ChatGPT web endpoints using the user's existing authenticated browser session without collecting or persisting credentials.

## Decision

Use the already-authenticated `chatgpt.com` browser context.

Prefer the least-privileged execution world that satisfies the observed request contract.

Expose only narrow fixed ChatGPT operations. Do not implement a generic authenticated `fetch(url)` proxy.

Never require users to paste tokens and never persist auth secrets.

The manager is bound to a single source tab and must fail closed if that source tab becomes unusable or leaves the exact ChatGPT origin. The MVP does not add a separate identity-context mechanism.

## Alternatives considered

- Ask the user to paste a bearer token.
- Read/persist cookies or tokens.
- Add broad host/cookie/webRequest permissions.
- Implement a generic authenticated request proxy.

Rejected because they increase credential exposure and extension privilege.

## Consequences

Production integration depends on undocumented ChatGPT web behavior and may need maintenance after upstream changes.
