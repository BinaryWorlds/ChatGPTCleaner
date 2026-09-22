# AGENTS.md — ChatGPTCleaner Engineering Rules

These rules apply to coding agents and contributors.

## Product boundary

- This is a Google Chrome Manifest V3 extension, not a hosted web app.
- Node.js 24 and pnpm only.
- Chrome/Chromium only for MVP.
- Do not add product features outside `docs/PROJECT_SPEC.md`.

## Architecture

Keep dependency direction:

```text
UI -> Application -> Domain
Infrastructure -> Application ports
```

### Domain

- Pure business logic.
- No React, Ant, WXT, Chrome APIs, fetch, storage, timers, locks, or endpoint code.

### Application

- Shallow orchestrators.
- Coordinates semantically named steps.
- Does not duplicate business rules.

### Infrastructure

- Owns network, browser APIs, storage, locks, timers, and page-context execution.

### UI

- Displays state and dispatches user intent.
- Never decides deletion eligibility.

## Safety

- Project chats must never intentionally be deletable.
- User-protected chats must never be deletable.
- Raw UI selection never reaches DELETE.
- Only a validated `DeletionPlan` reaches destructive execution.
- A new destructive batch requires fresh preflight + typed `DELETE N`.
- Resume/Retry may only shrink the already-confirmed ID set.
- Incomplete Project protection blocks deletion.
- API incompatibility blocks deletion.
- Source-tab instability blocks or stops deletion.
- Only one destructive executor may run.
- Executor lives in manager page, never MV3 service worker.
- Manager close/reload/crash means no new DELETE attempts, no background continuation, no auto-resume.
- Already-dispatched network requests may still complete; do not promise cancellation of remote effects.
- Tests/demo never access real `chatgpt.com`.
- Tests/demo never issue a real DELETE.
- No destructive queue or confirmed-plan persistence.

## React safety

Never initiate destructive work from:

```text
render
useEffect
useLayoutEffect
component mount/unmount
state synchronization side effects
```

A destructive run starts only from an explicit user command that invokes an Application orchestrator.

Harmless read/inventory effects are allowed when appropriate.

## Clean code

Apply:

```text
SRP
YAGNI
pragmatic DRY
pure core / side effects at edges
composition over inheritance
explicit data flow
semantic names
guard clauses
early returns
flat control flow
small single-purpose functions
```

Remove duplicated knowledge, not merely duplicated syntax.

Prefer a little obvious duplication over premature abstraction.

Avoid deeply nested `if/for/try` structures.

Normal application code should rarely exceed two levels of control-flow nesting.

Avoid `else` after a branch that already returns or throws.

## Naming

Prefer semantic names:

```text
buildDeletionPlan
fetchAllProjectConversationIds
sanitizeSelection
validateSourceTab
validateSessionContext
acquireDestructiveRunLock
selectedConversationIds
confirmedConversationIds
requestsPerMinute
```

Avoid vague names such as:

```text
data
stuff
helper
manager
processData
doWork
```

when a better semantic name exists.

## TypeScript

- Strict TypeScript.
- Avoid `any`.
- External data begins as `unknown` and is validated.
- Prefer readonly domain data where practical.
- Prefer discriminated unions over combinations of boolean state.
- Use exhaustive handling for discriminated unions where practical.
- Do not use string matching on arbitrary `Error.message` values for business logic.
- Do not bypass API/storage validation with `as SomeExternalType`.
- Avoid non-null assertions in safety-critical code unless the invariant is locally proven and obvious.

## Async hygiene

- Do not swallow errors with empty `catch` blocks.
- Do not use fire-and-forget Promises in destructive paths.
- Every destructive async operation must be awaited/handled.
- Do not use `Array.forEach(async ...)`.
- Cancellation/AbortSignal handling must not convert a stopped/paused local wait into an accidental next request.
- Avoid hidden background tasks.

## Security coding

Never introduce:

```text
eval
new Function
dangerouslySetInnerHTML
string-based timers
remote executable runtime code
generic authenticated fetch(url) proxy
```

Never log:

```text
tokens
cookies
Authorization headers
conversation contents
full request headers
```

Validate exact `https://chatgpt.com` origin.

Encode conversation IDs as one URL path segment.

Treat browser storage and page-context data as untrusted external input.

## Dependencies

Do not add without a clear requirement:

```text
Redux
Zustand
Axios
TanStack Query
Tailwind
shadcn
IndexedDB wrappers
generic DI frameworks
```

Do not create speculative:

```text
BaseRepository
AbstractManager
StrategyFactory
GenericWorkflowEngine
```

## Testing

- Safety invariants matter more than coverage percentage.
- Automated tests must fail on real network access.
- Use fake gateway, fake timers, and mocked browser APIs.
- No real ChatGPT account in tests.
- No real DELETE in tests.
- Every safety bug fix adds a regression test.
- Time/date tests must not depend on the machine's current timezone/clock implicitly.

## Documentation

`docs/PROJECT_SPEC.md` is the source of truth for product behavior.

Update it when behavior or scope changes.

Create/update an ADR when a major architectural decision changes.

Do not duplicate large specification sections across docs.

## Completion

Before declaring work complete, run:

```bash
pnpm check
```

Do not report completion unless:

```text
format check passes
lint passes
typecheck passes
tests pass
build passes
manifest/security checks pass
```
