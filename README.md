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
- performs a fresh safety preflight before deletion;
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
-> fresh source/session/project preflight
-> DeletionPlan
-> typed confirmation
-> confirmed IDs
-> single-run lock
-> sequential rate-limited DELETE
```

Important rules:

- Project conversations are hard-protected.
- User-protected conversations are excluded.
- Incomplete Project protection blocks deletion.
- API incompatibility blocks deletion.
- Source/session/workspace instability blocks or stops deletion.
- Raw table selection never reaches DELETE.
- Resume/Retry may only shrink the already-confirmed ID set.
- Closing/reloading the manager prevents new DELETE requests from starting.
- An already-dispatched request may still complete remotely.
- There is no persisted deletion queue and no automatic resume.

Because ChatGPT does not provide the extension an atomic "delete only if still outside Project" operation, do not move conversations into or out of Projects while a deletion run is active.

## Privacy

ChatGPTCleaner has no external backend, telemetry, analytics, or remote logging.

The extension does not persist conversation contents, conversation inventory, Project inventory, authentication tokens, cookies, request headers, deletion queues, confirmed deletion plans, or run history.

Persistent local storage is limited to small settings such as protected conversation IDs and the deletion rate.

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
