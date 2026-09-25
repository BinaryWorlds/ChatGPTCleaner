# ChatGPTCleaner maintainability, architecture, React, and performance audit

## Audit result

The codebase is generally well protected and follows a sensible dependency
direction. The audit found no accidental real-network access in automated
tests, generic authenticated HTTP proxy, destructive work started from React
effects, or bypass of the `DeletionPlan` boundary.

The architecture should not be considered complete, however, until two
critical safety races and the inconsistent standalone-pagination contract are
fixed.

This was a read-only audit. No production integration or destructive operation
was run, and no `pnpm check` or build was executed as part of the audit.

## P0 — critical

### 1. Protect followed immediately by Resume can delete the newly protected conversation

Status: resolved in the working tree. Protection mutations now have a
synchronous in-flight guard, overlapping Protect/Unprotect commands are
disabled, and Resume remains disabled until persistence completes. Regression
coverage was added to `src/ui/ManagerPage.test.tsx`.

- Location: `src/ui/ManagerPage.tsx` around `persistProtection` and
  `resumeRun`; `src/application/protection.ts`.
- Concrete problem: protection persistence is asynchronous, but Resume can
  start before it finishes. Two rapid Protect/Unprotect operations can also
  derive state from the same stale snapshot and persist in the opposite order.
- Why it matters: the fresh Resume preflight can read the old protected-ID set,
  allowing a newly protected conversation to remain eligible.
- Recommended change: serialize protection mutations, expose an explicit
  `protectionMutationPending` state, and prevent Resume until the pending save
  has completed successfully.
- Expected benefit: user protection becomes an enforced invariant rather than
  a timing dependency between UI and storage.
- Regression risk: low. Failure handling must reliably clear the pending state
  without pretending that persistence succeeded.
- Behavior/tests: only race behavior changes. Add regression tests for rapid
  Protect/Unprotect and Protect followed immediately by Resume.

### 2. A DeletionPlan is not revalidated after acquiring the destructive lock

Status: resolved in the working tree. A new batch and Retry Failed now perform
fresh confirmed-subset revalidation inside the acquired lock before the first
DELETE. IDs removed by Resume revalidation are also discarded from any local
attempt captured before the pause.

- Location: `src/application/deletionRun.ts`, especially `runWithLock()`;
  deletion confirmation/start logic in `src/ui/ManagerPage.tsx`.
- Concrete problem: preflight and typed confirmation happen before lock
  acquisition. After `runWithLock()` succeeds, execution proceeds directly to
  the remaining conversations without another protection revalidation.
- Why it matters: another manager can protect a conversation between preflight
  and lock acquisition. The first manager can then execute a stale confirmed
  plan. Retry Failed has the same class of race.
- Recommended change: immediately after acquiring the lock and before the first
  DELETE, freshly revalidate the confirmed remaining subset. The result may
  only shrink the already-confirmed set.
- Expected benefit: the current protected-ID state and destructive execution
  share an authoritative atomic boundary.
- Regression risk: medium. Revalidation can be expensive, but it must not be
  replaced by stale cached safety state.
- Behavior/tests: normal behavior remains unchanged; only stale members are
  removed in the race case. Add a test that changes protection while a run is
  waiting for the lock.

## P1 — high

### 3. Application and production gateway use incompatible standalone-pagination contracts

Status: resolved in the working tree. Application now uses the gateway's next
cursor as the canonical progress/completion contract. It retains bounded
fixed-offset concurrency only while the backend confirms 100-record offsets and
falls back to sequential cursor following for a smaller effective limit.

- Location: `src/application/inventory.ts` and
  `src/infrastructure/api/ProductionConversationGateway.ts`.
- Concrete problem: the gateway supports a backend effective limit of 28 and
  can return `nextCursor = "28"`, while Application treats any page shorter
  than 100 as terminal and schedules fixed windows in increments of 100.
- Why it matters: the production gateway can pass its isolated tests while the
  complete Application integration stops after the first 28 conversations.
