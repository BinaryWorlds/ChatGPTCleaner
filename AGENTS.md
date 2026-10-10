# AGENTS.md — ChatGPTCleaner

## Scope and workflow

- Chrome/Chromium Manifest V3 extension; Node.js 24 is the build/toolchain runtime. Use
  pnpm.
- `docs/PROJECT_SPEC.md` defines required behavior. Read relevant sections and ADRs;
  investigate discrepancies instead of weakening requirements to match code.
- Keep work within the authorized scope. Inspect Git status and relevant staged,
  unstaged, and untracked files; preserve unrelated changes and staging boundaries.
- Stage, commit, push, or rewrite history only when authorized.
- Use targeted searches. Avoid repository dumps, unsolicited reports, and repeated
  checks without new evidence.

## Architecture

Dependency direction: `UI -> Application -> Domain`; Infrastructure implements
Application ports. Wire dependencies through the existing composition root.

- Domain contains pure rules/calculations, without React, Ant Design, WXT,
  browser/network/storage APIs, timers, or locks.
- Application owns cohesive workflows through injected ports. Split by responsibility,
  not file length; do not duplicate Domain rules.
- Infrastructure implements external APIs, clock/timer and lock ports, boundary
  validation, and centralized logging. Application owns scheduling policy.
- UI renders state and dispatches intent. Use canonical Application eligibility;
  preserve disabled controls and defensive command guards.

## Destructive-operation invariants

- Exclude Project and user-protected conversations. Only a validated `DeletionPlan`,
  never raw selection, reaches DELETE.
- New runs require complete accepted inventory, current local protection, and explicit
  modal confirmation. Incomplete Project coverage or API incompatibility blocks
  acceptance of the candidate and deletion.
- Resume/Retry may only shrink confirmed IDs. Never reload inventory on
  Start/Resume/Retry; Project protection follows the last successful load or explicit
  Refresh.
- Serialize protection writes; Resume must wait for pending protection writes.
- Follow gateway cursors, effective limits, and progress checks; requested page size
  alone does not establish completion.
- Source instability blocks/stops deletion. Preserve one manager-owned destructive
  executor and its lock, never service-worker execution.
- Preserve bounded concurrency, shared start-rate limits, retry deadlines, global
  cooldowns, same-ID exclusion, and exactly-once accounting.
- Pause/Stop/Fatal prevent new attempts under the lifecycle contract. Already-started
  operations, including preparation, may continue while draining; retain required lock
  ownership. Never promise cancellation of remote effects.
- Manager close/reload/crash permits no new attempts, background queue continuation, or
  auto-resume. Never persist queues or confirmed plans.
- Destructive work starts only from explicit user commands invoking Application, never
  render, effects, mount/unmount, or state synchronization. Harmless read effects are
  allowed.

## React and clean code

- Preserve existing `src/ui` conventions. Component implementation files and their
  folders use matching PascalCase names; hooks/helpers retain descriptive names such
  as `useDateFilterDraft.ts` and `dateFilterPeriods.ts`.
- Keep meaningful folders; prefer a file over a redundant single-file folder or
  forwarding barrel. Restructure only within the task's scope, never as incidental
  cleanup.
- Colocate private hooks/helpers with their owner. Use subfolders for meaningful
  grouping; share helpers/components only for demonstrated reuse.
- Component files primarily render/compose. Extract cohesive logic when useful, not
  artificial forwarding hooks or layers.
- Colocate tests with their owners; view/workflow tests may remain together. Follow
  existing export conventions.
- Memoize only for a concrete cost or identity requirement. Define component-independent
  functions outside render.
- Apply SRP, KISS, YAGNI, pragmatic DRY, semantic names, guard clauses, and small
  cohesive functions. Avoid deep nesting and unnecessary `else` after return/throw.
- Remove duplicated knowledge, not similar syntax. Avoid generic dumping grounds and
  speculative frameworks. Comments explain non-obvious reasons/invariants, not obvious
  code.

## Types and configuration

- Strict TypeScript: avoid `any`, unsafe casts, and unproven non-null assertions.
- External API/storage/page-context data starts as `unknown` and is runtime-validated.
  Derive DTO types from Zod schemas, without parallel interfaces.
- Give each semantic concept one canonical type and, when needed, one runtime value
  definition. Keep them with their owner and import them wherever reused; use public
  framework/browser types instead of local replicas. Prefer readonly data and
  discriminated/literal unions with exhaustive handling.
- Keep private props colocated; export only when consumed elsewhere. Avoid global
  dumping grounds and schemas for trusted internal values without a boundary reason.
- Product-tunable settings belong in `src/config.ts`, with explicit units where
  relevant. Protocol paths, keys, lock/event names, discriminants, and labels stay with
  their owners.
- Functions serialized into browser execution contexts must be self-contained; pass
  required configuration explicitly, without module closures. Necessary duplicated
  boundary validation needs alignment tests.
- Use existing private-API schemas; no third-party ChatGPT API types or assumptions
  about undocumented semantics.

## Async, security, and logging

- Await/handle destructive operations. No unhandled fire-and-forget work, empty catches,
  or `Array.forEach(async ...)`.
- Preserve attempt identity, stale-result rejection, cleanup, and cancellation.
  Cancelling a wait must not accidentally launch another attempt.
- Normalize external failures into typed safe results/errors; do not match arbitrary
  `Error.message` for business logic.
- Validate exact `https://chatgpt.com` origin; encode each ID as one path segment.
  Storage/messages are untrusted.
- No `eval`, `new Function`, string timers, `dangerouslySetInnerHTML`, remote executable
  code, or generic authenticated fetch proxy.
- Use the centralized logger through appropriate layer boundaries. Never log
  authentication data, conversation/Project IDs, titles/content, full URLs, headers,
  bodies, storage payloads, or raw external errors.
- Log safe counts, bounded states, normalized status, and timings. DEBUG changes
  verbosity, never sensitivity. Expected deletion-retry scheduling uses debug,
  suppressed by default in production. Preserve other event policies and genuine
  warnings/errors.
- Add dependencies only for demonstrated requirements; preserve the existing stack.

## Tests, documentation, and releases

- Tests/demo never contact real `chatgpt.com` or issue real DELETE. Tests reject real
  network access; use fake gateways/clocks and mocked browser APIs.
- Safety fixes need meaningful regressions. Exercise overlap/out-of-order completion
  where relevant; make clocks/timezones explicit. File-only moves preserve assertions,
  changing imports as needed.
- Update affected specifications for behavior changes and ADRs for major architectural
  decisions. Preserve historical rationale and released changelog entries; avoid
  duplicated specification prose.
- Distinguish implementation, local tests, and verified real Chrome/API behavior. Mocks
  do not establish private-API compatibility.
- Use Conventional Commits/PR titles. Release automation consumes squash-merge history;
  Release Please owns version bumps and future release entries.

## Verification and completion

- Implementation, test, runtime-config, or build/tooling changes: use focused checks
  while working, then run `pnpm check` once after final edits.
- Documentation-only changes: format/check changed Markdown, verify affected
  links/claims, and run `git diff --check`; no application suite/build by default.
- Read-only audits: run only checks needed for findings; preserve implementation/index,
  without installing dependencies or running the full suite by default.
- Repeat checks only after relevant edits or unresolved failures. Report failures and
  unverified limitations; passing local gates does not establish production readiness.
- Finish concisely with changes, verification, and unresolved issues. Identify
  pre-existing failures only when supported by evidence.
