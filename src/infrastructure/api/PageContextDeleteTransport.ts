import { z } from "zod";
import { AppConfig } from "config";
import { isSafetyCriticalIdentifier } from "domain/identifier";
import { createAppError } from "application/AppError";
import type { Clock } from "application/ports/Clock";
import {
  ChatGptOperation,
  type DeleteAttemptEvents,
  type DeleteAttemptResult,
} from "application/ports/ConversationGateway";
import type { SourceTabValidator } from "application/ports/SourceTabLifecycle";
import { parseRetryAfter } from "./readRetry";

export interface DeleteConversationOperation {
  readonly kind: "delete-conversation";
  readonly conversationId: string;
}

export interface PageContextDeleteExecutor {
  execute(
    tabId: number,
    operation: DeleteConversationOperation,
    onResponseSlow?: () => void,
  ): Promise<unknown>;
}

const DELETE_RESPONSE_SLOW_SIGNAL_KIND = "delete-response-slow";

function isExpectedSlowResponseSignal(
  message: unknown,
  expectedSignalId: string,
): boolean {
  if (typeof message !== "object" || message === null) return false;
  const record = message as Readonly<Record<string, unknown>>;
  return (
    Object.keys(record).length === 2 &&
    record.kind === DELETE_RESPONSE_SLOW_SIGNAL_KIND &&
    record.signalId === expectedSignalId
  );
}

const responseEnvelopeSchema = z
  .object({
    kind: z.literal("response"),
    status: z.number().int().min(0).max(599),
    retryAfter: z.string().nullable(),
    redirected: z.boolean(),
    responseType: z.string(),
    contentType: z.string().nullable(),
    deleteTimeout: z.boolean(),
  })
  .strict();

const executionEnvelopeSchema = z
  .array(
    z.object({
      result: z.discriminatedUnion("kind", [
        responseEnvelopeSchema,
        z
          .object({
            kind: z.literal("network-failure"),
          })
          .strict(),
        z
          .object({
            kind: z.literal("failure"),
            reason: z.enum([
              "authentication",
              "compatibility",
              "source-unavailable",
            ]),
          })
          .strict(),
      ]),
    }),
  )
  .length(1);

export function createDeleteConversationOperation(
  conversationId: unknown,
): DeleteConversationOperation | null {
  if (
    !isSafetyCriticalIdentifier(conversationId) ||
    !/^[A-Za-z0-9_-]+$/u.test(conversationId)
  ) {
    return null;
  }
  return {
    kind: "delete-conversation",
    conversationId,
  };
}

export function classifyDeleteResponse(input: {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly redirected: boolean;
  readonly responseType: string;
  readonly contentType: string | null;
  readonly deleteTimeout: boolean;
}): DeleteAttemptResult {
  if (
    input.redirected ||
    input.responseType === "opaqueredirect" ||
    input.status === 0
  ) {
    return {
      kind: "fatal",
      reason: "response-anomaly",
      error: createAppError("ApiCompatibilityFailure", {
        operation: ChatGptOperation.ConversationDelete,
      }),
    };
  }
  const mediaType = input.contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (input.status >= 200 && input.status < 300) {
    if (mediaType === "text/html") {
      return {
        kind: "fatal",
        reason: "response-anomaly",
        error: createAppError("ApiCompatibilityFailure", {
          operation: ChatGptOperation.ConversationDelete,
          httpStatus: input.status,
        }),
      };
    }
    return { kind: "deleted", status: input.status };
  }
  if (input.status === 404 || input.status === 410) {
    return { kind: "skipped", status: input.status };
  }
  if (input.status === 429) {
    if (
      input.retryAfterMs !== null &&
      input.retryAfterMs > AppConfig.api.maxRetryAfterMs
    ) {
      return {
        kind: "fatal",
        reason: "retry-later",
        error: createAppError("RateLimited", {
          operation: ChatGptOperation.ConversationDelete,
          httpStatus: input.status,
          retryAfterMs: input.retryAfterMs,
        }),
      };
    }
    return {
      kind: "retryable",
      reason: "rate-limit",
      ...(input.retryAfterMs === null
        ? {}
        : { retryAfterMs: input.retryAfterMs }),
      status: input.status,
    };
  }
  if (input.status === 500 && input.deleteTimeout) {
    return {
      kind: "retryable",
      reason: "delete-timeout",
      status: input.status,
    };
  }
  if (input.status >= 500 && input.status < 600) {
    return { kind: "retryable", reason: "server", status: input.status };
  }
  if (input.status === 401) {
    return {
      kind: "fatal",
      reason: "authentication",
      error: createAppError("AuthenticationUnavailable", {
        operation: ChatGptOperation.ConversationDelete,
        httpStatus: input.status,
      }),
      status: input.status,
    };
  }
  if (input.status === 403) {
    return {
      kind: "fatal",
      reason: "authorization",
      error: createAppError("AuthorizationDenied", {
        operation: ChatGptOperation.ConversationDelete,
        httpStatus: input.status,
      }),
      status: input.status,
    };
  }
  return {
    kind: "fatal",
    reason: "client",
    error: createAppError("ApiCompatibilityFailure", {
      operation: ChatGptOperation.ConversationDelete,
      httpStatus: input.status,
    }),
    status: input.status,
  };
}

