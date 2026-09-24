import { z } from "zod";
import { createAppError } from "../../application/AppError";
import type { Clock } from "../../application/ports/Clock";
import type { DeleteAttemptResult } from "../../application/ports/ConversationGateway";
import type { SourceTabValidationResult } from "../browser/SourceTab";
import { parseRetryAfter, READ_RETRY_AFTER_LIMIT_MS } from "./readRetry";
import { parseSafetyCriticalIdentifier } from "./readValidation";

export const DELETE_CONVERSATION_PATH = "/backend-api/conversation/id/";

export interface DeleteConversationOperation {
  readonly kind: "delete-conversation";
  readonly conversationId: string;
}

export interface DeleteSourceTabValidator {
  validate(): Promise<SourceTabValidationResult>;
}

export interface PageContextDeleteExecutor {
  execute(
    tabId: number,
    operation: DeleteConversationOperation,
  ): Promise<unknown>;
}

const responseEnvelopeSchema = z
  .object({
    kind: z.literal("response"),
    status: z.number().int().min(0).max(599),
    retryAfter: z.string().nullable(),
    redirected: z.boolean(),
    responseType: z.string(),
    contentType: z.string().nullable(),
  })
  .strict();

const executionEnvelopeSchema = z
  .array(
    z.object({
      result: z.discriminatedUnion("kind", [
        responseEnvelopeSchema,
        z.object({ kind: z.literal("network-failure") }).strict(),
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
  const parsedId = parseSafetyCriticalIdentifier(conversationId);
  if (parsedId === null || !/^[A-Za-z0-9_-]+$/u.test(parsedId)) return null;
  return { kind: "delete-conversation", conversationId: parsedId };
}

export function classifyDeleteResponse(input: {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly redirected: boolean;
  readonly responseType: string;
  readonly contentType: string | null;
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
        operation: "conversation.delete",
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
          operation: "conversation.delete",
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
      input.retryAfterMs > READ_RETRY_AFTER_LIMIT_MS
    ) {
      return {
        kind: "fatal",
        reason: "retry-later",
        error: createAppError("RateLimited", {
          operation: "conversation.delete",
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
  if (input.status >= 500 && input.status < 600) {
    return { kind: "retryable", reason: "server", status: input.status };
  }
  if (input.status === 401) {
    return {
      kind: "fatal",
      reason: "authentication",
      error: createAppError("AuthenticationUnavailable", {
        operation: "conversation.delete",
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
        operation: "conversation.delete",
        httpStatus: input.status,
      }),
      status: input.status,
    };
  }
  return {
    kind: "fatal",
    reason: "client",
    error: createAppError("ApiCompatibilityFailure", {
      operation: "conversation.delete",
      httpStatus: input.status,
    }),
    status: input.status,
  };
}

export class PageContextDeleteTransport {
  public constructor(
    private readonly sourceTab: DeleteSourceTabValidator,
    private readonly executor: PageContextDeleteExecutor,
    private readonly clock: Clock,
  ) {}

  public async deleteConversation(
    conversationId: string,
  ): Promise<DeleteAttemptResult> {
    const operation = createDeleteConversationOperation(conversationId);
    if (operation === null) return compatibilityFailure();

    const source = await this.sourceTab.validate();
    if (source.kind !== "valid") {
      return {
        kind: "fatal",
        reason: "source-unavailable",
        error: createAppError("SourceTabUnavailable", {
          operation: "conversation.delete",
        }),
      };
    }

    let rawResult: unknown;
    try {
      rawResult = await this.executor.execute(source.tabId, operation);
    } catch {
      const revalidatedSource = await this.sourceTab.validate();
      if (revalidatedSource.kind !== "valid") {
        return {
          kind: "fatal",
          reason: "source-unavailable",
          error: createAppError("SourceTabUnavailable", {
            operation: "conversation.delete",
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
            operation: "conversation.delete",
          }),
        };
      }
      if (result.reason === "authentication") {
        return {
          kind: "fatal",
          reason: "authentication",
          error: createAppError("AuthenticationUnavailable", {
            operation: "conversation.delete",
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
    });
  }
}

function compatibilityFailure(): DeleteAttemptResult {
  return {
    kind: "fatal",
    reason: "response-anomaly",
    error: createAppError("ApiCompatibilityFailure", {
      operation: "conversation.delete",
    }),
  };
}

export function createChromePageContextDeleteExecutor(): PageContextDeleteExecutor {
  return {
    execute: (tabId, operation) => {
      if (
        createDeleteConversationOperation(operation.conversationId) === null
      ) {
        return Promise.resolve([
          { result: { kind: "failure", reason: "compatibility" } },
        ]);
      }
      return browser.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        args: [operation],
        func: async (narrowOperation: DeleteConversationOperation) => {
          const origin = "https://chatgpt.com";
          const operationRecord: unknown = narrowOperation;
          const record =
            typeof operationRecord === "object" && operationRecord !== null
              ? (operationRecord as Readonly<Record<string, unknown>>)
              : null;
          if (
            record?.kind !== "delete-conversation" ||
            typeof record.conversationId !== "string" ||
            record.conversationId.length < 1 ||
            record.conversationId.length > 512 ||
            !/^[A-Za-z0-9_-]+$/u.test(record.conversationId) ||
            Object.keys(record).length !== 2
          ) {
            return { kind: "failure", reason: "compatibility" };
          }
          if (window.location.origin !== origin) {
            return { kind: "failure", reason: "source-unavailable" };
          }

          const tokenCache = globalThis as typeof globalThis & {
            __chatgptCleanerDeleteAccessToken?: unknown;
          };
          let accessToken = tokenCache.__chatgptCleanerDeleteAccessToken;
          if (typeof accessToken !== "string" || accessToken.length === 0) {
            let sessionResponse: Response;
            try {
              sessionResponse = await fetch(`${origin}/api/auth/session`, {
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

          const pathname = `/backend-api/conversation/id/${encodeURIComponent(record.conversationId)}`;
          let response: Response;
          try {
            response = await fetch(new URL(pathname, origin).href, {
              method: "DELETE",
              credentials: "include",
              redirect: "manual",
              headers: {
                accept: "application/json",
                authorization: `Bearer ${accessToken}`,
              },
            });
          } catch {
            return { kind: "network-failure" };
          }
          if (response.status === 401 || response.status === 403) {
            tokenCache.__chatgptCleanerDeleteAccessToken = undefined;
          }
          return {
            kind: "response",
            status: response.status,
            retryAfter: response.headers.get("Retry-After"),
            redirected: response.redirected,
            responseType: response.type,
            contentType: response.headers.get("Content-Type"),
          };
        },
      });
    },
  };
}