- Recommended change: define one canonical pagination-progress contract.
  Application should follow the gateway's next cursor/effective limit. Bounded
  fixed-offset concurrency should be used only after a fixed 100-item contract
  has actually been established.
- Expected benefit: complete inventory when the backend returns a smaller
  effective limit or a nonterminal short page.
- Regression risk: medium because the change touches the concurrent inventory
  scheduler.
- Behavior/tests: the limit-100 path should remain unchanged. Add integrated
  Application plus production-gateway tests for effective limit 28, changing
  totals, and short nonterminal pages.

### 4. `ManagerPage` owns too many independent responsibilities

Status: resolved in the working tree. Inventory loading and inventory-owned
state now live in `useManagerInventory`, while preflight, confirmation, and the
destructive-run lifecycle live in `useDeletionWorkflow`. The workflow exposes
explicit command callbacks and contains no React effect, so destructive work
still starts only from a user confirmation command.

- Location: `src/ui/ManagerPage.tsx`.
- Concrete problem: roughly 800 lines coordinate inventory loading, demo
  scenarios, filters, protection persistence, settings, preflight,
  confirmation, destructive-run lifecycle, derived state, and rendering.
- Why it matters: it is difficult to establish that a presentation change did
  not alter destructive orchestration.
- Recommended change: selectively extract `useManagerInventory` and
  `useDeletionWorkflow`. The destructive workflow hook must expose explicit
  command callbacks only and must never initiate destructive work from an
  effect.
- Expected benefit: smaller units with clearer UI/Application boundaries.
- Regression risk: medium. Keep mechanical movement separate from behavioral
  changes.
- Behavior/tests: behavior should remain unchanged. Preserve the existing
  user-event coverage while adding focused hook/application tests where useful.

### 5. The page-context read transport is a multi-responsibility monolith

Status: resolved in the working tree. Bridge contracts and result
normalization now live in `PageContextReadContracts`, the self-contained
injected operation and execution-world fallback live in
`PageContextReadExecutor`, and source-tab binding plus retry coordination live
in `SourceBoundPageContextReadTransport`. `PageContextReadTransport` remains a
small compatibility facade. The function serialized through `executeScript`
was moved intact and still has no dependency on imported runtime helpers.

- Location: `src/infrastructure/api/PageContextReadTransport.ts`.
- Concrete problem: roughly 1,200 lines contain bridge contracts, operation
  validation, injected code, execution-world selection, fallback, source-tab
  binding, retry behavior, and diagnostics.
- Why it matters: a request-contract change also touches serialization,
  authentication, validation, and logging behavior.
- Recommended change: split into three cohesive areas:
  1. bridge contracts and result normalization;
  2. the narrow injected operation plus world executor;
  3. source-bound transport and retry coordination.
- Expected benefit: smaller regression surfaces and more focused tests.
- Regression risk: medium. The function passed to `executeScript` must remain
  fully self-contained and must not close over imported helpers.
- Behavior/tests: no behavior change. Keep the exact JSON-serialization and
  injected-validator contract tests.

### 6. `ProductionConversationGateway` mixes parsing, pagination, aggregation, and telemetry

Status: resolved in the working tree. Runtime page schemas and display
normalization now live in `conversationPageParsing`, while offset/cursor
progress decisions live in the pure `paginationDecisions` module. The gateway
retains endpoint coordination, aggregation, diagnostics, and telemetry. Direct
tests cover changing totals, effective limits, terminal short pages, offset
mismatches, and repeated cursors.

- Location: `src/infrastructure/api/ProductionConversationGateway.ts`.
- Concrete problem: the gateway combines Zod parsing, display normalization,
  pagination correctness, Project aggregation, and performance telemetry.
- Why it matters: pagination decisions are hard to test independently from
  transport orchestration.
- Recommended change: extract pure page parsers and pure pagination-decision
  functions while leaving the gateway as the coordinator.
- Expected benefit: direct coverage of total/effective-limit/cursor/non-progress
  edge cases.
- Regression risk: low to medium.
- Behavior/tests: behavior should remain unchanged and existing endpoint
  contract tests should remain in place.