export class PageContextDeleteTransport {
  public constructor(
    private readonly sourceTab: SourceTabValidator,
    private readonly executor: PageContextDeleteExecutor,
    private readonly clock: Clock,
  ) {}

  public async deleteConversation(
    conversationId: string,
    events?: DeleteAttemptEvents,
  ): Promise<DeleteAttemptResult> {
    return this.executeDeleteConversation(conversationId, events);
  }

  private async executeDeleteConversation(
    conversationId: string,
    events?: DeleteAttemptEvents,
  ): Promise<DeleteAttemptResult> {
    const operation = createDeleteConversationOperation(conversationId);
    if (operation === null) return compatibilityFailure();

    const source = await this.sourceTab.validate();
    if (source.kind !== "valid") {
      return {
        kind: "fatal",
        reason: "source-unavailable",
        error: createAppError("SourceTabUnavailable", {
          operation: ChatGptOperation.ConversationDelete,
        }),
      };
    }

    let rawResult: unknown;
    try {
      rawResult = await this.executor.execute(
        source.tabId,
        operation,
        events?.onResponseSlow,
      );
    } catch {
      const revalidatedSource = await this.sourceTab.validate();
      if (revalidatedSource.kind !== "valid") {
        return {
          kind: "fatal",
          reason: "source-unavailable",
          error: createAppError("SourceTabUnavailable", {
            operation: ChatGptOperation.ConversationDelete,
          }),
        };
      }
      return { kind: "retryable", reason: "network" };
    }
    const parsed = executionEnvelopeSchema.safeParse(rawResult);
    if (!parsed.success || parsed.data[0]?.result === undefined) {
      return compatibilityFailure();
    }

    const result = parsed.data[0].result;
    if (result.kind === "network-failure") {
      return { kind: "retryable", reason: "network" };
    }
    if (result.kind === "failure") {
      if (result.reason === "source-unavailable") {
        return {
          kind: "fatal",
          reason: "source-unavailable",
          error: createAppError("SourceTabInvalidOrigin", {
            operation: ChatGptOperation.ConversationDelete,
          }),
        };
      }
      if (result.reason === "authentication") {
        return {
          kind: "fatal",
          reason: "authentication",
          error: createAppError("AuthenticationUnavailable", {
            operation: ChatGptOperation.ConversationDelete,
          }),
        };
      }
      return compatibilityFailure();
    }

    return classifyDeleteResponse({
      status: result.status,
      retryAfterMs: parseRetryAfter(result.retryAfter, this.clock.now()),
      redirected: result.redirected,
      responseType: result.responseType,
      contentType: result.contentType,
      deleteTimeout: result.deleteTimeout,
    });
  }
}

function compatibilityFailure(): DeleteAttemptResult {
  return {
    kind: "fatal",
    reason: "response-anomaly",
    error: createAppError("ApiCompatibilityFailure", {
      operation: ChatGptOperation.ConversationDelete,
    }),
  };
}

