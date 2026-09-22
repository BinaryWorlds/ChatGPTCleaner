import type { Clock } from "../../application/ports/Clock";
import type {
  ReadFailureReason,
  ReadResult,
} from "../../application/ports/ConversationGateway";

export const READ_MAX_ATTEMPTS = 4;
export const READ_RETRY_BASE_MS = 1_000;
export const READ_RETRY_MAX_MS = 30_000;
export const READ_RETRY_AFTER_LIMIT_MS = 5 * 60_000;

export type ReadAttemptResult =
  | {
      readonly kind: "response";
      readonly status: number;
      readonly body: unknown;
      readonly retryAfter: string | null;
    }
  | { readonly kind: "network-error" };

export type RawReadResult = ReadResult<unknown>;

export function parseRetryAfter(
  value: string | null,
  nowMs: number,
): number | null {
  if (value === null) return null;
  const normalizedValue = value.trim();
  if (/^\d+$/.test(normalizedValue)) {
    const seconds = Number(normalizedValue);
    return Number.isFinite(seconds) ? Math.ceil(seconds * 1_000) : null;
  }

  const dateMs = Date.parse(normalizedValue);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

function fallbackDelay(attempt: number): number {
  return Math.min(
    READ_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
    READ_RETRY_MAX_MS,
  );
}

function nonRetryableFailure(status: number): ReadFailureReason {
  if (status === 401 || status === 403) return "authentication";
  return "request";
}

export async function executeReadWithRetry(input: {
  readonly attempt: () => Promise<ReadAttemptResult>;
  readonly clock: Clock;
  readonly signal?: AbortSignal;
}): Promise<RawReadResult> {
  const signal = input.signal ?? new AbortController().signal;

  for (let attempt = 1; attempt <= READ_MAX_ATTEMPTS; attempt += 1) {
    const result = await input.attempt();
    if (
      result.kind === "response" &&
      result.status >= 200 &&
      result.status < 300
    ) {
      return { kind: "success", value: result.body };
    }
    if (
      result.kind === "response" &&
      result.status !== 429 &&
      (result.status < 500 || result.status >= 600)
    ) {
      return { kind: "failure", reason: nonRetryableFailure(result.status) };
    }
    if (attempt === READ_MAX_ATTEMPTS) {
      return {
        kind: "failure",
        reason:
          result.kind === "response" && result.status === 429
            ? "retry-later"
            : "network",
      };
    }

    const retryAfter =
      result.kind === "response"
        ? parseRetryAfter(result.retryAfter, input.clock.now())
        : null;
    if (retryAfter !== null && retryAfter > READ_RETRY_AFTER_LIMIT_MS) {
      return { kind: "failure", reason: "retry-later" };
    }

    const delay = retryAfter ?? fallbackDelay(attempt);
    const sleepResult = await input.clock.sleep(delay, signal);
    if (sleepResult === "cancelled") {
      return { kind: "failure", reason: "network" };
    }
  }

  return { kind: "failure", reason: "network" };
}