### 7. `requestsPerMinute` is not defended at the Application boundary

Status: resolved in the working tree. `DeletionRun` now applies the canonical
Application settings guard during construction and rejects non-integer or
out-of-range rates before any run state or timing calculation is created.
Regression tests cover zero, values above the maximum, fractional values, and
`NaN`; existing run tests cover valid rates.

- Location: `src/application/deletionRun.ts`.
- Concrete problem: the constructor accepts an arbitrary number and relies on
  UI or storage validation.
- Why it matters: another composition root or future caller can bypass the
  intended 1–120 invariant.
- Recommended change: create an Application factory/guard that constructs a
  run only from a valid rate.
- Expected benefit: the rate-limit invariant no longer depends on UI behavior.
- Regression risk: low.
- Behavior/tests: valid inputs remain unchanged. Add tests rejecting values
  outside the canonical range.

### 8. Source-tab validation has a type cycle and duplicate interfaces

Status: resolved in the working tree. `SourceTabValidator` is now defined once
beside `SourceTabBinding` and its validation result. Both source-bound READ and
DELETE transports depend on that minimal browser-layer contract; the gateway
no longer owns a validator type and the DELETE-specific duplicate was removed.

- Location: `src/infrastructure/api/PageContextReadTransport.ts`,
  `src/infrastructure/api/ProductionConversationGateway.ts`, and
  `src/infrastructure/api/PageContextDeleteTransport.ts`.
- Concrete problem: read transport and gateway reference each other's types,
  while DELETE defines a parallel `DeleteSourceTabValidator`.
- Why it matters: the ownership of a safety-critical validation contract is
  unclear even though the cycle is currently type-only.
- Recommended change: define one minimal canonical `SourceTabValidator` port
  next to the source-tab binding and reuse it in both read and delete paths.
- Expected benefit: one definition of the source-validation boundary.
- Regression risk: low.
- Behavior/tests: no behavior change.

## P2 — medium

### 9. Parallel error models complicate fail-closed behavior

Status: resolved in the working tree. Safety decisions now use one closed
`SafetyBlockReason` union across inventory, preflight, destructive-run state,
and UI. READ reasons remain a named subset of that union, while `AppError`
remains limited to side-effect boundary details. The UI label map is exhaustive
and tested for every reason. Three unused `AppErrorKind` variants
(`InvalidApiData`, `LockUnavailable`, and `SafetyBlocked`) were removed.

- Location: `src/application/AppError.ts`,
  `src/application/ports/ConversationGateway.ts`, and
  `src/ui/SafetyStatus.tsx`.
- Concrete problem: `AppError`, string-based `ReadFailureReason`, run-state
  reason strings, and a separate UI-message map describe overlapping failures.
  Several `AppErrorKind` values also appear unused.
- Why it matters: one failure can be classified differently in read, delete,
  and UI layers.
- Recommended change: use one typed `SafetyBlockReason` for safety decisions.
  Keep `AppError` only at side-effect boundaries or remove its unused variants
  and test-only helpers.
- Expected benefit: exhaustive handling and fewer translation layers.
- Regression risk: medium.
- Behavior/tests: user messages and safety decisions should remain unchanged;
  add exhaustive mapping tests.

### 10. `SafetyStatus` infers state that was not actually checked

Status: resolved in the working tree. `SafetyStatus` now accepts one
discriminated `SafetyStatusState`, eliminating invalid combinations of status,
reason, diagnostics, and compatibility flags. A ready inventory reports the
destructive lock as `NOT CHECKED`; it no longer claims availability before an
atomic acquisition attempt. Regression coverage verifies this label.

- Location: `src/ui/SafetyStatus.tsx`.
- Concrete problem: indicators are derived from boolean combinations and a
  string reason. In particular, the run lock can appear available before an
  authoritative atomic acquisition has occurred.
- Why it matters: the UI can communicate a stronger safety guarantee than the
  system has established.
- Recommended change: use an explicit discriminated safety state and show
  `NOT CHECKED` until lock acquisition is actually attempted.