export function createChromePageContextDeleteExecutor(): PageContextDeleteExecutor {
  return {
    execute: async (tabId, operation, onResponseSlow) => {
      if (
        createDeleteConversationOperation(operation.conversationId) === null
      ) {
        return [{ result: { kind: "failure", reason: "compatibility" } }];
      }

      const slowSignalId =
        onResponseSlow === undefined ? null : crypto.randomUUID();
      let slowSignalReceived = false;
      const receiveSlowResponseSignal: Parameters<
        typeof browser.runtime.onMessage.addListener
      >[0] = (message, sender) => {
        if (
          onResponseSlow === undefined ||
          slowSignalId === null ||
          slowSignalReceived ||
          sender.id !== browser.runtime.id ||
          sender.tab?.id !== tabId ||
          !isExpectedSlowResponseSignal(message, slowSignalId)
        ) {
          return;
        }
        slowSignalReceived = true;
        onResponseSlow();
      };
      if (onResponseSlow !== undefined) {
        browser.runtime.onMessage.addListener(receiveSlowResponseSignal);
      }

      try {
        return await browser.scripting.executeScript({
          target: { tabId },
          world: "ISOLATED",
          args: [
            operation,
            slowSignalId === null
              ? null
              : {
                  signalId: slowSignalId,
                  thresholdMs: AppConfig.deletion.slowResponseThresholdMs,
                },
          ],
          func: async (
            narrowOperation: DeleteConversationOperation,
            slowResponseSignal: unknown,
          ) => {
            const origin = "https://chatgpt.com";
            const maximumConversationIdLength = 512;
            const authSessionPath = "/api/auth/session";
            const deleteConversationPathPrefix =
              "/backend-api/conversation/id/";
            const slowResponseThresholdMs = 3_000;
            const slowResponseSignalKind = "delete-response-slow";
            const operationRecord: unknown = narrowOperation;
            const record =
              typeof operationRecord === "object" && operationRecord !== null
                ? (operationRecord as Readonly<Record<string, unknown>>)
                : null;
            if (
              record?.kind !== "delete-conversation" ||
              typeof record.conversationId !== "string" ||
              record.conversationId.length < 1 ||
              record.conversationId.length > maximumConversationIdLength ||
              !/^[A-Za-z0-9_-]+$/u.test(record.conversationId) ||
              Object.keys(record).length !== 2
            ) {
              return { kind: "failure", reason: "compatibility" };
            }
            if (window.location.origin !== origin) {
              return { kind: "failure", reason: "source-unavailable" };
            }

            const signalRecord =
              typeof slowResponseSignal === "object" &&
              slowResponseSignal !== null
                ? (slowResponseSignal as Readonly<Record<string, unknown>>)
                : null;
            const validSlowResponseSignal =
              signalRecord !== null &&
              Object.keys(signalRecord).length === 2 &&
              typeof signalRecord.signalId === "string" &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
                signalRecord.signalId,
              ) &&
              signalRecord.thresholdMs === slowResponseThresholdMs
                ? {
                    signalId: signalRecord.signalId,
                    thresholdMs: slowResponseThresholdMs,
                  }
                : null;

            const tokenCache = globalThis as typeof globalThis & {
              __chatgptCleanerDeleteAccessToken?: unknown;
            };
            let accessToken = tokenCache.__chatgptCleanerDeleteAccessToken;
            if (typeof accessToken !== "string" || accessToken.length === 0) {
              let sessionResponse: Response;
              try {
                sessionResponse = await fetch(`${origin}${authSessionPath}`, {
                  method: "GET",
                  credentials: "include",
                  redirect: "manual",
                  headers: { accept: "application/json" },
                });
              } catch {
                return { kind: "network-failure" };
              }
              if (
                sessionResponse.redirected ||
                sessionResponse.type === "opaqueredirect" ||
                sessionResponse.status === 401 ||
                sessionResponse.status === 403
              ) {
                return { kind: "failure", reason: "authentication" };
              }
              if (!sessionResponse.ok) {
                return { kind: "failure", reason: "compatibility" };
              }
              let sessionBody: unknown;
              try {
                sessionBody = (await sessionResponse.json()) as unknown;
              } catch {
                return { kind: "failure", reason: "compatibility" };
              }
              accessToken =
                typeof sessionBody === "object" &&
                sessionBody !== null &&
                "accessToken" in sessionBody
                  ? sessionBody.accessToken
                  : undefined;
              if (typeof accessToken !== "string" || accessToken.length === 0) {
                return { kind: "failure", reason: "authentication" };
              }
              tokenCache.__chatgptCleanerDeleteAccessToken = accessToken;
            }

            const pathname = `${deleteConversationPathPrefix}${encodeURIComponent(record.conversationId)}`;
            let response: Response;
            let slowResponseTimer: ReturnType<typeof setTimeout> | null = null;
            try {
              const responsePromise = fetch(new URL(pathname, origin).href, {
                method: "DELETE",
                credentials: "include",
                redirect: "manual",
                headers: {
                  accept: "application/json",
                  authorization: `Bearer ${accessToken}`,
                },
              });
              if (validSlowResponseSignal !== null) {
                slowResponseTimer = setTimeout(() => {
                  const extensionRuntime = (
                    globalThis as typeof globalThis & {
                      readonly chrome?: {
                        readonly runtime?: {
                          readonly lastError?: unknown;
                          sendMessage(
                            message: unknown,
                            callback: () => void,
                          ): void;
                        };
                      };
                    }
                  ).chrome?.runtime;
                  if (extensionRuntime === undefined) return;
                  extensionRuntime.sendMessage(
                    {
                      kind: slowResponseSignalKind,
                      signalId: validSlowResponseSignal.signalId,
                    },
                    () => {
                      void extensionRuntime.lastError;
                    },
                  );
                }, validSlowResponseSignal.thresholdMs);
              }
              response = await responsePromise;
            } catch {
              return { kind: "network-failure" };
            } finally {
              if (slowResponseTimer !== null) clearTimeout(slowResponseTimer);
            }
            if (response.status === 401 || response.status === 403) {
              tokenCache.__chatgptCleanerDeleteAccessToken = undefined;
            }
            let deleteResponseBody: unknown;
            if (response.status === 500) {
              try {
                deleteResponseBody = (await response.json()) as unknown;
              } catch {
                deleteResponseBody = undefined;
              }
            }
            const deleteResponseRecord =
              typeof deleteResponseBody === "object" &&
              deleteResponseBody !== null
                ? (deleteResponseBody as Readonly<Record<string, unknown>>)
                : null;
            return {
              kind: "response",
              status: response.status,
              retryAfter: response.headers.get("Retry-After"),
              redirected: response.redirected,
              responseType: response.type,
              contentType: response.headers.get("Content-Type"),
              deleteTimeout:
                response.status === 500 &&
                deleteResponseRecord?.detail === "Request timeout",
            };
          },
        });
      } finally {
        if (onResponseSlow !== undefined) {
          browser.runtime.onMessage.removeListener(receiveSlowResponseSignal);
        }
      }
    },
  };
}
