# ADR 0001 — Technology Stack

**Status:** Accepted

## Context

ChatGPTCleaner should remain small, auditable, strongly typed, and easy to test. Most complexity should be product safety logic rather than extension/UI infrastructure.

## Decision

Use:

```text
Node.js 24
pnpm
WXT
React
strict TypeScript
Ant Design
Zod
i18next / react-i18next
Vitest
React Testing Library
user-event
ESLint
Prettier
GitHub Actions
```

Target Google Chrome with a Chromium Manifest V3 build.

## Alternatives considered

- Raw MV3/Vite setup: more extension boilerplate.
- MUI DataGrid/AG Grid: more complexity than needed for controlled table selection.
- TanStack Table/headless UI: requires more custom table/state implementation.
- Redux/Zustand: unnecessary for the current state model.

## Consequences

The repository intentionally avoids a separate state-management framework, HTTP client, custom grid, and CSS framework unless a future requirement justifies one.
