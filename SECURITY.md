# Security Policy

ChatGPTCleaner operates inside an authenticated browser session and performs destructive actions, so security issues should be handled privately when they could expose credentials, session behavior, or deletion-safety bypasses.

## Diagnostic privacy

ChatGPTCleaner diagnostics remain in the local browser console. The centralized
logger accepts deliberately narrow metadata and defensively drops sensitive
field names. Debug builds emit more lifecycle events but never intentionally
include conversation data, identifiers, authentication data, storage payloads,
or raw API payloads.

## Reporting a vulnerability

If the repository exposes **Security -> Report a vulnerability**, use that flow
to report security issues privately.

Do **not** publish security-sensitive details as a public GitHub Issue when they involve:

- credentials or session handling;
- destructive-action bypasses;
- Project/protection bypasses;
- arbitrary authenticated requests;
- unexpected broad extension permissions.

Otherwise, do not include credentials, exploit details, or private conversation
data in a public issue. Open only a minimal public issue requesting a private
reporting channel.

## Security-sensitive areas

Examples include:

- a Project or protected conversation becoming deletable;
- bypassing the `DeletionPlan` safety boundary;
- arbitrary authenticated requests through the extension;
- credential/token/cookie leakage;
- source-tab binding confusion;
- unexpected broad Chrome permissions;
- destructive execution continuing unexpectedly after manager teardown;
- concurrent destructive executors;
- demo/tests reaching the real ChatGPT backend;
- remote executable code being loaded at runtime.

## Scope

There is no security bounty program unless the repository explicitly states otherwise.

Please provide enough information to reproduce and understand an issue while avoiding unnecessary exposure of real conversation data or credentials.