- Expected benefit: accurate safety semantics.
- Regression risk: low.
- Behavior/tests: only the pre-acquisition label changes; update UI tests.

### 11. Exhausted server retries can be presented as a network failure

Status: resolved in the working tree. `server` is now a distinct typed READ
and safety-block reason. Exhausting retryable 5xx responses returns `server`,
while transport failures still return `network` and exhausted 429 responses
remain `retry-later`. A four-attempt 503 regression test covers the terminal
classification and deterministic backoff.

- Location: `src/infrastructure/api/readRetry.ts`.
- Concrete problem: an exhausted 5xx path can be reduced to the public reason
  `network` even though the backend returned real server responses.
- Why it matters: users receive misleading diagnostics and recovery advice.
- Recommended change: preserve the distinction between `network` and `server`
  through to the UI.
- Expected benefit: accurate diagnostics and logs.
- Regression risk: low.
- Behavior/tests: only terminal failure classification changes. Add an
  exhausted-5xx regression test.

### 12. Applying cumulative removed IDs has quadratic cost

Status: resolved in the working tree. The destructive run still retains the
complete removed-ID history for final results, while `useDeletionWorkflow`
tracks the applied prefix length and sends only each new suffix to inventory
and selection state. A progress-length reset starts a fresh sequence for Retry
Failed. Tests prove each cumulative ID is applied exactly once and cover the
retry reset.

- Location: progress snapshots in `src/application/deletionRun.ts` and
  `handleRunStateChange` in `src/ui/ManagerPage.tsx`.
- Concrete problem: each progress update copies all previously removed IDs;
  UI then rebuilds a set from the entire history and filters inventory again.
- Why it matters: large destructive batches trend toward O(n²) work and
  allocation.
- Recommended change: expose the latest outcome/delta, or track how many
  removed IDs have already been applied and process only the new suffix.
- Expected benefit: linear update cost while preserving complete final state.
- Regression risk: medium because the final-result representation must remain
  complete.
- Behavior/tests: visible behavior stays unchanged. Add a test proving each
  removed ID is applied once.

### 13. Requests-per-minute persistence can complete out of order

Status: resolved in the working tree. `SerializedRequestsPerMinuteWriter`
queues settings writes at the Application boundary, and `ManagerPage` keeps
one writer per dependency composition. A controlled-Promise regression test
proves that a second rapid change cannot begin persistence until the first has
settled, preserving command order in storage.

- Location: requests-per-minute handlers in `src/ui/ManagerPage.tsx`.
- Concrete problem: rapid changes can create overlapping asynchronous writes.
- Why it matters: reopening the manager can restore an older value even though
  the UI last displayed a newer one.
- Recommended change: serialize writes or use a simple last-write-wins version
  counter.
- Expected benefit: stable settings persistence.
- Regression risk: low.
- Behavior/tests: normal interaction is unchanged. Add a test with reordered
  persistence promises.

### 14. Large test suites mix responsibilities and some fixtures use real time

Status: resolved in the working tree. The former mixed Application suite is
split into inventory/preflight, deletion-run, and settings suites; production
API retry policy is separated from transport/validation coverage; and Manager
UI inventory controls are separated from destructive flows. Manager fixtures
now use one fixed epoch and `FakeClock` instead of `Date.now()`.

- Location: `src/application/application.test.ts`,
  `src/infrastructure/api/productionApi.test.ts`, and
  `src/ui/ManagerPage.test.tsx`.
- Concrete problem: several suites cover multiple independent workflows, and
  ManagerPage fixtures use `Date.now()`.
- Why it matters: regression localization is weaker and time-sensitive tests
  depend on the machine clock.
- Recommended change: split tests by workflow and use a fixed epoch/FakeClock
  in all time-dependent fixtures.
- Expected benefit: deterministic tests and easier failure diagnosis.
- Regression risk: low.
- Behavior/tests: test-only reorganization; production behavior is unchanged.

### 15. `ConversationTable` accepts impossible prop combinations

