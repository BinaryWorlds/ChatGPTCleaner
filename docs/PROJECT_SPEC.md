# ChatGPTCleaner — Product & Engineering Specification

**Status:** Current product requirements  
**Product:** Google Chrome Manifest V3 extension  
**Primary browser:** Google Chrome  
**Minimum Chrome version:** 120  
**Build/toolchain runtime:** Node.js 24  
**Package manager:** pnpm

Requirements use **must** or direct instructions. Endpoint shapes in
[section 15](#15-undocumented-chatgpt-endpoints) are private-API observations,
not upstream guarantees. Conceptual examples do not prescribe repository type
or file names. This specification defines intended behavior; it is not evidence
that a test or production check has been performed. ADRs record decision
rationale and may retain historical context.

---

## 1. Purpose

ChatGPTCleaner is a small, privacy-focused Chrome extension for safely reviewing, filtering, protecting, selecting, and bulk-deleting **standalone ChatGPT conversations**.

It operates against the user's already-authenticated `https://chatgpt.com` browser session.

Its single responsibility is:

> Safely bulk-delete user-selected standalone conversations while never intentionally deleting Projects, conversations belonging to Projects, or conversations explicitly protected by the user.

The product must stay small, auditable, fail-closed, and easy to reason about.

---

## 2. Product boundary

The production product is a Chrome MV3 extension: an extension action, minimal
service worker, manager page, and narrow transport to the authenticated source
tab. It is not a hosted application. Demo mode uses the same UI with fake
infrastructure.

GitHub Releases distribute the production `pnpm build` output as
`ChatGPTCleaner-vX.Y.Z-chrome.zip`. Install the extracted build via
`chrome://extensions` → Developer mode → Load unpacked. Unpacked installations
do not auto-update; users install newer release builds manually. Chrome Web
Store integration is outside current scope.

Release Please owns application versions and release `CHANGELOG.md` entries.
Ordinary and Dependabot PRs must not reserve versions or future release headings.
Dependency maintenance uses one weekly cross-ecosystem rollup; maintainers
manually merge Release Please PRs.

The [Release Please workflow](../.github/workflows/release-please.yml) is
triggered on pushes to `master` and by manual dispatch. Repository secret
`RELEASE_PLEASE_TOKEN` authenticates the action that maintains the release PR and
creates a draft release. After the action creates or updates a release PR, the
workflow verifies its reported branch and commit, formats only its generated
`CHANGELOG.md` with the repository's pinned Prettier, and commits any formatting
change to that branch before CI validates the new revision. If no release PR or
formatting change exists, this is a no-op. If no releasable changes exist,
publication is skipped. A created release triggers release-SHA, tag-target,
package-version, repository, and draft validations before quality checks,
production ZIP packaging/validation, attestation, asset upload, and draft
publication. Attestation must cover the exact validated public ZIP.

The initial `v1.0.0` release used a `0.0.0` manifest baseline and temporarily
skipped changelog generation because its dated entry was already prepared. Its
one-time implementation commit requested the release with a `Release-As: 1.0.0`
trailer; no permanent fixed-version override was used. After `v1.0.0`
publication, normal automatic changelog generation applies to later releases.

If publication fails, use **Re-run failed jobs** on the original workflow run.
Do not start a new dispatch or re-run all jobs: keeping the successful Release
Please job preserves its `release_created` outputs for the publication job. The
draft release remains available, upload replaces the same-named asset, and the
draft guards reject publication after the release is already public.

Any future Chrome Web Store integration is release-only: it consumes the same
canonical production artifact lineage, requires the store version to equal the
application release version, uses Chrome Web Store API v2 with
`STAGED_PUBLISH`, and leaves final publication to a maintainer after approval.
Normal and dependency pull requests never publish to the store. Store
credentials must remain isolated in an appropriate GitHub secret/environment.
No live Chrome Web Store integration is part of the current product.

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
uncertain eligibility => do not delete
incomplete candidate inventory => reject the candidate
source/authentication/contract/protection failure => block deletion
```

An unsuccessful replacement load does not automatically invalidate a previously
accepted snapshot. [Section 28](#28-inventory-flow) defines which Refresh
failures preserve READY and which block deletion.

### 3.2 Explicit user control

No automatic, scheduled, or background cleanup.

A new destructive batch always requires:

```text
explicit selection
-> preview from the loaded standalone snapshot
-> destructive-modal confirmation
-> destructive Web Lock
-> bounded rate-limited execution
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
- persistent inventory caching;
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
6. Raw selection must first become a snapshot-based `DeletionPlan`; only its
   confirmed monotonic subset may reach destructive execution.
7. A newly confirmed destructive batch uses eligible IDs from the last
   successfully loaded inventory snapshot and current local user protection.
8. Every accepted snapshot explicitly enumerates all Project conversation IDs.
9. Incomplete Project discovery/enumeration blocks accepting a new snapshot.
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
20. Closing/reloading/crashing the manager page prevents any new destructive operation from starting. There is no background continuation or automatic resume.
21. Destructive operations already started, including source/session preparation before DELETE dispatch, may finish after Pause, Stop, close, reload, or crash; the extension must not claim otherwise.
22. The production extension loads no remote executable runtime code.
23. The authenticated transport never exposes a generic arbitrary-URL fetch proxy.
24. Destructive operations never start from React render/effect lifecycle; they start only from explicit user commands routed through Application orchestration.
25. Safety-critical persisted configuration is runtime-validated before use.
26. Starting, resuming, or retrying a destructive run performs no standalone or Project inventory reads.

---

## 6. Concurrency limitation

The extension cannot atomically perform:

```text
DELETE conversation ONLY IF it is still outside every Project
```

against ChatGPT's undocumented backend.

Product semantics:

- the last successful initial load or explicit Refresh is the inventory
  snapshot used for Project exclusion;
- current local protection is applied at confirmation and reloaded inside the
  destructive lock before starting, resuming, or retrying DELETE;
- Resume/Retry may only shrink the already-confirmed ID set and do not reload
  ChatGPT inventory;
- users are told to Refresh when ChatGPT inventory may have changed externally.

Do not claim an atomic guarantee the client cannot provide.

---

## 7. Threat model

Protect user conversations, the authenticated session, local protected IDs, and
the confirmed destructive selection.

Threats include private-API drift, malformed data, stale Project membership,
source-tab changes, selection bugs, credential leakage, permission creep,
page-context interference, concurrent managers, accidental real test/demo
network access, and execution unexpectedly surviving manager teardown.

Mitigate through runtime validation, exact source binding, complete snapshot
enumeration, confirmed-subset enforcement, a narrow credential-confined
transport, minimal permissions, the destructive lock, test network guards,
and manager-owned execution. The following sections define those boundaries;
none supplies an atomic server-side Project-membership guarantee.

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
i18next / react-i18next
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

Cohesive workflows such as:

```text
loadInventory
startDeletion
pauseDeletion
resumeDeletion
stopDeletion
retryFailedDeletion
```

Application owns asynchronous orchestration and scheduling policy through
injected ports. It coordinates inventory publication, retries, concurrency,
rate limits, and lifecycle transitions without duplicating pure Domain rules.
Do not add forwarding layers merely to keep orchestrators short.

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
Web Lock adapters
clock/timer adapters
ChatGPT request/response handling
```

### UI

React + Ant Design display state and dispatch user intent.

UI consumes canonical Domain/Application eligibility for presentation and
defensive command guards. It must not independently redefine eligibility or
make destructive execution depend solely on a disabled control.

---

## 10. Chrome runtime model

The background service worker handles the extension action, captures/validates
the source tab, opens or focuses the manager, and performs minimal lifecycle
coordination. It must not own inventory, queues, progress, or retry timers.

The manager owns inventory, filters, selection, preview/confirmed IDs, execution,
rate limits, lifecycle controls, progress, and ETA. Context loss has the behavior
defined in [section 34](#34-manager-lifecycle).

Bind to exactly one source `tabId` captured at launch. Validate using
`new URL(tab.url).origin === "https://chatgpt.com"`, never a prefix match. Do not
silently rebind. Closing, navigating, or reloading the source in a way that
invalidates access/context blocks deletion and requires relaunch from a usable
ChatGPT tab.

Conversation Open actions use a new tab, preserving the source. Outside
ChatGPT, show `Open ChatGPT in a tab and launch ChatGPTCleaner from that tab.`
and perform no API work.

---

## 11. Source-bound inventory and DELETE transport

Initial load and Refresh validate the captured source and load a complete
snapshot. Preview, confirmation, Start, Resume, and Retry Failed perform no
inventory reads. DELETE still validates the exact bound tab and may obtain a
session credential; these checks do not refresh membership or establish a
separate account/workspace identity.

Revalidate the same source when it is removed or finishes navigation and when
the manager regains focus/visibility. Loss blocks deletion while accepted data
may remain browsable. This does not replace just-in-time transport validation,
poll the source, or silently rebind it.

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

At most one destructive executor may own work across manager contexts. Use a
Web Lock with a stable extension-origin name; never persist a manual lock flag.

Acquire the lock atomically after confirmation and before destructive work.
Inside it, reload and validate local protected IDs and shrink the confirmed
set. Lock contention starts no DELETE and is an operation notice, not canonical
BLOCKED availability. A later eligible command may try acquisition again.

Hold the lock through Running, Pausing, Paused, and Stop/Fatal draining. Normal
completion, Stop, or Fatal releases it only after all active gateway operations
settle. Publishing a fatal state does not itself release the lock. Manager
context teardown releases the browser-owned lock separately; operations already
started may still complete remotely.

Other managers may browse but must not mutate user protection while the lock is
held. Lock acquisition, not a displayed availability check, enforces mutual
exclusion. See [lifecycle rules](#32-pause--resume--stop) and
[ADR 0006](adr/0006-single-destructive-run.md).

---

## 14. Authenticated ChatGPT transport

Use the existing authenticated session; never request pasted credentials.
Construct fixed URLs, methods, and headers inside narrow injected operations.
Expose standalone-page, Project-sidebar, Project-conversation-page, and DELETE
operations, never `authenticatedFetch(url, options)`.

Fixed reads use included browser credentials and `Accept: application/json`.
Obtain the required Bearer credential from `/api/auth/session` inside the page
operation. Cache it only in private ISOLATED-world memory across pagination;
never return, log, or persist it. Backend 401/403 clears the cache and permits
one session refresh before failing closed.

Standalone reads use ISOLATED. Reuse each operation's first successful execution
world within a high-level inventory load. Project operations may compare MAIN
once on the documented initial authentication/transport fallback condition;
later failure must not cause repeated world probing.

MAIN code must be minimal and stateless, recheck the exact origin, construct
only the three fixed GET operation URLs, and return untrusted data for external
validation. It contains no extension secrets. DELETE stays in ISOLATED with no
MAIN fallback; [ADR 0004](adr/0004-page-context-api-access.md) records the rationale.

The target origin is fixed to `https://chatgpt.com`. A DELETE ID must be nonempty
and bounded, encoded with `encodeURIComponent`, and used as exactly one path
segment. Do not assume UUID format without current contract evidence.

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

Standalone fixed-offset pages and independent Projects use bounded read
concurrency. The first validated standalone page establishes the pagination mode. When its next cursor
confirms the requested fixed 100-record offset contract, subsequent pages are
fetched in deterministic windows of at most three requests
(`MAX_STANDALONE_READ_CONCURRENCY = 3`) and committed in ascending offset order
regardless of completion order. If any page reports a different valid next
cursor or effective limit, Application stops fixed-offset speculation and
follows the gateway cursor sequentially. Application treats the gateway's null
next cursor as completion and does not independently infer completion from a
hard-coded page size. Speculative results beyond a terminal page are discarded
and cannot contribute inventory records. A required-page failure rejects the
whole candidate inventory; availability follows the Refresh failure rules in
[section 28](#28-inventory-flow). Because a window must settle before the next is scheduled, a
request waiting for 429/5xx/network retry prevents aggressive scheduling of
another window. Project discovery remains sequential. Different Projects may
be enumerated with at most the same three-read limit, while cursor-dependent
pages inside each Project remain sequential. Destructive operations use the
bounded scheduler described below.

Hitting the safety ceiling rejects the candidate inventory and blocks deletion;
previously accepted data may remain visible as defined in
[section 28](#28-inventory-flow).

### Project discovery

Observed family:

```text
GET /backend-api/gizmos/snorlax/sidebar
```

Used to enumerate Project membership for deletion exclusion and the separate
read-only Project conversations view. It does not enable Project management.

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
previously observed initial query: cursor=0, limit=5, owned_only=true
application-requested initial query: cursor=0, limit=projectConversationPageSize, owned_only=true
default requested projectConversationPageSize: 50
response: { items, cursor }
membership conversation ID path: items[].id
display fields: title, create_time, update_time
```

`AppConfig.inventory.projectConversationPageSize` in `src/config.ts` is a
code-only requested page size, not a verified ChatGPT maximum. The requested
default of 50 does not establish that the server honors that size. Project
conversation pagination follows each opaque response cursor until terminal
`null`; a page containing fewer items than the
requested size is not terminal when it supplies a next cursor. A response that
repeats the cursor used by the actual request is non-progress and blocks the
candidate snapshot.

Build a complete set:

```text
projectConversationIds
```

Project protection is complete only if all required Projects/pages succeed, validate, remain within safety ceilings, and pagination progresses correctly.

Incomplete enumeration never becomes an accepted snapshot. Without a complete
accepted initial snapshot, deletion cannot become READY. On Refresh, retain the
previous accepted snapshot for display: exhausted transient network/429/server
failures preserve its READY availability, while source, authentication,
contract, pagination, ceiling, or protected-storage failures block deletion.
The authoritative failure classification is in
[section 28](#28-inventory-flow).

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

Before implementing uncertain real schemas, inspect current browser Network
behavior using a controlled, privacy-safe manual check. Do not guess. Query
names such as `is_starred=false` and `owned_only=true` alone do not establish
which user-visible categories the server includes. Verify those semantics
before claiming complete coverage beyond the observed endpoint results.

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

### Deletion scheduling preferences

The rate and maximum-concurrency preferences are not destructive eligibility
data.

If missing/invalid/out of range:

```text
attempt starts per minute => fall back to 60
maximum concurrency => fall back to 1
```

Then persist normalized values when appropriate.

---

## 18. Read-side request policy

Cursor-dependent pages within one collection are sequential by default.

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

Default read retry policy:

```text
max total attempts: 4
fallback base backoff: 1s
fallback max backoff: 30s
```

The limit includes the initial attempt: four attempts allow three retries.
Fallback delays grow exponentially from the base, capped at the fallback
maximum. A valid `Retry-After` replaces the fallback delay.

No random jitter.

If server `Retry-After` exceeds 5 minutes, stop the operation and surface retry-later rather than holding the manager indefinitely.

`Retry-After` parser supports both:

```text
delta-seconds
HTTP-date
```

---

## 19. Domain model and safety boundary

Conceptual roles are Conversation, Filters, DeletionPlan, ConfirmedPlan,
RunState, and Progress. Reuse canonical repository types; these examples do not
require renaming or duplicate definitions. Use a discriminated lifecycle state
rather than competing independent booleans.

### DeletionPlan

A pure plan builder excludes Project members, user-protected IDs, and IDs absent
from the accepted standalone snapshot, even when UI selection is corrupt. Raw
selection never reaches an executor. Obtain executable plans through this
boundary and confirm the eligible subset against current snapshot/local
protection. [Section 29](#29-new-destructive-batch) defines the handoff.

### Confirmed-ID monotonicity

Confirmation establishes an in-memory maximum ID set. Start, Resume, and Retry
Failed may only shrink it using current local protection; they perform no
inventory reads. Successful IDs are not replayed.

For confirmed `A B C D`, remaining `A C D` is allowed; adding `E` is rejected.
New IDs require a new batch and confirmation. Never persist the confirmed set.

---

## 20. Mutation rules during destructive run

Use the canonical workflow-ownership predicate for both controls and command
handlers. Throughout confirmed preflight, Running, Pausing, Paused, Stopping,
fatal drain, and an eligible terminal Retry Failed handoff, disable selection,
Protect/Unprotect, Refresh, and scheduling edits. The captured-setting rules
are defined in [section 30](#30-deletion-scheduling).

Filtering, sorting, paging, and passive browsing may remain available when they
do not mutate deletion or protection state. They must not add IDs to a run.

Protection writes are serialized. Pending or programmatic writes are guarded
in Application, rather than relying only on disabled UI controls. Resume waits
for a pending protection write to complete successfully, then reloads local
protection inside the lock and may only shrink the remaining confirmed set.

Other managers must not mutate protection while the destructive lock is held.

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

- protected standalone rows remain selectable;
- selection and user protection are independent;
- protection writes are serialized and overlapping Protect/Unprotect commands
  are not started;
- bulk Protect applies only to the selected unprotected subset;
- bulk Unprotect applies only to its captured selected protected subset and
  requires confirmation when that subset contains more than one ID;
- confirmed protection-mutation targets may shrink against canonical storage
  but never expand;
- `DeletionPlan` excludes protected IDs even if UI state is corrupted.

Do not store conversation contents.

---

## 23. Main UI

Use Ant Design.

The manager provides an `Auto | Light | Dark` appearance preference in the
header. `Auto` is the default and follows live `prefers-color-scheme` changes;
explicit Light or Dark ignores later system changes. Persist only the validated
preference value in extension-local storage. Missing or malformed values resolve
to `Auto`. The resolved mode also sets the document `color-scheme`.

The manager supports exactly English (`en`) and Polish (`pl`). On every fresh
manager load, inspect `navigator.languages` in order, falling back to
`navigator.language` only when the list is unavailable or empty. Use the first
supported base language from an `en`/`en-*` or `pl`/`pl-*` tag; otherwise use
English. The `PL | EN` header selector changes language for the current session
only and is not persisted. The active language controls application copy,
`document.documentElement.lang`, Ant Design locale, and user-visible date/time
formatting. Translation resources are bundled locally with the extension.

Main table columns:

```text
Selection checkbox (no visible header label)
Title
Created
Updated
Protection
Actions
```

Actions:

```text
Open
Protect / Unprotect
Copy ID
```

`Open` opens the original conversation in a new ChatGPT tab.

The ID is not a permanent column; an icon-only action copies it. The Protection
column uses distinct locked/unlocked icons with accessible labels and provides
an Ant table filter for all, user-protected, and unprotected standalone rows.

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
Select all results
Select page
Clear
Invert
```

`Select all results` means all filtered standalone conversations across all UI pages.

`Select page` adds rows from only the current
filtered and sorted Ant Table page. Existing selections on other pages remain.

`Clear` clears the complete selection.

`Invert` only toggles currently filtered rows.

Ant Table Shift-range selection is supported within the current filtered and
sorted UI page. Protected standalone rows remain selectable, the range never crosses pages, and
the Project conversations view has no selection behavior.

Always show total selected count.

---

## 27. Safety status

Derive one user-facing availability state from canonical source, inventory,
storage, and run state:

```text
UNBOUND
LOADING
READY
BLOCKED(reason)
```

The happy path shows no visible safety-status surface. A meaningful transition
to READY is announced once through a polite nonvisual live region. Loading uses
the existing inventory progress stages. Unbound startup shows one instruction to
launch from a ChatGPT tab and no empty conversation table. A blocked state shows
one primary cause, its consequence, and at most one useful recovery action. Do
not expose a grid of implementation checks or claim DELETE endpoint
compatibility before real destructive use.

Blocked examples:

```text
source tab unavailable/changed
inventory contract changed
Project enumeration has no accepted snapshot or a blocking failure
protected-ID storage invalid
```

When blocked, destructive controls are disabled.

Run-lock contention is an operation-level notice, not an availability failure.
A second manager remains usable for browsing. The lock is not polled or shown as
an unchecked status; atomic acquisition remains the safety guarantee.

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

Explicit Refresh runs this same complete loader while the current valid
snapshot remains displayed. The replacement is built off to the side and is
published only after all standalone and Project pages and the current
protected-ID storage validate. Initial load and explicit Refresh both require
this protected-ID validation before reporting deletion safety as READY. Success
atomically replaces the snapshot and current in-memory protected-ID set, and
clears selection and any stale deletion preview while retaining filters,
sorting, and page size. Failure preserves the previous accepted snapshot and
last-valid protected-ID set for display. Protected-storage failure blocks
deletion and the preserved set is not destructive authority. Refresh shows a
loading indicator, cannot create a deletion plan from partial results, and is
disabled throughout deletion-workflow ownership, including confirmed preflight,
Paused, draining, and an eligible terminal retry handoff.
Refresh and user-protection writes are mutually exclusive in one manager, with
both UI controls and command handlers enforcing the exclusion.
Transient network, rate-limit, and server failures leave the accepted snapshot
ready and show one refresh warning. Source loss, authentication failure,
API/schema incompatibility, unexpected request rejection, pagination
incompatibility, and safety-ceiling exhaustion block deletion even though the accepted snapshot remains
visible. Start, Resume, and Retry Failed re-read and validate protected IDs
again while holding the destructive lock; this just-in-time validation remains
authoritative for destructive execution and may only shrink the confirmed set.

---

## 29. New destructive batch

Reject a new batch while another workflow owns execution. Build the plan from
the accepted snapshot and current local protection, then show a destructive
modal with the eligible count, irreversible-action warning, and protected-skip
count when applicable. Use explicit Cancel/Delete actions; no typed token.

Confirmation may only reduce the previewed set. Acquire the lock, reload and
validate local protection, and shrink again before execution. Lock failure or
an empty final subset issues no DELETE. No eligible IDs means no Delete action.

The confirmed set remains in memory. This handoff performs no standalone or
Project inventory reads; Project exclusion uses the accepted snapshot. Pending
preflight retains workflow ownership as defined in
[section 33](#33-progress-table-updates-and-result).

---

## 30. Deletion scheduling

UI:

```text
Deletion rate: [60] /min
Chats at once: [1]
```

Each setting has its own keyboard-accessible explanation of its semantics and
default. Keep the input's accessible name aligned with its visible label.

Defaults:

```text
60 attempts/minute
1 simultaneous request
```

Allowed ranges:

```text
attempt starts per minute: 1..120
simultaneous requests: 1..20
```

Persist only the validated preferences.

The concurrency range is an application product constraint, not an official
ChatGPT limit. It caps active operations rather than creating fixed batches;
when timing and rate limits permit, the scheduler may fill a released slot
without waiting for the other active operations. The upper bound is neither a
recommendation nor a guarantee of API safety or improved throughput.

Semantics:

> Limit the start rate of DELETE attempts. Retries count.

Scheduler start spacing:

```text
minimum interval = 60,000 / requestsPerMinute
```

The measured start is invocation of the gateway DELETE operation, which includes
source/session preparation. The later page-context `fetch` dispatch and server
receipt are not this clock, so the limiter does not guarantee identical
server-observed spacing. The first eligible operation has no initial limiter
delay. Time already spent awaiting work counts toward the interval; do not add
another full interval after a slow response. Concurrency is a ceiling, not a
requirement to fill all slots immediately. A rate below the concurrency value
is valid: the settings control different things.

Initial attempts and retries share one start limiter. The scheduler does not
accumulate credits or catch up with a burst. A normalized HTTP 429 Retry-After
creates a global cooldown for all new DELETE starts. Retry fallback backoff is
per conversation and does not block other eligible work. Manual Retry Failed
must preserve any outstanding start-spacing deadline and global 429 cooldown;
resetting visible result/time counters must not bypass either limit. When
cooldowns overlap, a later shorter one must not shorten an active longer one.

Only one operation for the same conversation ID may be active at a time.
Correlate results to their reserved attempt and apply terminal accounting
exactly once, regardless of completion order. Preserve confirmed-plan order in
the failed-ID result list. See
[ADR 0009](adr/0009-bounded-parallel-deletion.md).

Disable both inputs for the full deletion-workflow ownership state, including
confirmed-run preflight, pending Start/Resume/Retry, Running, Pausing, Paused,
Stopping or fatal drain, and a terminal run with Retry Failed available. Enable
them only after ownership is released and active operations have settled.

Snapshot both values at destructive confirmation. Changed values apply only to
the next new destructive batch; Pause, Resume, and Retry Failed keep the
snapshot.

---

## 31. DELETE policy

All DELETE attempts start through the single `DeletionRun` scheduler and are
bounded by the configured concurrency.

```text
valid 2xx                    => deleted; continue
404 / 410                    => skipped/already gone; continue
429                          => retry
500 + detail Request timeout => retry when retryDeleteTimeouts; otherwise failed; continue
other 5xx                    => retry, then failed; continue
transient network error      => retry, then failed; continue
401 / 403                    => fatal stop
unexpected non-retryable 4xx => fatal stop
redirect/auth anomaly        => fatal stop
unexpected response contract => fatal stop
```

Default DELETE fallback policy:

```text
max total attempts/item: 5
base backoff: 1s
fallback max backoff: 60s
```

The limit includes the initial attempt: five attempts allow four retries.
Fallback delays grow exponentially from the base, capped at the fallback
maximum. For HTTP 429, honor validated `Retry-After` for both item readiness and
the global cooldown. Values over five minutes fail closed rather than creating
an indefinite wait.

No random jitter.

`AppConfig.deletion.retryDeleteTimeouts` is a code-only boolean with default
`true`. It controls automatic retries only for an actual DELETE response with
HTTP 500 and JSON `detail === "Request timeout"`. When `false`, that item fails
without an automatic retry, other eligible work continues, and explicit Retry
Failed remains available. It is not a UI or persisted setting. Network errors,
other 500 responses, source/session preparation, and the three-second slow
notice keep their existing behavior.

Do not treat `response.ok` alone as proof of successful deletion.

Conservatively detect unexpected redirect/login/response-contract anomalies.

If a dispatched DELETE remains awaiting its response for 3 seconds, show one
non-blocking informational notice. Measure from the actual DELETE `fetch`
dispatch, excluding source/session preparation, scheduler waits, and retry
backoff. Latch the notice in memory for the logical run through
Pause/Resume/Stop/Fatal/completion and Retry Failed. A new confirmation clears
the prior notice immediately, including delayed or empty preflight paths; only
signals associated with that new run may set it again. Validate the runtime
signal, correlate it to an active dispatched attempt, and ignore stale or
unrelated signals. Clean up timers and listeners when their operation ends.
Do not persist or log this signal.

---

## 32. Pause / Resume / Stop

### Pause

When Pause takes effect, start no new attempts. Allow all already-started
gateway operations, including source/session preparation and dispatched DELETE
requests, to settle.

If waiting locally for rate-limit/backoff, cancel that wait immediately.

The destructive lock remains held while paused.

### Resume

Resume operates on remaining confirmed IDs, reloads only current local
protected IDs, and performs no standalone or Project inventory reads. It may
only remove IDs from the confirmed set.

Resume must not begin while a user-protection write is pending.

If local protection removes an ID already captured by a paused local attempt, that
attempt is discarded before any DELETE is issued.

If safety remains READY, continue without another confirmation.

Never replay already successful IDs.

### Stop

Stop cannot resume the unprocessed queue. Eligible failed IDs may still use
Retry Failed under the separate guards in
[section 33](#33-progress-table-updates-and-result).

When Stop takes effect, start no new attempts. Allow all already-started gateway
operations, including source/session preparation and dispatched DELETE
requests, to settle.

Cancel local wait immediately.

Release the destructive lock after all active operations settle and the run
reaches stopped/final state.

Unprocessed IDs may remain selected for a future new batch.

A future new batch requires a new destructive-modal confirmation.

### Fatal drain

A fatal outcome prevents new scheduler starts immediately. Already-started
gateway operations still settle and publish their outcomes exactly once; the
active count continues to decrease to zero. Retain the destructive lock until
that drain completes. Fatal/BLOCKED states cannot use Retry Failed.

---

## 33. Progress, table updates, and result

During execution show:

```text
Conversation deletion + status
Completed X of Y
progress bar
Deleted
Failed
In progress
Deletion time
Estimated time remaining
relevant alerts and lifecycle controls
```

The result row always shows Deleted and Failed, including zero values. Displayed
Deleted is `deleted + skipped`, so it includes conversations whose DELETE
returned 404/410 because they were already absent. The internal outcome and
processed accounting remain distinct. In progress is the active
gateway-operation count and therefore includes source/session preparation
before a DELETE dispatch.

Show captured scheduling settings in the locked inputs, not a duplicate details
disclosure. An internal scheduled-retry counter represents accepted future
attempts; Pause/Stop can prevent them from dispatching.

Maintain:

```text
processed = deleted + failed + skipped
remaining = total - processed
```

ETA:

- before 3 processed items, the UI displays `Estimating…`; the unchanged domain
  estimate is based on the configured rate;
- afterwards, calculate `ETA (ms) = ceil((total - processed) * activeElapsedMs / processed)`
  and prefix the displayed duration with `about`;
- `activeElapsedMs` is active-run wall time, excluding preflight and stable
  pause but including pacing, backoff, preparation, response waits, and drain;
- concurrency affects measured completed throughput; there is no explicit
  concurrency multiplier. Active items remain wholly in `remaining` and receive
  no partial-completion credit. ETA is an estimate, not a completion promise;
- paused state displays paused text;
- Pausing and Stopping hide ETA;
- stable terminal states hide ETA and In progress.

The displayed progress percentage is presentational only. Clamp it to 99% while
`remaining > 0`; never use the percentage as a completion predicate. A pending
empty preflight does not render a successful `0/0` result. Finished work with
failed items is labelled `Completed with failures` and does not use full-success
styling.

While Running, Pausing, or Stopping, a presentation-only one-second ticker
advances Deletion time from the most recently published elapsed value. Rebase
the ticker whenever a new run snapshot is published. Freeze it during stable
Pause and terminal states, exclude preflight time, and preserve the Retry Failed
elapsed reset. The ticker does not mutate `DeletionRun`, recalculate or count
down ETA, start work, or produce per-second announcements.

New-run preflight shows preparation feedback without publishing a synthetic run
result. Resume and Retry Failed show a pending presentation and reject repeated
UI submission until their protection/lock preflight resolves. These are presentation/ownership states, not additional
`DeletionRun` lifecycle states. Pending confirmed preflight must still own the
workflow until it resolves, so clearing an old notice/result cannot unlock
settings, selection, Refresh, or destructive commands. Retry Failed preserves
the logical-run identity and slow-response latch but resets its result/time
accounting; while it executes, label it `Retrying failed conversations`.

While running or draining, the slow-response notice uses `ChatGPT’s servers are
responding slowly.` In stable Paused or terminal states, use the retrospective
copy `ChatGPT responded slowly during deletion.` The signal remains latched
according to the DELETE policy above.

### Retry Failed eligibility

Application allows Retry Failed only for a nonfatal `finished` or `stopped` run
with failed confirmed IDs. These terminal states are published only after
active work drains. Application does not independently evaluate the Manager's
canonical READY/BLOCKED availability.

The Manager command additionally requires current READY inventory/source
availability, no blocking safety override, and no pending command preflight.
Both UI surfaces mirror the combined eligibility. Disabled controls do not
replace Application or Manager execution guards.

Reacquire the destructive lock and reload valid local protection; retry only
the eligible failed subset. Lock contention must not convert an otherwise
eligible terminal run into canonical BLOCKED or prevent a later acquisition
attempt. Preserve the logical run's captured settings, slow-response latch,
start deadline, and global cooldown. Reset displayed result/time accounting
only when retry execution begins.

### Inventory/selection after outcomes

Deleted and skipped/already-gone outcomes remove the ID from the in-memory
inventory and selection without automatic Refresh. Nonfatal failed IDs remain
selected and visible where possible. Retry eligibility follows the contract
above. Do not persist run history.

---

## 34. Manager lifecycle

If manager page disappears:

```text
no new destructive operation starts
local timers die
single-run lock releases with context teardown
no queue persistence
no auto-resume
```

Destructive operations already started before manager loss, including
source/session preparation before DELETE dispatch, may finish remotely.

Next launch starts fresh.

Only protected IDs, the rate and maximum-concurrency preferences, and the theme
preference persist. Language selection is session-only, as defined in
[section 23](#23-main-ui).

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

The single deterministic demo fixture should cover the normal workflow with:

```text
many standalone conversations
Projects and Project chats
protected conversations
varied/null dates
untitled conversations
duplicates
latency
successful bounded deletion
```

Automated tests cover malformed responses and relevant HTTP/network failures
outside the default demo fixture. Tests and the demo fixture are deterministic.

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
- read failures surface sanitized structural diagnostics without response
  scalar values, raw bodies, or credentials;
- Project and Project-conversation pagination complete and deduplicate IDs.

Required coverage categories:

### Pagination

Cover normal multi-page completion, duplicates, changing totals/cursors, non-progress, loop prevention, and safety-ceiling exhaustion.

### Snapshot publication and Refresh

Cover atomic replacement, no partial candidate exposure, success clearing
selection/preview, failure retaining display data, transient failure preserving
READY only with an accepted snapshot, and blocking source/auth/schema/pagination/
ceiling/storage failures. Verify Refresh/protection-write exclusion in controls
and command handlers.

### Project protection

Cover complete enumeration, malformed/failed Project pages, duplicate membership IDs, and overlap with standalone inventory.

### API validation

Cover critical-field failure vs graceful display-metadata degradation.

### Storage validation

Cover malformed protected-ID data => blocked; missing, malformed, or out-of-range
rate/concurrency preferences => their normalized defaults; and theme fallback.
Ensure a pending preference save cannot alter the captured active-run values.

### Read retries

Cover `429`, `5xx`, transient network errors, authentication failure, `Retry-After` forms, and long retry-later behavior.

### Filters/sorting

Cover title/date filtering, local-day cutoffs, 7/30/90-day and 6-month/1-year
presets, month-end/leap-year clamping, null dates, Reset, sorting, and UI pagination.

### Selection/protection

Cover explicit bulk actions, protection, persistence, filter/page changes, active-run mutation restrictions, and absence of native header bulk-select semantics.

### DeletionPlan

Prove that Project, protected, and missing IDs cannot reach eligible IDs, including corrupted selection input.

### Confirmation

Cover destructive-modal confirmation for new batches and confirmed-ID monotonic subset behavior.

### Source tab/path safety

Cover exact origin validation, deceptive lookalike hosts, source-tab change, invalid IDs, and path-segment encoding.

### Parallel scheduler and DELETE policy

Use deterministic fake time and controllable gateway completions. Cover:

- concurrency caps, shared start spacing for initial attempts and retries, no
  initial delay or catch-up burst, and no extra wait after a slow completion;
- out-of-order completion, same-ID exclusion, exactly-once terminal accounting,
  and stable failed-ID ordering;
- per-item retry readiness, overlapping global 429 cooldowns, and preservation
  of active cooldown/start deadlines through Retry Failed;
- fatal/nonfatal response classification, response anomalies, and exact
  HTTP 500 `detail: "Request timeout"` recognition with the code-only retry flag
  enabled and disabled; other retry paths and manual retry remain unaffected;
- Application retry rejection for fatal/nonterminal states or no failed IDs;
- direct Manager retry rejection under unavailable inventory/source or a
  blocking safety override, without a disabled button masking the guard;
- successful eligible retry after lock contention.

### Slow-response notice

Cover the three-second actual-fetch threshold, fast responses, excluded
preparation/backoff time, concurrent signal correlation, stale-signal rejection,
timer/listener cleanup, logical-run latching through Resume/Retry, and immediate
reset on new confirmation, including delayed and empty preflight.

### Pause/Resume/Stop

Cover multiple active operations settling out of order after Pause, Stop, and
Fatal; no new starts during drain; decreasing active counts and lock retention
until all active operations settle. Cover Pause → Resume of remaining queued or
retryable work, Stop without queue resume, cancellation of local waits, current
local protection, subset enforcement, zero inventory reloads, and no replay of
successful IDs.

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

Use RTL + user-event for user-visible flows. Include confirmed-preflight
ownership, pending Start/Resume/Retry, lifecycle setting locks and captured
values, terminal result accounting, 99% clamping, elapsed ticker cleanup, and
keyboard/accessible-name behavior. Inspect rendered responsiveness and
assistive-technology behavior separately; source assertions do not establish
visual or screen-reader quality.

Optional Playwright is limited to a few extension/demo smoke tests and never uses a real ChatGPT account.

---

## 37. UI states

- **Wrong source / UNBOUND:** one instruction to launch from ChatGPT; no API work,
  safety dashboard, or empty table.
- **Loading:** show connection, conversation loading, and Project-protection
  progress without suggesting that a first valid page makes deletion READY.
- **READY:** filters/presets/Reset, scheduling settings, selection toolbar,
  counts, standalone table, and Delete count. READY has no visible safety panel.
- **BLOCKED:** one accessible highest-priority cause with its consequence and
  at most one recovery action, as defined in [section 27](#27-safety-status).
- **Confirmation:** the eligible count, applicable protected-skip summary, and
  explicit destructive action.
- **Running:** progress, metrics, ETA, Pause/Stop; disable protected mutations.
- **Paused:** Resume/Stop; selection/protection/settings stay locked.
- **Terminal:** current-run result and failed items, using `Completed with
  failures` when applicable. Release controls only when no execute/resume/stop/
  retry handoff owns the workflow and active operations have settled.

Place one `Conversation deletion` section between Selection and the table once
a run or confirmed preflight exists. It owns run status, alerts, metrics, and
one control set. The upper safety surface retains blockers and accessible
transition announcements without duplicating routine run status/controls.
Do not add a persistent run-history dashboard.

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

## 39. Public repository requirements

The public repository must identify ChatGPTCleaner as an unofficial project
that is not affiliated with or endorsed by OpenAI. It must use original
project/extension branding and must not copy OpenAI or ChatGPT logos.

Public documentation must explain the safety and privacy model, user-facing
installation and operation, contributor constraints, security reporting, and
the reasons for major architectural decisions without duplicating large
sections between documents.

The maintained public-document set and each document's authority are defined in
the documentation split below.

---

## 40. Documentation split

This document defines **WHAT the product must do and its architectural boundaries**.

Other files have separate roles:

- [AGENTS.md](../AGENTS.md): repository engineering and agent instructions.
- [ADRs](adr/): rationale and status of major architectural decisions.
- [README.md](../README.md): user overview, installation, usage, and development entry point.
- [PRIVACY.md](../PRIVACY.md): detailed data-handling and persistence disclosure.
- [CONTRIBUTING.md](../CONTRIBUTING.md): contribution and feedback policy.
- [SECURITY.md](../SECURITY.md): private vulnerability-reporting guidance.
- [LICENSE](../LICENSE) and [EULA.md](../EULA.md): terms for project material and Official Builds.
- [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md): bundled third-party license notices.
- [CHANGELOG.md](../CHANGELOG.md): historical released changes; Release Please owns future entries.

Do not duplicate large sections across these files.

LICENSE and EULA govern legal terms. This specification defines product
requirements and does not grant additional usage rights. ADR Context sections
may describe superseded workflows; current decisions must remain consistent
with the current specification. A changed architectural decision requires an
explicit superseding ADR rather than silently erasing the old rationale.

---

## 41. Core execution rule

A conversation reaches DELETE only through an explicit user-confirmed subset
eligible in the last accepted complete inventory snapshot and not locally
protected at the locked execution check. Later operations may remove IDs but
never add them.

Canonical contracts:

- [Plan and confirmed-ID boundary](#19-domain-model-and-safety-boundary).
- [Snapshot acceptance and Refresh failures](#28-inventory-flow).
- [Lock ownership](#13-single-destructive-executor).
- [Scheduling](#30-deletion-scheduling) and [response policy](#31-delete-policy).
- [Pause/Resume/Stop](#32-pause--resume--stop) and
  [retry eligibility/results](#33-progress-table-updates-and-result).
- [Manager teardown](#34-manager-lifecycle).

---
