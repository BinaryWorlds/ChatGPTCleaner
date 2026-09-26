# ChatGPTCleaner

> **Status: Work in progress — implementation is not complete yet.**

A privacy-focused **Google Chrome Manifest V3 extension** for safely reviewing, protecting, filtering, selecting, and bulk-deleting standalone ChatGPT conversations.

> **Unofficial project.** ChatGPTCleaner is not affiliated with or endorsed by OpenAI. It relies on undocumented ChatGPT web interfaces, which may change or stop working at any time.

## What it does

ChatGPTCleaner is intentionally narrow:

- loads standalone ChatGPT conversations;
- explicitly discovers Project conversations so they are protected;
- lets you search, sort, filter, select, and protect standalone chats;
- provides date filters and quick cleanup presets;
- previews deletion from the last successfully loaded inventory snapshot and
  current local protection state;
- deletes selected conversations sequentially at a configurable requests-per-minute rate;
- supports Pause, Resume, Stop, retries, progress, and ETA;
- never intentionally deletes Projects or conversations belonging to Projects.

## What it does not do

It does not manage Projects, archive chats, search conversation contents, export conversation contents, run scheduled cleanup, or continue deletion in the background.

See [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) for the complete product contract.

## Safety model

The deletion path is:

```text
selection
-> DeletionPlan preview from loaded inventory
-> typed confirmation
-> confirmed IDs
-> single-run lock
-> fresh local protected-ID check
-> sequential rate-limited DELETE
```

Important rules:

- Project conversations are hard-protected.
- User-protected conversations are excluded at confirmation and freshly
  rechecked inside the destructive lock before DELETE continues.
- Incomplete Project protection blocks initial load or Refresh from replacing
  the current snapshot.
- API incompatibility blocks deletion.
- Source-tab instability blocks or stops deletion.
- Raw table selection never reaches DELETE.
- Resume/Retry may only use IDs from the already-confirmed ID set and never
  reload ChatGPT inventory.
- Closing/reloading the manager prevents new DELETE requests from starting.
- An already-dispatched request may still complete remotely.
- There is no persisted deletion queue and no automatic resume.
- DELETE attempts are strictly sequential and use the configured rate limit;
  retries count as attempts.

Project exclusion reflects the last successful initial inventory load or
explicit Refresh. It is not atomically rechecked before DELETE. If ChatGPT data
may have changed externally, use Refresh before deleting, and do not move
conversations into or out of Projects during an active run.
Do not switch the relevant ChatGPT account or workspace during an active run.

## Privacy

ChatGPTCleaner has no external backend, telemetry, analytics, or remote logging.

The extension does not persist conversation contents, conversation inventory, Project inventory, authentication tokens, cookies, request headers, deletion queues, confirmed deletion plans, or run history.

Persistent local storage is limited to protected conversation IDs and the
deletion-rate preference.

## Installation from source

Requirements:

```text
Node.js 24
pnpm
Google Chrome 120+
```

After implementation:

```bash
pnpm install
pnpm build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated Chromium extension directory documented by the WXT build output.

## Development

```bash
pnpm install
pnpm dev
```

Demo mode uses fake infrastructure and must not access the real ChatGPT network:

```bash
pnpm dev:demo
```

This selects the fake composition at build time. It does not depend on a
ChatGPT tab or account, and its deterministic deletion outcomes only mutate
in-memory fake data. Query parameters and browser storage cannot switch a
production build into demo mode.

Production source-tab, read-only inventory, Project protection, storage, retry,
locking, and the narrow production DELETE transport are implemented. The
production DELETE contract completed its documented manual smoke test against
one disposable standalone conversation using the then-current safety path:
one eligible ID was confirmed, exactly one DELETE attempt succeeded, and the
run completed with no failed or skipped items. Automated tests and demo mode
still never issue real DELETE.

### Debug logging

`pnpm dev`, `pnpm build:debug`, and `pnpm build:demo` enable detailed,
privacy-safe local console diagnostics. `pnpm build` is production mode and
emits warnings and errors only. Logs are never sent anywhere; there is no
telemetry or runtime logging switch.

Debug mode changes verbosity, not data sensitivity. Diagnostics must never
contain conversation content, titles or IDs, Project IDs, authentication data,
storage payloads, or raw API payloads.

Quality gate:

```bash
pnpm check
```

## Architecture

```text
UI -> Application -> Domain
          ^
          |
    Application ports
          ^
          |
    Infrastructure
```

Major architectural decisions live in [`docs/adr`](docs/adr).

Coding-agent and contributor rules live in [`AGENTS.md`](AGENTS.md).

## Internal ChatGPT APIs

This project uses undocumented ChatGPT web interfaces observed from the browser application.

They are not public/stable APIs.

Before changing production integration code, verify the current browser Network contract rather than guessing endpoint response shapes.

## Terms and responsibility

Users are responsible for ensuring that their use of this project complies with applicable terms, policies, and law.

This project does not attempt to bypass rate limits or platform protections.

## Security

See [`SECURITY.md`](SECURITY.md).

## License

MIT.
