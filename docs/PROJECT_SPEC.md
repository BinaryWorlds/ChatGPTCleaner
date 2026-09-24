# ChatGPTCleaner — MVP Product & Engineering Specification

**Status:** Source of truth  
**Product:** Google Chrome Manifest V3 extension  
**Primary browser:** Google Chrome  
**Minimum Chrome version:** 120  
**Runtime:** Node.js 24  
**Package manager:** pnpm

---

## 1. Purpose

ChatGPTCleaner is a small, privacy-focused Chrome extension for safely reviewing, filtering, protecting, selecting, and bulk-deleting **standalone ChatGPT conversations**.

It operates against the user's already-authenticated `https://chatgpt.com` browser session.

Its single responsibility is:

> Safely bulk-delete user-selected standalone conversations while never intentionally deleting Projects, conversations belonging to Projects, or conversations explicitly protected by the user.

The product must stay small, auditable, fail-closed, and easy to reason about.

---

## 2. Product boundary

This is a **Chrome Manifest V3 extension**, not a hosted web application.

Production runtime:

```text
Google Chrome
    |
    +-- authenticated chatgpt.com source tab
    |
    +-- ChatGPTCleaner extension
          |
          +-- extension action
          +-- minimal background service worker
          +-- manager extension page/tab
          +-- narrow authenticated transport to chatgpt.com
```

The extension must be installable through:

```text
chrome://extensions
-> Developer mode
-> Load unpacked
```

`pnpm build` must produce a valid Chromium extension build.

Chrome Web Store publishing is outside MVP.

Demo mode reuses the same manager UI with fake infrastructure.

---

## 3. Product principles

### 3.1 Safety before convenience

Deletion is destructive.

A false negative is acceptable:

> A conversation that could have been deleted remains untouched.

A false positive is unacceptable:

> A conversation that should have been protected is deleted.

Therefore:

```text
uncertain => do not delete
incomplete protection => block deletion
incompatible API => block deletion
```

### 3.2 Explicit user control

No automatic, scheduled, or background cleanup.

A new destructive batch always requires:

```text
explicit selection
-> fresh preflight
-> typed confirmation
-> sequential execution
```

### 3.3 Privacy by design

No telemetry, analytics, crash-reporting SaaS, external backend, remote logging, runtime CDN, remote JavaScript, or dynamically loaded executable code.

All runtime code and required assets are bundled locally.

Do not persist:

```text
conversation contents
conversation inventory
Project inventory
deletion queue
confirmed deletion plan
tokens
cookies
authorization headers
request headers
```

### 3.4 Minimal scope

Prefer clarity, testability, explicit data flow, small functions, and few dependencies.

Do not turn this into a general ChatGPT organizer.

---

## 4. Non-goals

Do not implement:

- Firefox or Safari support;
- Edge-specific behavior;
- Chrome Web Store publishing automation;
- Project deletion or Project management;
- moving conversations into/out of Projects;
- archive/unarchive;
- full-text content search;
- custom conversation renderer;
- content export/import/backup;
- IndexedDB;
- inventory caching;
- offline reader;
- tags/folders;
- scheduled or automatic cleanup;
- background deletion;
- AI classification;
- persistent run-history dashboard;
- multi-workspace management UI;
- pinned-chat special behavior;
- telemetry;
- external backend;
- Redux/Zustand;
- TanStack Query;
- Axios;
- Tailwind;
- shadcn;
- custom table/grid implementation;
- generic future-action frameworks.

If a feature is not required by this specification, do not add it.

---

## 5. Safety invariants

These rules must remain true even if UI state is wrong.

1. Projects are never deleted.
2. Conversations belonging to Projects are never intentionally deleted.
3. User-protected conversations are never deleted.
4. Malformed or incompatible API data is never interpreted as permission to delete.
5. Raw UI selection never reaches a DELETE loop.
6. Only a validated `DeletionPlan` may reach destructive execution.
7. A newly confirmed destructive batch uses the current authenticated source tab, fresh standalone inventory, fresh Project protection, and current user protection.
8. All Project conversation IDs are explicitly enumerated before deletion.
9. Incomplete Project discovery/enumeration blocks deletion.
10. Read-side API incompatibility blocks deletion.
11. A change or loss of the bound authenticated source tab blocks/stops deletion.
12. `401`, `403`, and unexpected non-retryable destructive `4xx` stop the batch.
13. The configured requests-per-minute limit applies to every DELETE attempt, including retries.
14. A successfully processed ID is never intentionally deleted twice in one logical run.
15. Tests and demo mode never access real `chatgpt.com`.
16. Tests and demo mode never issue a real DELETE.
17. Authentication secrets are never persisted or logged.
18. At most one destructive executor may be active for the extension at a time.
19. Resume and Retry Failed may only operate on a subset of IDs already confirmed by the user; they may never add new IDs.
20. Closing/reloading/crashing the manager page prevents any new destructive request from starting. There is no background continuation or automatic resume.
21. An already-dispatched DELETE may still complete after Pause, Stop, close, reload, or crash; the extension must not claim otherwise.
22. The production extension loads no remote executable runtime code.
23. The authenticated transport never exposes a generic arbitrary-URL fetch proxy.
24. Destructive operations never start from React render/effect lifecycle; they start only from explicit user commands routed through Application orchestration.
25. Safety-critical persisted configuration is runtime-validated before use.

