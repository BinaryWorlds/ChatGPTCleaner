# Security Policy

ChatGPTCleaner operates inside an authenticated browser session and performs destructive actions, so security issues should be handled privately when they could expose credentials, session behavior, or deletion-safety bypasses.

## Reporting a vulnerability

Before public release, the repository owner should enable **GitHub Private Vulnerability Reporting**.

When enabled, use the repository's **Security -> Report a vulnerability** flow.

Do **not** publish security-sensitive details as a public GitHub Issue when they involve:

- credentials or session handling;
- destructive-action bypasses;
- Project/protection bypasses;
- arbitrary authenticated requests;
- unexpected broad extension permissions.

If private vulnerability reporting is not yet enabled, do not disclose secrets or exploit details publicly; contact the repository owner privately through an explicitly published contact channel.

## Security-sensitive areas

Examples include:

- a Project or protected conversation becoming deletable;
- bypassing the `DeletionPlan` safety boundary;
- arbitrary authenticated requests through the extension;
- credential/token/cookie leakage;
- source/session/workspace confusion;
- unexpected broad Chrome permissions;
- destructive execution continuing unexpectedly after manager teardown;
- concurrent destructive executors;
- demo/tests reaching the real ChatGPT backend;
- remote executable code being loaded at runtime.

## Scope

There is no security bounty program unless the repository explicitly states otherwise.

Please provide enough information to reproduce and understand an issue while avoiding unnecessary exposure of real conversation data or credentials.