Status: resolved in the working tree. `ConversationTableProps` is now a
discriminated union. Standalone mode requires selection and protection state
plus commands, while Project mode forbids those props at compile time and only
accepts read-only table commands. `ManagerPage` renders the two configurations
through explicitly narrowed branches.

- Location: `src/ui/ConversationTable.tsx`.
- Concrete problem: Project mode still receives selection/protection props even
  though those operations are intentionally unavailable.
- Why it matters: the type system does not express the UI safety invariant.
- Recommended change: use discriminated props for standalone and Project modes.
- Expected benefit: impossible unsafe configurations become compile-time
  errors.
- Regression risk: low.
- Behavior/tests: no behavior change.

### 16. Rendering every failed conversation ID does not scale

Status: resolved in the working tree. The progress panel renders the complete
failed count and a bounded preview of at most 20 IDs, followed by the number of
additional failures. The complete ID list remains unchanged in run state for
Retry Failed. A 25-item regression test verifies the render bound.

- Location: `src/ui/DeletionProgressPanel.tsx`.
- Concrete problem: a large failed batch produces one potentially huge rendered
  list/string.
- Why it matters: it can create a heavy DOM and a difficult-to-use result panel.
- Recommended change: show the count and a bounded, collapsible, or paginated
  list without adding IDs to logs.
- Expected benefit: stable UI for large runs.
- Regression risk: low.
- Behavior/tests: presentation changes, while complete run data remains
  available in state.

## P3 — low

### 17. Dead successful-read delay configuration

Status: resolved in the working tree. The zero-valued configuration constant
and its value assertion were removed. The integration test continues to assert
the behavior directly: successful pagination performs no clock sleeps.

- Location: `src/infrastructure/api/readLimits.ts` and its assertion in
  `src/infrastructure/api/productionApi.test.ts`.
- Concrete problem: `SUCCESSFUL_READ_PAGE_DELAY_MS = 0` exists primarily so a
  test can assert that the value is zero.
- Recommended change: remove the constant and assert only that `sleep` was not
  called between successful pages.
- Expected benefit: less accidental configuration surface.
- Regression risk: very low.
- Behavior/tests: behavior unchanged; test simplified.

### 18. Mojibake in the preflight status text

Status: resolved in the working tree. The corrupted ellipsis was replaced by
portable ASCII punctuation, and a repository search found no other matching
mojibake in UI or product documentation.

- Location: `src/ui/ManagerPage.tsx` near the fresh-preflight status.
- Concrete problem: the source contains `preflightâ€¦`.
- Recommended change: replace it with a correctly encoded ellipsis or ordinary
  three dots.
- Expected benefit: correct UI text.
- Regression risk: none.
- Behavior/tests: presentation-only change.

### 19. Documentation still presents the one-item production DELETE smoke test as pending

Status: resolved in the working tree. README and the Phase 6 implementation
status now record the successful single-item lifecycle using counts and outcome
only, without any conversation identifier, title, or other private data.

- Location: `README.md` and `docs/PROJECT_SPEC.md`.
- Concrete problem: the documented implementation status is older than the
  confirmed successful one-conversation smoke test.
- Recommended change: record the verified lifecycle without including any
  private conversation data.
- Expected benefit: documentation matches the actual project state.
- Regression risk: none.
- Behavior/tests: no behavior change.

### 20. The current table page can become out of range after records are removed

Status: resolved in the working tree. Both standalone and Project table pages
are clamped against the current visible record count before slicing or passing
pagination state to Ant Table. The pure clamp handles shrinking, empty, and
invalid-low page inputs and has direct regression coverage.

- Location: pagination state in `src/ui/ManagerPage.tsx` and
  `src/ui/ConversationTable.tsx`.
- Concrete problem: after inventory shrinks, the current page number can point
  past the final page and make the table appear empty.
- Recommended change: clamp the page when the number of matching records
  changes.
- Expected benefit: no misleading empty page after deletion/filter changes.
- Regression risk: low.
- Behavior/tests: changes only out-of-range pagination behavior.

