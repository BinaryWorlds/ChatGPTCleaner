import type { Clock } from "../../application/ports/Clock";
import { ApiRequestLifecycleEvent } from "../../application/ports/Observability";
import { AppConfig } from "../../config";
import type {
  ReadFailureDiagnostic,
  ReadFailureReason,
  ReadResult,
} from "../../application/ports/ConversationGateway";
import {
  appErrorFromHttpStatus,
  createAppError,
  type AppError,
} from "../../application/AppError";
import { logger, type Logger } from "../observability/logger";

export type ReadAttemptResult<T = unknown> =
  | {
      readonly kind: "response";
      readonly status: number;
      readonly body: T;
      readonly retryAfter: string | null;
    }
  | { readonly kind: "network-error" }
  | {
      readonly kind: "failure";
      readonly reason: ReadFailureReason;
      readonly diagnostic?: ReadFailureDiagnostic;
    };

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

export function appErrorForReadFailure(input: {
  readonly operation: string;
  readonly status?: number;
  readonly networkFailure?: boolean;
  readonly cancelled?: boolean;
  readonly retryAfterMs?: number;
}): AppError {
  if (input.cancelled === true) {
    return createAppError("OperationCancelled", {
      operation: input.operation,
    });
  }
  if (input.networkFailure === true || input.status === undefined) {
    return createAppError("NetworkFailure", {
      operation: input.operation,
      retryable: true,
    });
  }
  return appErrorFromHttpStatus(
    input.status,
    input.operation,
    input.retryAfterMs,
  );
}

function fallbackDelay(attempt: number): number {
  return Math.min(
    AppConfig.readRetry.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1),
    AppConfig.readRetry.retryMaxDelayMs,
  );
}

function nonRetryableFailure(status: number): ReadFailureReason {
  if (status === 401 || status === 403) return "authentication";
  return "request";
}

export async function executeReadWithRetry<T>(input: {
  readonly attempt: () => Promise<ReadAttemptResult<T>>;
  readonly clock: Clock;
  readonly signal?: AbortSignal;
  readonly operation?: string;
  readonly operationId?: string;
  readonly page?: number;
  readonly activeLogger?: Logger;
}): Promise<ReadResult<T>> {
  const signal = input.signal ?? new AbortController().signal;
  const activeLogger = input.activeLogger ?? logger;
  const operation = input.operation ?? "api.read";

  for (
    let attempt = 1;
    attempt <= AppConfig.readRetry.maxAttempts;
    attempt += 1
  ) {
    const result = await input.attempt();
    if (result.kind === "failure") {
      return result;
    }
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
      const appError = appErrorFromHttpStatus(result.status, operation);
      activeLogger.warn(ApiRequestLifecycleEvent.Failed, {
        ...(input.operationId === undefined
          ? {}
          : { operationId: input.operationId }),
        operation,
        status: result.status,
        errorCode: appError.code,
        retryable: appError.retryable,
      });
      return { kind: "failure", reason: nonRetryableFailure(result.status) };
    }
    if (attempt === AppConfig.readRetry.maxAttempts) {
      const status = result.kind === "response" ? result.status : undefined;
      const appError = appErrorForReadFailure({
        operation,
        ...(status === undefined ? { networkFailure: true } : { status }),
      });
      activeLogger.error(
        ApiRequestLifecycleEvent.Failed,
        { errorType: "error", errorName: appError.kind },
        {
          ...(input.operationId === undefined
            ? {}
            : { operationId: input.operationId }),
          operation,
          ...(status === undefined ? {} : { status }),
          errorCode: appError.code,
          retryable: appError.retryable,
        },
      );
      return {
        kind: "failure",
        reason:
          result.kind === "response" && result.status === 429
            ? "retry-later"
            : result.kind === "response"
              ? "server"
              : "network",
      };
    }

    const retryAfter =
      result.kind === "response"
        ? parseRetryAfter(result.retryAfter, input.clock.now())
        : null;
    if (retryAfter !== null && retryAfter > AppConfig.api.maxRetryAfterMs) {
      activeLogger.warn("api.request.rateLimited", {
        ...(input.operationId === undefined
          ? {}
          : { operationId: input.operationId }),
        operation,
        status: 429,
        retryAfterMs: retryAfter,
      });
      return { kind: "failure", reason: "retry-later" };
    }

    const delay = retryAfter ?? fallbackDelay(attempt);
    const retryFields = {
      ...(input.operationId === undefined
        ? {}
        : { operationId: input.operationId }),
      operation,
      retryAttempt: attempt,
      ...(input.page === undefined ? {} : { page: input.page }),
      delayMs: delay,
      ...(result.kind === "response" ? { status: result.status } : {}),
    };
    if (result.kind === "response" && result.status === 429) {
      activeLogger.warn("api.request.rateLimited", retryFields);
    } else {
      activeLogger.warn(ApiRequestLifecycleEvent.Retry, retryFields);
    }
    const sleepResult = await input.clock.sleep(delay, signal);
    if (sleepResult === "cancelled") {
      activeLogger.debug("application.operation.cancelled", {
        ...(input.operationId === undefined
          ? {}
          : { operationId: input.operationId }),
        operation,
      });
      return { kind: "failure", reason: "network" };
    }
  }

  return { kind: "failure", reason: "network" };
}