---

## 6. Concurrency limitation

The extension cannot atomically perform:

```text
DELETE conversation ONLY IF it is still outside every Project
```

against ChatGPT's undocumented backend.

Mitigation:

- fresh preflight before each newly confirmed batch;
- fresh revalidation before Resume;
- fresh revalidation before Retry Failed;
- Resume/Retry may only shrink the already-confirmed ID set;
- README warns users not to move conversations into/out of Projects during an active run.

Do not claim an atomic guarantee the client cannot provide.

---

## 7. Threat model

### Protected assets

- user conversations;
- authenticated ChatGPT session;
- user-protected IDs;
- confirmed destructive selection.

### Main threats

- ChatGPT API drift;
- malformed responses;
- stale Project membership;
- source-tab navigation/reload/close;
- UI selection bugs;
- credential leakage;
- permission creep;
- page-context interference;
- concurrent destructive managers;
- accidental real network in tests/demo;
- destructive execution unexpectedly surviving manager lifecycle.

### Main mitigations

- runtime validation;
- exact source-origin validation;
- explicit Project enumeration;
- source-tab revalidation before every high-level safety inventory operation;
- `DeletionPlan` safety boundary;
- fresh preflight;
- monotonic confirmed-ID subset;
- narrow page transport;
- minimal permissions;
- single-run lock;
- test network guard;
- no secret persistence/logging;
- manager-owned executor.

---

## 8. Technology stack

Use:

```text
Node.js 24
pnpm
WXT
React
TypeScript strict
Ant Design
Zod
Vitest
React Testing Library
@testing-library/user-event
ESLint
Prettier
GitHub Actions
```

Repository requirements:

```text
.nvmrc => 24
pnpm-lock.yaml committed
```

`package.json`:

```json
{
  "engines": {
    "node": ">=24 <25"
  }
}
```

Pin pnpm through `packageManager`.

Set Chrome minimum version to `120`.

---

## 9. Architecture

Use four layers:

```text
UI
 |
 v
Application
 |
 v
Domain

Infrastructure implements Application ports.
```

### Domain

Pure business rules.

Owns:

- conversation model;
- filters/sorting;
- selection rules;
- protection rules;
- `DeletionPlan`;
- confirmed-plan subset rules;
- progress calculations.

Must not import React, Ant, WXT, Chrome APIs, `fetch`, storage, timers, or ChatGPT endpoint code.

### Application

Shallow orchestrators such as:

```text
loadInventory
runPreflight
startDeletion
pauseDeletion
resumeDeletion
stopDeletion
retryFailedDeletion
```

Application coordinates workflow but does not reimplement business rules.

### Application ports

Keep small ports for:

```text
ChatGPT conversation gateway
protected-ID storage
settings storage
clock/sleep
destructive-run lock
```

Application depends on ports; Infrastructure implements them.

### Infrastructure

Owns side effects:

```text
Chrome scripting
page-context requests
browser.storage
Web Locks
timers
ChatGPT request/response handling
```

### UI

React + Ant Design display state and dispatch user intent.

UI never decides deletion eligibility.

---

## 10. Chrome runtime model

### Background service worker

Keep it minimal.

Responsibilities:

```text
handle extension-action click
validate/capture source ChatGPT tab
open/focus manager page
minimal lifecycle coordination if needed
```

It must not own:

```text
deletion queue
executor
progress
retry/backoff timers
inventory
```

### Manager page

The manager extension page owns the entire long-running workflow:

```text
inventory
filters
selection
preflight
confirmed IDs
executor
rate limiting
Pause/Resume/Stop
progress
ETA
```

If manager is closed/reloaded/crashes/browser shuts down/extension updates:

```text
no new DELETE attempts start
no background continuation
no persisted queue
no auto-resume
```

A DELETE already dispatched before manager loss may still complete.

### Source tab

The manager is bound to exactly one source `tabId` captured when launched from an authenticated `https://chatgpt.com` tab.

Validate with exact origin parsing:

```ts
new URL(tab.url).origin === "https://chatgpt.com"
```

Do not use prefix checks.

The manager must not silently rebind itself to another tab.

If the source tab is closed, navigates away, reloads in a way that invalidates the granted access/context, or otherwise becomes unusable:

```text
Deletion safety = BLOCKED
```

Show a clear instruction to relaunch ChatGPTCleaner from a valid ChatGPT tab.

`Open` actions for conversations open a separate/new ChatGPT tab and do not repurpose the source tab.

