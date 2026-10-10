# ChatGPTCleaner Privacy Policy

## Scope and overview

This policy describes data handling performed by ChatGPTCleaner itself. It does
not describe independent storage or processing performed by ChatGPT, OpenAI,
Chrome, the operating system, or other software.

ChatGPTCleaner runs locally as a Chrome extension. It has no developer-operated
backend and contains no analytics, telemetry, advertising, crash-reporting SDK,
or remote logging integration.

## Data processed

While the manager is in use, ChatGPTCleaner processes:

- the source tab identifier and address needed to verify an exact
  `https://chatgpt.com` tab;
- standalone and Project conversation identifiers, titles, and created or
  updated timestamps;
- Project identifiers and conversation membership used to exclude Project
  conversations from deletion;
- protection and selection state; and
- deletion-preview and run state, including confirmed identifiers, progress,
  retry status, and outcomes.

Inventory, selection, and deletion-workflow state is held in memory while the
manager page is open. Choosing **Copy ID** writes that conversation identifier
to the system clipboard. Choosing **Open** opens the corresponding ChatGPT
conversation in a browser tab.

ChatGPTCleaner does not request conversation-detail or message-content
endpoints and does not use conversation message contents. It reads conversation
identifiers, titles, timestamps, and Project membership information needed for
its manager and safety model.

## Local storage

ChatGPTCleaner persists the following values in Chrome's extension-local
storage (`browser.storage.local`):

- protected conversation identifiers;
- the deletion-rate preference;
- the maximum deletion concurrency preference; and
- the theme preference (`auto`, `light`, or `dark`).

The extension restricts this storage to trusted extension contexts. It does not
use Chrome sync storage, and these values are not sent to a
developer-operated service.

ChatGPTCleaner does not persist a language preference. The initial language is
derived from the browser's language settings, and a language change remains in
memory only for the current manager page.

## Data not persisted by ChatGPTCleaner

ChatGPTCleaner does not persist its standalone-conversation inventory, Project
inventory, Project-conversation inventory or membership snapshot, conversation
titles or timestamps, selection state, confirmed deletion plans, deletion
queues, progress, outcomes, or run history.

These statements concern ChatGPTCleaner's own persistence. They do not make any
claim about storage, caching, logging, or retention performed independently by
ChatGPT, OpenAI, Chrome, the operating system, or other software.

## Network communication and authentication

Production runtime requests are limited to `https://chatgpt.com`. The extension
uses the authenticated ChatGPT tab from which it was launched to load
conversation and Project inventory and to send user-confirmed deletion
requests. It does not send runtime data to a developer-operated backend or an
unrelated network destination.

ChatGPTCleaner uses the user's existing authenticated `chatgpt.com` browser
session for requests required by its functionality. Authentication material
used for those requests is handled transiently and is not persisted in
ChatGPTCleaner extension storage or intentionally logged.

## Diagnostics and logging

Diagnostics go to the local browser console. Production builds emit warnings
and errors; development, debug, and demo builds also emit informational and
debug events. There is no remote logging destination.

The centralized logger accepts narrow metadata, reduces errors to safe
summaries, and removes fields whose names indicate sensitive data. It is
designed not to log conversation message contents, conversation or Project
identifiers, titles, authentication data, request or response bodies, headers,
or browser-storage payloads.

## Third-party processing

ChatGPT/OpenAI processes requests made to provide ChatGPTCleaner functionality
independently under its own terms and privacy practices. This policy covers
ChatGPTCleaner's handling only. Chrome and the operating system may also handle
extension storage, browser-console output, navigation, and clipboard contents
independently.

## Local data removal

Changing a stored preference overwrites its previous value. Unprotecting a
conversation removes its identifier from the stored protection set.
ChatGPTCleaner does not currently provide a separate clear-all-data control.

Manually clearing ChatGPTCleaner's extension-local storage removes its stored
protection and preference values. On the next load, protection is empty and
preferences use their defaults. Chrome clears `storage.local` data when the
extension is removed; that uninstall behavior is provided by Chrome rather
than by ChatGPTCleaner application code.