## Areas that should remain unchanged

- `DeletionRun` is large but represents one cohesive state machine. Do not split
  it into several speculative service or manager classes.
- Do not add Redux, Zustand, TanStack Query, a generic DI framework, or a generic
  authenticated HTTP client.
- Do not introduce a folder for every small component.
- Do not add `useCallback` or `memo` indiscriminately.
- Do not optimize fresh destructive preflight by reusing stale cached safety
  data.
- Current dependencies are justified. No dependency should be added or removed
  solely for the refactor.
- Duplication inside a function serialized through `executeScript` can be
  intentional. Do not extract helpers that depend on imported or closed-over
  scope.

## Recommended component convention

A folder-per-component convention across the entire UI would hurt navigation.
Use it selectively for the large manager feature:

```text
ui/ManagerPage/
  ManagerPage.tsx
  useManagerInventory.ts
  useDeletionWorkflow.ts
  index.ts
```

`SafetyStatus` may receive the same treatment only if its state derivation is
extracted. Small components should remain in the flat UI directory.

## Configuration assessment

Do not create one global `config.ts`.

Prefer:

- `application/policy.ts` for inventory ceilings/concurrency, destructive retry
  and backoff, requests-per-minute limits/default, and maximum Retry-After;
- endpoint paths and endpoint-specific page limits beside their transports;
- table page sizes in the UI layer;
- a neutral `MAX_RETRY_AFTER_MS` name instead of a read-specific constant reused
  by DELETE;
- an intentionally repeated injected-function ID limit only where the
  serialization boundary requires it, with a test that keeps it aligned with
  the normal contract.

## Performance priorities

| Area                                           | Classification                     | Recommendation                                                                                      |
| ---------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| Standalone crawl and `executeScript` crossings | **MEASURED**                       | This is the main startup cost. Keep bounded concurrency and require timings before further changes. |
| Sequential Project enumeration                 | **LIKELY / partly MEASURED**       | Optimize only after verifying endpoint behavior; do not introduce uncontrolled `Promise.all`.       |
| Copying cumulative removed IDs                 | **LIKELY**                         | Fix before large destructive batches.                                                               |
| Ant Table with roughly 1,600 records           | **LIKELY, moderate**               | Existing memoized filtering is reasonable; profile before virtualizing.                             |
| Fresh destructive preflight                    | **MEASURED, NOT WORTH OPTIMIZING** | The cost is part of the safety boundary.                                                            |
| Browser-storage reads/writes                   | **UNLIKELY**                       | Do not optimize for speed; serialize where required for correctness.                                |
| React callback recreation                      | **UNLIKELY**                       | Do not add blanket `useCallback`.                                                                   |
| Bundle size                                    | **NOT WORTH OPTIMIZING**           | It is a local extension; act only if startup profiling shows a real problem.                        |

## Safety classification

### Essential safety logic

- Complete Project enumeration and protection.
- Fresh destructive preflight.
- Validated `DeletionPlan` as the only DELETE input.
- User-protected-ID validation.
- Bound source-tab validation.
- Destructive run lock.
- Monotonic confirmed-ID subset.
- Fresh Resume/Retry revalidation.
- Runtime validation of all external values.
- Complete, fail-closed pagination.
- Destructive response classification.
- Manager-owned executor lifetime.

### Defense in depth

- Project overlap removal during inventory and again during plan creation.
- Source validation before orchestration, before each DELETE, and inside the
  injected origin boundary.
- Conversation-ID validation in Domain/transport/injected code.
- Duplicate, repeated-page, non-progress, and safety-ceiling checks.
- Strict page bridge envelopes.

### Redundant or simplifiable areas

- Parallel error taxonomies and repeated source-tab validator interfaces.
- Initial source-tab parsing used only for UX when the authoritative validator
  remains elsewhere.

No meaningful safety mechanism was identified as purely unrealistic. Malformed
page-world values are a realistic concern when integrating an undocumented API.

Simpler invariants can replace:

- overlapping protection writes;
- stale preflight execution after later lock acquisition;
- duplicated pagination-completion decisions;
- stringly typed safety-state derivation.

## Top five simplifications that delete code

1. Delete `SUCCESSFUL_READ_PAGE_DELAY_MS` and the test that asserts its literal
   zero value.
2. Delete unused `AppError` variants and helpers that are maintained only by
   their own tests.
3. Delete the duplicate DELETE source-tab validator and the read/gateway type
   cycle by using one canonical port.
4. Delete obsolete temporary Project diagnostic fields/stages that no longer
   contribute to privacy-safe operational logs.
5. Delete destructive start/confirmation coordination from `ManagerPage` by
   moving it behind one explicit Application command.

## Proposed independent refactor phases

Each commit should end with a separate successful `pnpm check`.

### Phase 1 — close protection races

Suggested commit:

```text
fix: close protection races before destructive execution
```

- Serialize protection mutations.
- Prevent Resume during a protection write.
- Revalidate the remaining confirmed subset after acquiring the destructive
  lock.
- Add race regressions.

### Phase 2 — unify standalone pagination

Suggested commit:

```text
fix: unify standalone pagination progress contract
```

- Establish one cursor/effective-limit contract.
- Add integrated production-gateway/Application tests for 28- and 100-item
  limits and changing totals.

### Phase 3 — make tests deterministic and focused

Suggested commit:

```text
test: split suites and use deterministic clocks
```

- Split inventory/preflight from deletion-run tests.
- Split parsing/pagination from executor/retry transport tests.
- Split ManagerPage inventory/selection from destructive UI flows.
- Replace `Date.now()` fixtures with a fixed clock.

### Phase 4 — separate manager workflows from presentation

Suggested commit:

```text
refactor: separate manager workflows from presentation
```

- Mechanically extract the inventory and deletion workflow hooks.
- Keep destructive work behind explicit event-handler commands.
- Do not combine file movement with behavior changes.

### Phase 5 — split production read infrastructure

Suggested commit:

```text
refactor: separate page transport contracts and execution
```

- Separate bridge contracts, injected executor, source binding, and pure
  response/pagination parsing.
- Remove obsolete debug-contract residue only after contract tests pass.

### Phase 6 — consolidate policy and failure types

Suggested commit:

```text
refactor: consolidate application policy and failure types
```

- Add a small Application policy module.
- Establish one typed safety-block reason.
- Remove dead error/configuration code.

### Phase 7 — presentation and status documentation

Suggested commits:

```text
fix(ui): correct preflight status text
docs: record verified production delete smoke test
```

Keep the code-text correction separate from the documentation update.

## Rules worth adding to `AGENTS.md`

```text
- Protection mutations must be serialized. Resume must not begin while a
  protection write is pending.

- After acquiring the destructive run lock, freshly revalidate the confirmed
  remaining set before the first DELETE. Revalidation may only shrink it.

- Standalone pagination must use one canonical progress contract. Application
  must not infer completion from a hard-coded page size when the gateway
  reports a different effective limit or cursor.

- Do not report a destructive lock as available unless it was actually observed
  or acquired. Atomic acquisition remains authoritative.

- Functions passed to chrome.scripting.executeScript must be self-contained.
  Test caller arguments against the exact injected argument validator.

- Time-dependent tests must use a fixed clock. Do not use Date.now() in fixtures.
```

## ADR assessment

- Update ADR 0006 to require revalidation after destructive-lock acquisition
  and to describe coordination with protection writes.
- Update ADR 0007 to clarify that post-lock Resume/Retry revalidation may only
  shrink the confirmed set and does not broaden authorization.
- No new ADR is needed for component/test/configuration/module splitting.
- ADR 0004 does not need an update if only module structure changes and the
  production transport mechanism remains the same.
- Record the successful one-conversation production DELETE smoke test in the
  project specification and README, not in an ADR.

## Audit verification note

The audit statically identified 153 test declarations across 16 test files.
Tests were not executed because this task was restricted to inspection and
static analysis. The repository was clean before this report file was added.