Outside ChatGPT, show:

```text
Open ChatGPT in a tab and launch ChatGPTCleaner from that tab.
```

Do not perform API work.

---

## 11. Source-bound freshness

The MVP safety boundary remains bound to the exact authenticated source tab
captured at launch and does not add a separate identity-context mechanism.

Initial inventory, preflight, Resume, and Retry Failed each revalidate that
source tab and load fresh standalone inventory, complete Project protection,
and current user-protected IDs. If the tab is missing, has left the exact
`https://chatgpt.com` origin, or cannot execute the narrow read transport,
deletion safety is BLOCKED.

---

## 12. Chrome permissions and security

Expected baseline permissions:

```text
activeTab
scripting
storage
```

Avoid broader permissions unless technically required and documented in an ADR.

Do not add casually:

```text
tabs
cookies
webRequest
webRequestBlocking
unlimitedStorage
<all_urls>
```

Restrict `storage.local` to trusted extension contexts where supported.

No:

```text
eval
new Function
string-based timers
dangerouslySetInnerHTML
backend-controlled HTML rendering
arbitrary authenticated URL proxy
```

---

## 13. Single destructive executor

At most one destructive run may exist across manager contexts.

Prefer Web Locks using a stable extension-origin lock name.

The lock lifecycle is:

```text
preflight
-> typed confirmation
-> atomic lock acquire
-> running
-> paused (lock still held)
-> running
-> complete / stopped / fatal
-> release
```

The safety status may display lock availability, but the actual safety guarantee comes from atomic acquisition immediately before destructive execution.

A second manager may browse, but destructive execution is disabled while the lock is held.

Do not persist a manual lock flag in storage.

While another manager owns the destructive lock, block mutation of user-protection state in other manager contexts to avoid confusing cross-context safety changes.

---

## 14. Authenticated ChatGPT transport

Use the existing authenticated browser session.

Never ask the user to paste credentials.

Fixed `/backend-api/*` reads execute in the authenticated source-tab context
with included browser credentials and an `Accept: application/json` header.
The current backend contract requires a Bearer credential. The injected read
function obtains it from `/api/auth/session`; in the private `ISOLATED` world it
is cached only in page-context memory and reused across pagination requests.
The token never crosses the page-execution boundary and is never logged or
persisted. A backend 401 or 403 clears the memory cache and permits one session
refresh before failing closed. The extension does not infer an account/workspace
identity.

This remains a narrow operation transport, not a generic authenticated fetch
bridge. Request URLs, methods, and allowed headers are constructed internally.

Standalone reads use `ISOLATED`. Within one high-level inventory operation,
reuse the execution world that first completed each narrow operation
successfully. A later failure stops fail-closed rather than probing worlds on
every page. Project operations may make the documented one-time MAIN comparison
when their first ISOLATED result meets the fallback condition.

For `MAIN` execution:

- injected code stays minimal/stateless;
- it contains no extension secrets;
- returned data is untrusted;
- all returned data is validated.
- the exact page origin is rechecked;
- URLs and GET methods are constructed inside the injected function;
- only standalone, Project-sidebar, and Project-conversation reads exist in
  Phase 5.

Do not expose:

```ts
authenticatedFetch(url, options)
```

to application/UI code.

Expose only fixed ChatGPT operations such as:

```text
fetch standalone conversation page
fetch Project sidebar
fetch Project conversation page
delete conversation
```

Target origin is fixed to:

```text
https://chatgpt.com
```

Before inserting a conversation ID into a DELETE path:

- ensure it is a non-empty bounded identifier;
- encode it with `encodeURIComponent`;
- treat it as exactly one path segment.

Do not require UUID format unless the observed current contract requires it.

---

## 15. Undocumented ChatGPT endpoints

These are observations, not supported public API contracts.

### Standalone conversations

Observed family:

```text
GET /backend-api/conversations
```

Current sanitized capture structure:

```text
query names: offset, limit, order, is_archived, is_starred
production query: offset=0, limit=100, order=updated, is_archived=false, is_starred=false
response: { items, total, limit, offset }
item safety field: id (string)
item display fields: title, create_time, update_time
```

Implementation must:

- load all pages;
- validate each response;
- normalize records;
- deduplicate IDs;
- prevent pagination loops;
- tolerate irrelevant extra fields;
- honor a smaller positive response `limit` as the effective page size;
- treat a non-empty page as complete only when it is shorter than that
  effective size and the current informational `total` does not indicate more;
- treat response `total` as a pagination hint because it may change between
  pages, never as the sole correctness boundary;
- enforce a generous centralized safety ceiling for pages/records.

Successful read pages add no artificial delay before the next scheduling
window. Retry-After and deterministic retry backoff apply only to retryable
failures.

