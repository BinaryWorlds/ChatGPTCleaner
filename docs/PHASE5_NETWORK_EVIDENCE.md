# Phase 5 Network evidence checklist

Production inventory reads remain fail-closed until the current undocumented
ChatGPT contract is observed in Chrome DevTools. Do not send a HAR file because
it can contain credentials and unrelated private data.

## Capture procedure

1. Open an authenticated `https://chatgpt.com` tab containing at least one
   standalone conversation and one Project conversation.
2. Open DevTools, select **Network**, enable **Preserve log**, filter to
   **Fetch/XHR**, and reload the page.
3. Exercise the sidebar and open one Project so lazy requests are visible.
4. For each request below, copy only the sanitized fields requested. Replace
   real IDs and titles consistently with examples such as `project-1` and
   `conversation-1`.

## Standalone inventory

Find the current request corresponding to the observed
`/backend-api/conversations` family and provide:

- request method and exact URL pathname;
- pagination query-parameter names, value types, first-page values, and a
  subsequent-page example;
- top-level response JSON keys and the array/container holding conversations;
- one sanitized conversation object showing the ID, title, created timestamp,
  and updated timestamp fields and their JSON types;
- the pagination completion/progress fields, including null/missing behavior;
- whether totals are present and whether they change between pages.

## Project discovery

Find the request corresponding to the observed
`/backend-api/gizmos/snorlax/sidebar` family and provide:

- request method, exact pathname, and non-secret query parameters;
- top-level response JSON keys and the Projects container;
- one sanitized Project object showing the stable Project identifier field;
- any pagination fields and a subsequent-page example, if pagination exists.

## Project conversations

For one Project, find the request corresponding to the observed
`/backend-api/gizmos/{projectId}/conversations` family and provide:

- request method and pathname with the real ID replaced consistently;
- how the Project ID is encoded into the request;
- pagination query parameters and first/subsequent page examples;
- top-level response JSON keys and the membership/conversation container;
- one sanitized membership record showing the conversation-ID field;
- the exact completion/progress fields.

## Session/workspace safety signal

Report whether any current same-origin request exposes a stable, non-secret
account/workspace identifier. Provide only the field names, JSON types, and
whether the values remain stable across reloads and change when switching
workspace. If there is no such field, say so; no fingerprint will be invented.

## Transport and Open action

Also provide:

- whether the reads succeed as ordinary same-origin requests from the page;
- names only of any non-secret request headers required by the web app;
- the sanitized address-bar pathname for an opened conversation, so the Open
  action can be implemented without guessing its route.

Never provide cookies, `Authorization` values, tokens, email addresses, full
request headers, full HAR exports, conversation contents, or unsanitized IDs.