Standalone inventory is the sole read path allowed bounded concurrency. It
fetches fixed 100-record offsets in deterministic windows of at most three
requests (`MAX_STANDALONE_READ_CONCURRENCY = 3`). Results are committed in
ascending offset order regardless of completion order. The first page shorter
than 100 establishes the terminal boundary; speculative results at higher
offsets are discarded and cannot contribute inventory records. A required-page
failure blocks the whole inventory. Because a window must settle before the
next is scheduled, a request waiting for 429/5xx/network retry prevents
aggressive scheduling of another window. Project discovery, Project
conversation enumeration, and all destructive operations remain sequential.

Hitting the safety ceiling means inventory is incomplete and deletion is blocked.

### Project discovery

Observed family:

```text
GET /backend-api/gizmos/snorlax/sidebar
```

Used only for protection.

Current sanitized capture structure:

```text
query names: owned_only, conversations_per_gizmo
current initial query: owned_only=true, conversations_per_gizmo=0
response: { items, cursor }
Project ID path: items[].gizmo.gizmo.id
```

### Project conversations

Observed family:

```text
GET /backend-api/gizmos/{projectId}/conversations
```

Current sanitized capture structure:

```text
query names: cursor, limit, owned_only
verified initial query: cursor=0, limit=5, owned_only=true
response: { items, cursor }
membership conversation ID path: items[].id
display fields: title, create_time, update_time
```

Build a complete set:

```text
projectConversationIds
```

Project protection is complete only if all required Projects/pages succeed, validate, remain within safety ceilings, and pagination progresses correctly.

Any incomplete Project protection means:

```text
Deletion safety = BLOCKED
```

Do not trust the standalone endpoint alone to exclude Project conversations.

Development compatibility failures may display a privacy-safe structural
diagnostic containing only the logical operation, sanitized endpoint family,
HTTP status, pagination step, JSON parse result, schema field path, expected
type, actual JSON type, and missing field name. Never include response scalar
values or complete response bodies in diagnostics.

### Delete

Observed family:

```text
DELETE /backend-api/conversation/id/{conversationId}
```

No automated sacrificial DELETE probe.

Real DELETE is never used in automated tests/demo.

Before implementing uncertain real schemas, inspect current browser Network behavior. Do not guess.

---

## 16. API validation

Use Zod at external-data boundaries.

Distinguish:

### Safety-critical metadata

Examples:

```text
conversation ID
Project ID
Project membership conversation ID
pagination fields required to make progress
```

Missing/invalid critical data blocks deletion.

### Display metadata

Examples:

```text
title
created timestamp
updated timestamp
```

Safe degradation:

```text
invalid/missing title => "(Untitled)"
invalid/missing timestamp => null
```

Unexpected extra fields alone do not block compatibility.

Do not turn structurally unsafe records into selectable rows.

---

## 17. Persisted-settings validation

Everything loaded from `browser.storage.local` is untrusted external data and must be validated.

### Protected IDs

Protected conversation IDs are safety-critical.

If persisted protected-ID data is malformed or cannot be validated safely:

```text
Deletion safety = BLOCKED
```

Do not silently discard the protection set and continue.

### Requests-per-minute preference

The rate preference is not destructive eligibility data.

If missing/invalid/out of range:

```text
fall back to the safe default: 60
```

Then persist a normalized value when appropriate.

---

## 18. Read-side request policy

Read requests are sequential by default.

Do not enumerate all Projects using uncontrolled `Promise.all`.

Policy:

```text
2xx valid           => continue
401/403             => authentication blocked
429                 => retry
5xx                 => retry
transient network   => retry
schema incompat     => compatibility blocked
unexpected 4xx      => fail operation
```

Suggested defaults:

```text
max attempts: 4
fallback base backoff: 1s
fallback max backoff: 30s
```

Honor `Retry-After`.

No random jitter.

If server `Retry-After` exceeds 5 minutes, stop the operation and surface retry-later rather than holding the manager indefinitely.

`Retry-After` parser supports both:

```text
delta-seconds
HTTP-date
```

---

## 19. Domain model and safety boundary

Suggested conceptual model:

```text
Conversation
ConversationFilters
DeletionPlan
ConfirmedDeletionPlan
DeletionRunState
DeletionProgress
```

Use a single discriminated run state rather than several independent booleans.

### DeletionPlan

Raw UI selection never reaches the executor.

Flow:

```text
selected IDs
-> buildDeletionPlan(...)
-> typed confirmation
-> confirmed IDs
-> acquire destructive lock
-> executor
```

`buildDeletionPlan()` is pure and excludes:

- Project IDs;
- user-protected IDs;
- IDs missing from fresh standalone inventory.

Normal application code should only obtain executable plans through the builder.

### Confirmed-ID monotonicity

Initial confirmation establishes a set of `confirmedConversationIds`.

Resume and Retry Failed may only operate on a subset of that set.

Example:

```text
confirmed: A B C D
revalidated: A C D
=> allowed

confirmed: A B C D
revalidated: A B C D E
=> E rejected
```

Adding new IDs requires a new destructive batch and new typed confirmation.

Confirmed IDs exist in memory only.

---

## 20. Mutation rules during destructive run

To keep the state model simple and safe:

### Running / stopping

Disable:

```text
selection mutations
Protect
Unprotect
requests-per-minute editing
```

Filtering, sorting, paging, and passive browsing may remain available if they do not mutate deletion/protection state.

### Paused

Keep selection fixed to the confirmed run.

Allow:

```text
Protect
Unprotect
```

for currently visible standalone conversations.

Resume always performs fresh revalidation, so newly protected IDs are removed from the remaining plan.

Do not allow paused-state actions to add IDs to the confirmed set.

If another manager owns the destructive lock, other manager contexts must not mutate protection state.

---

## 21. Project conversations

Project conversations are available through a separate read-only Project
conversations view. They never appear in the standalone deletion table and are
never selectable or deletable.

The manager provides a lightweight selector between mutually exclusive
Standalone conversations and Project conversations views. The standalone view
retains selection, user protection, and deletion controls. The Project view
retains filters, sorting, pagination, and Open, but has no selection, bulk,
protection-mutation, rate, or deletion controls. Every Project row is labelled
`Project protected`.

Show summary counts:

```text
Standalone conversations: N
Project conversations protected: N
User protected: N
```

If an ID appears in both standalone and Project sets:

```text
remove from candidate standalone inventory
hard-protect
```

Project protection cannot be overridden.

---

## 22. User protection

Users can Protect/Unprotect standalone conversations.

Persist protected conversation IDs in `browser.storage.local`.

Behavior:

- protected row cannot be selected;
- protecting a selected row removes it from selection;
- Select All Matching skips protected rows;
- Invert Matching skips protected rows;
- `DeletionPlan` excludes protected IDs even if UI state is corrupted.

Do not store conversation contents.

---

## 23. Main UI

Use Ant Design.

Main table columns:

```text
Selection
Title
Created
Updated
ID
Protection/status
Actions
```

Actions:

```text
Open
Protect / Unprotect
```

`Open` opens the original conversation in a new ChatGPT tab.

Do not render conversation contents inside the extension.

Default sort:

```text
Updated descending
```

### Null dates

```text
null date does not match active Before/After filter
null dates sort last in both directions
```

---

## 24. Filtering and date semantics

Required filters:

```text
title substring, case-insensitive
Created | Updated
Before | After
date
Reset filters
```

Quick presets:

```text
Older than 7 days
Older than 30 days
Older than 90 days
Older than 6 months
Older than 1 year
```

Quick presets use the selected date field or `Updated` by default if no date field is active.

The 6-month and 1-year presets use local calendar subtraction rather than an
approximate number of days. If the target month/year lacks the current
day-of-month, clamp to its final local calendar day.

### Date comparison

Date-picker and quick-preset comparisons use the user's local calendar day.

For a chosen cutoff date:

```text
Before => timestamp strictly before local start-of-day cutoff
After  => timestamp on/after local start-of-day cutoff
```

Use one centralized conversion function so behavior is deterministic and testable.

Domain does not depend on Ant date types.

---

## 25. Sorting and table pagination

Required sorting:

```text
Title asc/desc
Created asc/desc
Updated asc/desc
```

Ant Table pagination:

```text
default 50
allowed 25 / 50 / 100
```

Selection persists across UI pages and filter changes.

---

## 26. Selection semantics

Selection is always an explicit set of IDs.

Never represent destructive selection as:

```text
all except ...
```

Hide/disable Ant's native header Select All.

Use explicit toolbar actions:

```text
Select all matching
Select current page
Clear selection
Invert matching
```

`Select all matching` means all filtered eligible conversations across all UI pages.

`Select current page` adds eligible unprotected rows from only the current
filtered and sorted Ant Table page. Existing selections on other pages remain.

`Clear selection` clears the complete selection.

`Invert matching` only toggles currently filtered eligible rows.

Ant Table Shift-range selection is supported within the current filtered and
sorted UI page. Protected rows are skipped, the range never crosses pages, and
the Project conversations view has no selection behavior.

Always show total selected count.

---

## 27. Safety status

Display compact state such as:

```text
ChatGPT connection       OK
Source tab access        OK
Read API compatibility   OK
Project protection       OK
Run lock                 AVAILABLE

Deletion safety          READY
```

Do not claim DELETE endpoint compatibility before real destructive use.

Blocked examples:

```text
source tab unavailable/changed
inventory contract changed
Project protection incomplete
another destructive run active
protected-ID storage invalid
```

When blocked, destructive controls are disabled.

---

## 28. Inventory flow

On manager load:

```text
validate source tab
-> validate the first standalone page
-> set Read API compatibility to OK
-> load the remaining standalone inventory with a loaded-record count
-> load all Project conversation IDs and set Project protection to OK
-> validate
-> remove Project overlaps
-> load/validate protected IDs
-> show READY/BLOCKED
```

Read API compatibility and complete safety inventory are distinct states. A
validated first read does not make deletion READY. Deletion remains blocked
until standalone pagination and complete Project protection both finish. No
destructive request occurs during inventory loading.

---

## 29. New destructive batch

When the user chooses `Delete selected`:

```text
verify no run is already active
-> revalidate source tab
-> refresh standalone inventory
-> refresh all Project conversation IDs
-> reload/validate protected IDs
-> build fresh DeletionPlan
-> show preflight summary
-> require typed confirmation
-> atomically acquire destructive lock
-> start execution
```

Preflight summary includes:

```text
Originally selected
Still eligible
Excluded: Project
Excluded: protected
Missing/already gone
```

Typed confirmation:

```text
DELETE N
```

The confirmed eligible IDs become the in-memory confirmed ID set.

No eligible IDs => no DELETE action.

If lock acquisition fails after confirmation, no destructive request starts.

---

## 30. Requests per minute

UI:

```text
Requests per minute: [60]
```

Default:

```text
60
```

Allowed range:

```text
1..120
```

Persist only the validated preference.

Semantics:

> Limit the start rate of DELETE attempts. Retries count.

Sequential spacing:

```text
minimum interval = 60,000 / requestsPerMinute
```

No concurrency.

Disable the rate input while running/paused/stopping.

Changed value applies to the next new destructive batch.

---

## 31. DELETE policy

All DELETE attempts are sequential.

```text
valid 2xx                    => deleted; continue
404 / 410                    => skipped/already gone; continue
429                          => retry
5xx                          => retry, then failed; continue
transient network error      => retry, then failed; continue
401 / 403                    => fatal stop
unexpected non-retryable 4xx => fatal stop
redirect/auth anomaly        => fatal stop
unexpected response contract => fatal stop
```

Suggested fallback policy:

```text
max attempts/item: 5
base backoff: 1s
fallback max backoff: 60s
```

Honor server `Retry-After` according to the centralized parser.

No random jitter.

Do not treat `response.ok` alone as proof of successful deletion.

Conservatively detect unexpected redirect/login/response-contract anomalies.

---

## 32. Pause / Resume / Stop

### Pause

If a DELETE is already in flight, allow it to finish.

If waiting locally for rate-limit/backoff, cancel that wait immediately.

Start no new attempt.

The destructive lock remains held while paused.

### Resume

Resume performs fresh revalidation for remaining confirmed IDs:

```text
source tab
standalone inventory
Project IDs
protected IDs
```

Revalidation may only remove IDs from the confirmed set.

If safety remains READY, continue without another typed confirmation.

Never replay already successful IDs.

### Stop

If DELETE is in flight, allow it to finish.

Cancel local wait immediately.

Start no new attempts.

Release the destructive lock after the in-flight operation settles and the run reaches stopped/final state.

Unprocessed IDs may remain selected for a future new batch.

A future new batch requires a new typed confirmation.

---

## 33. Progress, table updates, and result

During execution show:

```text
processed / total
Deleted
Failed
Skipped
Remaining
Retries
Configured rate
Elapsed active time
ETA
Current conversation
```

Maintain:

```text
processed = deleted + failed + skipped
remaining = total - processed
```

ETA:

- before 3 processed items: estimate from configured rate;
- afterwards: use measured active throughput;
- exclude paused time;
- paused state displays `ETA: Paused`.

### Inventory/selection after outcomes

After a successful deletion result:

```text
remove conversation from current inventory
remove from selection
```

After skipped/already-gone:

```text
remove from current inventory if still present
remove from selection
```

After failed non-fatal result:

```text
keep conversation selected
keep visible when possible
```

`Retry failed` performs fresh revalidation and may operate only on failed IDs already in the confirmed set.

No persistent run history.

---

## 34. Manager lifecycle

If manager page disappears:

```text
no new destructive request starts
local timers die
single-run lock releases with context teardown
no queue persistence
no auto-resume
```

An already-dispatched network request may still complete remotely.

Next launch starts fresh.

Only protected IDs and rate preference persist.

---

## 35. Fake/demo mode

The entire product workflow must be usable without:

```text
ChatGPT login
real network
real DELETE
```

`FakeConversationGateway` implements the same port as production.

Reuse the same:

```text
Domain
Application
React components
Ant manager UI
```

Choose fake vs production infrastructure only in the composition root.

Prefer build/config composition:

```text
pnpm dev:demo -> fake infrastructure
pnpm dev      -> production infrastructure
pnpm build    -> production infrastructure
```

Do not switch using query params or localStorage flags.

Fixtures should cover:

```text
many standalone conversations
Projects and Project chats
protected conversations
varied/null dates
untitled conversations
duplicates
malformed responses
success and relevant HTTP/network failures
latency
```

Tests are deterministic.

---

## 36. Test requirements

Testing focuses on invariants rather than coverage percentage.

Global test setup must fail on real network access.

No automated test uses a real authenticated ChatGPT account.

Manual production read smoke checks verify:

- standalone conversations return successfully;
- standalone pagination reuses one short-lived access token in private
  ISOLATED-world memory rather than calling `/api/auth/session` per page;
- Project reads obtain/reuse an access token only inside their fixed injected
  operation;
- standalone and Project reads use the existing browser session naturally;
- 401 and 403 from an actual narrow read fail closed;
- structured `response.detail` diagnostics are visible without credentials;
- Project and Project-conversation pagination complete and deduplicate IDs.

Required coverage categories:

### Pagination

Cover normal multi-page completion, duplicates, changing totals/cursors, non-progress, loop prevention, and safety-ceiling exhaustion.

### Project protection

Cover complete enumeration, malformed/failed Project pages, duplicate membership IDs, and overlap with standalone inventory.

### API validation

Cover critical-field failure vs graceful display-metadata degradation.

### Storage validation

Cover malformed protected-ID data => blocked and malformed rate setting => normalized default.

### Read retries

Cover `429`, `5xx`, transient network errors, authentication failure, `Retry-After` forms, and long retry-later behavior.

### Filters/sorting

Cover title/date filtering, local-day cutoff semantics, 7/30/90 presets, null-date semantics, Reset filters, sorting, and UI pagination.

### Selection/protection

Cover explicit bulk actions, protection, persistence, filter/page changes, active-run mutation restrictions, and absence of native header bulk-select semantics.

### DeletionPlan

Prove that Project, protected, and missing IDs cannot reach eligible IDs, including corrupted selection input.

### Confirmation

Cover exact `DELETE N` for new batches and confirmed-ID monotonic subset behavior.

### Source tab/path safety

Cover exact origin validation, deceptive lookalike hosts, source-tab change, invalid IDs, and path-segment encoding.

### Rate limiter and DELETE policy

Use fake timers and cover configured spacing, retries, fatal/non-fatal status behavior, and response anomalies.

### Pause/Resume/Stop

Cover in-flight completion, cancellation of local waits, revalidation, subset enforcement, lock lifecycle, and prevention of successful-ID replay.

### Single-run lock

Cover mutual exclusion and release on normal/error/manager teardown behavior where practical.

### Manager lifecycle/persistence

Ensure no queue or confirmed plan is persisted and no auto-resume path exists.

### Manifest/security regression

Validate built production manifest:

```text
manifest_version = 3
minimum_chrome_version = 120
expected permissions only
no unexpected host permissions
no unsafe-eval/remote script CSP
no unexpected externally_connectable
no unnecessary web_accessible_resources
```

### UI

Use RTL + user-event for user-visible flows.

Optional Playwright is limited to a few extension/demo smoke tests and never uses a real ChatGPT account.

---

## 37. UI states

### Wrong source tab

```text
Open ChatGPT in a tab and launch ChatGPTCleaner from that tab.
```

### Loading

```text
Connecting to ChatGPT...
Loading conversations...
Building Project protection...
```

### Ready

```text
Safety status
Filters + presets + Reset
Requests/minute
Selection toolbar
Counts
Table
Delete selected (N)
```

### Preflight

Show concise progress/status.

### Confirmation

Show final counts and exact `DELETE N`.

### Running

Show progress, stats, ETA, Pause, Stop.

Selection/protection/rate mutations are disabled.

### Paused

Show Resume and Stop.

Selection stays fixed.

Protect/Unprotect may be used; Resume revalidates.

### Finished

Show current-run result and failed items.

No dashboard.

---

## 38. UX rules

- use simple labels;
- destructive controls look destructive;
- Project protection cannot be overridden;
- user protection is reversible;
- important state does not rely only on color;
- use Ant defaults unless clearly insufficient;
- prefer text labels over unexplained icons;
- show counts around destructive actions;
- keep the manager usable on a normal laptop;
- do not over-design;
- do not imply official OpenAI affiliation.

---

## 39. Suggested repository structure

```text
src/
  domain/
  application/
    ports/
  infrastructure/
    api/
    storage/
    locking/
    time/
  ui/
  entrypoints/
    background.ts
    manager/
  test/

docs/
  PROJECT_SPEC.md
  adr/
    0001-stack.md
    0002-fail-closed-deletion.md
    0003-project-protection.md
    0004-page-context-api-access.md
    0005-manager-owned-executor.md
    0006-single-destructive-run.md
    0007-confirmed-deletion-set.md

.github/workflows/ci.yml
.vscode/extensions.json
.vscode/settings.json
.editorconfig
.gitignore
.nvmrc
AGENTS.md
README.md
SECURITY.md
LICENSE
package.json
pnpm-lock.yaml
tsconfig.json
wxt.config.ts
```

Adapt minor WXT-generated conventions where necessary.

Do not create generic dumping-ground directories such as:

```text
helpers/
utils/
common/
core/
managers/
providers/
factories/
strategies/
```

without a demonstrated need.

---

## 40. Public repository requirements

README must clearly state:

- Chrome MV3 extension;
- current implementation status;
- purpose and non-goals;
- privacy and safety model;
- install from source / Load unpacked;
- development/demo/test commands;
- undocumented ChatGPT web-interface dependency;
- Project protection and concurrency limitation;
- no background deletion/auto-resume;
- project is unofficial and not affiliated with or endorsed by OpenAI;
- users are responsible for complying with applicable terms/policies.

Use an original project/extension icon.

Do not copy OpenAI/ChatGPT logos or visual branding.

Repository includes:

```text
MIT LICENSE
SECURITY.md
AGENTS.md
PROJECT_SPEC.md
ADRs
```

---

## 41. Development phases

### Phase 0 — Bootstrap

Create:

```text
WXT React TS MV3 extension
Node 24 / pnpm constraints
Ant / Zod / Vitest / RTL / ESLint / Prettier
CI
VS Code recommendations
.gitignore / .editorconfig
README / SECURITY / LICENSE
AGENTS.md
ADRs
minimal service worker
manager extension page
```

`pnpm build` must produce a Load-unpacked Chrome build.

### Phase 1 — Domain

Implement and test:

```text
models
filters/sorting
protection
selection
DeletionPlan
confirmed-ID subset rules
progress calculations
```

### Phase 2 — Application

Implement/test:

```text
ports
inventory/preflight orchestration
source-tab stability
rate limiting
destructive run orchestration
Pause/Resume/Stop
Retry Failed
single-run coordination
```

### Phase 3 — Fake infrastructure + demo

Make complete workflow usable without real network.

### Phase 4 — Manager UI

Build complete UI against fake infrastructure.

### Phase 5 — Production read integration

Implement:

```text
source-tab validation
narrow page transport
standalone pagination
Project discovery/enumeration
pagination ceilings
read retry policy
runtime schemas
storage trusted-context config
single-run lock
```

Before uncertain real schemas are coded, inspect current browser Network behavior. Do not guess.

### Phase 6 — Production DELETE integration

**Implementation status:** Stage A implemented with synthetic automated tests.

The production composition uses the observed fixed DELETE through a narrow
ISOLATED-world gateway. Its live response contract is not considered verified
until the one-disposable-conversation manual smoke test succeeds.

Do not perform automated live deletion.

Manual live validation begins with one disposable conversation selected by the user.

### Phase 7 — Hardening

Verify:

```text
manifest permissions
security invariants
no secrets in logs
no remote runtime code
no generic auth fetch proxy
no destructive persistence
demo cannot reach production destructive path
docs and CI
```

---

## 42. Documentation split

This document defines **WHAT the product must do and its architectural boundaries**.

Other files have separate roles:

```text
AGENTS.md
= HOW code must be written

docs/adr/*
= WHY major architectural decisions were chosen

README.md
= HOW users install/use/develop the project

SECURITY.md
= HOW security issues are reported
```

Do not duplicate large sections across these files.

---

## 43. Definition of Done

MVP is done when:

- production output is a loadable Chrome MV3 extension;
- extension action opens the manager from a valid ChatGPT source tab;
- fake workflow works end-to-end without network;
- real read integration loads standalone inventory and complete Project protection;
- production DELETE gateway is implemented behind the safety pipeline;
- Project/protected/missing IDs cannot reach DELETE;
- typed confirmation protects each new destructive batch;
- Resume/Retry only shrink the confirmed ID set;
- sequential rate-limited deletion, retries, Pause/Resume/Stop, progress and ETA work;
- only one destructive executor may run;
- manager loss never starts new background DELETE attempts or auto-resume;
- manifest/security checks pass;
- automated tests cannot access real ChatGPT;
- `pnpm check` passes;
- README, ADRs, AGENTS, SECURITY, and LICENSE are current.

---

## 44. Final mental model

```text
Google Chrome
    |
    +-- authenticated chatgpt.com source tab
    |
    +-- ChatGPTCleaner MV3
          |
          +-- minimal service worker
          |
          +-- manager page
                |
                v
            Application
                |
                v
             Domain
                ^
                |
          Application ports
                ^
                |
          Infrastructure
```

Destructive path:

```text
UI selection
-> source-tab revalidation
-> fresh inventory + Project protection
-> DeletionPlan
-> typed confirmation
-> confirmed ID set
-> atomic single-run lock
-> sequential rate-limited executor
-> narrow ChatGPT DELETE operation
```

Resume / Retry:

```text
remaining confirmed IDs
-> fresh revalidation
-> subset only
-> continue
```

Core rule:

> A conversation can reach DELETE only through a fresh validated plan built from the current bound source tab, current standalone inventory, complete Project-protection data, current user-protection data, and an explicit user-confirmed ID set. Revalidation may remove IDs from that confirmed set but may never add new ones.
