import { z } from "zod";
import type { ReadAttemptResult } from "./readRetry";
import { createReadDiagnostic } from "./readDiagnostics";

export interface ReadTransportPayload {
  readonly body: unknown;
  readonly httpStatus: number;
  readonly timing: ReadPageTiming;
}

export interface ReadPageTiming {
  readonly sourceTabMs: number;
  readonly executeScriptMs: number;
  readonly authSessionMs: number;
  readonly backendFetchMs: number;
  readonly jsonParseMs: number;
}

export type PageReadOperation =
  | {
      readonly kind: "standalone";
      readonly offset: number;
      readonly pageLimit: number;
      readonly paginationStep: number;
    }
  | {
      readonly kind: "projects";
      readonly ownedOnly: true;
      readonly conversationsPerGizmo: 0;
      readonly cursor: string;
      readonly paginationStep: number;
    }
  | {
      readonly kind: "project-conversations";
      readonly projectId: string;
      readonly cursor: string;
      readonly paginationStep: number;
    };

const pageExecutionWorlds = ["ISOLATED", "MAIN"] as const;
export type PageExecutionWorld = (typeof pageExecutionWorlds)[number];

const pageExecutionWorldSchema = z.enum(pageExecutionWorlds);

export interface PageScriptRunner {
  execute(
    tabId: number,
    world: PageExecutionWorld,
    operation: PageReadOperation,
  ): Promise<unknown>;
}

export interface PageContextReadExecutor {
  beginInventoryRun?(): void;
  fetchStandalonePage(
    tabId: number,
    offset: number,
    paginationStep?: number,
  ): Promise<unknown>;
  fetchProjectsPage(
    tabId: number,
    cursor: string | null,
    paginationStep?: number,
  ): Promise<unknown>;
  fetchProjectConversationsPage(
    tabId: number,
    projectId: string,
    cursor: string | null,
    paginationStep?: number,
  ): Promise<unknown>;
}

export function createProjectDiscoveryOperation(
  cursor: string | null | undefined,
  paginationStep: number,
): Extract<PageReadOperation, { readonly kind: "projects" }> {
  return {
    kind: "projects",
    ownedOnly: true,
    conversationsPerGizmo: 0,
    cursor: cursor ?? "",
    paginationStep,
  };
}

export function createProjectConversationOperation(
  projectId: string,
  cursor: string | null | undefined,
  paginationStep: number,
): Extract<PageReadOperation, { readonly kind: "project-conversations" }> {
  return {
    kind: "project-conversations",
    projectId,
    cursor: cursor ?? "",
    paginationStep,
  };
}

const pageResponseSchema = z.object({
  kind: z.literal("response"),
  status: z.number().int().min(100).max(599),
  body: z.unknown(),
  retryAfter: z.string().nullable(),
  redirected: z.boolean(),
  contentType: z.string().nullable(),
  jsonParsed: z.boolean(),
  timing: z
    .object({
      executeScriptMs: z.number().nonnegative().optional(),
      authSessionMs: z.number().nonnegative().optional(),
      backendFetchMs: z.number().nonnegative().optional(),
      jsonParseMs: z.number().nonnegative().optional(),
    })
    .optional(),
});

const transportErrorSchema = z.object({
  kind: z.literal("transport-error"),
  phase: z.enum(["before-fetch", "fetch"]).optional(),
  stage: z
    .enum([
      "FUNCTION_ENTERED",
      "URL_BUILT",
      "FETCH_START",
      "FETCH_THROWN",
      "FETCH_RETURNED",
      "BODY_READ_START",
      "BODY_READ_FAILED",
      "JSON_PARSE_FAILED",
      "RETURN_RESPONSE_ENVELOPE",
    ])
    .optional(),
  errorName: z.string(),
  errorMessage: z.string(),
  requestPathname: z.string().optional(),
  world: pageExecutionWorldSchema.optional(),
  status: z.number().int().min(100).max(599).optional(),
  redirected: z.boolean().optional(),
  contentType: z.string().nullable().optional(),
});

export const executionResultSchema = z
  .array(
    z.object({
      result: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("network-error") }),
        z.object({
          kind: z.literal("failure"),
          reason: z.enum([
            "source-unavailable",
            "compatibility",
            "authentication",
          ]),
          stage: z.string().optional(),
          errorName: z.string().optional(),
          errorMessage: z.string().optional(),
          requestPathname: z.string().optional(),
          world: pageExecutionWorldSchema.optional(),
          status: z.number().int().min(100).max(599).optional(),
          redirected: z.boolean().optional(),
          contentType: z.string().nullable().optional(),
        }),
        transportErrorSchema,
        pageResponseSchema,
      ]),
    }),
  )
  .length(1);

export function sourceFailure(): Extract<
  ReadAttemptResult<ReadTransportPayload>,
  { readonly kind: "failure" }
> {
  return { kind: "failure", reason: "source-unavailable" };
}

function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" || mediaType?.endsWith("+json") === true
  );
}

export function normalizeExecutionResult(
  rawResult: unknown,
  operation: PageReadOperation["kind"],
  paginationStep: number,
  sourceTabMs: number,
): ReadAttemptResult<ReadTransportPayload> {
  const parsed = executionResultSchema.safeParse(rawResult);
  if (!parsed.success || parsed.data[0]?.result === undefined) {
    return {
      kind: "failure",
      reason: "compatibility",
      diagnostic: createReadDiagnostic({
        operation,
        paginationStep,
        category: "response-contract",
        jsonParsed: false,
        fieldPath: "executionResult",
        expectedType: "single page execution result",
        actualType: "non-json",
      }),
    };
  }

  const result = parsed.data[0].result;
  if (result.kind === "network-error") {
    return { kind: "network-error" };
  }
  if (result.kind === "transport-error") {
    if (
      result.stage !== "BODY_READ_FAILED" &&
      result.stage !== "JSON_PARSE_FAILED"
    ) {
      return { kind: "network-error" };
    }
    return {
      kind: "failure",
      reason: "compatibility",
      diagnostic: createReadDiagnostic({
        operation,
        paginationStep,
        category: "response-format",
        ...(result.status === undefined ? {} : { httpStatus: result.status }),
        jsonParsed: false,
        fieldPath: result.stage,
        expectedType: "valid JSON response",
        actualType: "non-json",
      }),
    };
  }
  if (result.kind === "failure") {
    return { kind: "failure", reason: result.reason };
  }
  if (result.redirected) {
    return { kind: "failure", reason: "authentication" };
  }
  if (result.status < 200 || result.status >= 300) {
    return {
      ...result,
      body: {
        body: result.body,
        httpStatus: result.status,
        timing: {
          sourceTabMs,
          executeScriptMs: result.timing?.executeScriptMs ?? 0,
          authSessionMs: result.timing?.authSessionMs ?? 0,
          backendFetchMs: result.timing?.backendFetchMs ?? 0,
          jsonParseMs: result.timing?.jsonParseMs ?? 0,
        },
      },
    };
  }
  if (!isJsonContentType(result.contentType) || !result.jsonParsed) {
    return {
      kind: "failure",
      reason: "compatibility",
      diagnostic: createReadDiagnostic({
        operation,
        paginationStep,
        category: "response-format",
        httpStatus: result.status,
        jsonParsed: result.jsonParsed,
        fieldPath: "response",
        expectedType: "JSON response",
        actualType: result.jsonParsed ? "object" : "non-json",
      }),
    };
  }
  return {
    ...result,
    body: {
      body: result.body,
      httpStatus: result.status,
      timing: {
        sourceTabMs,
        executeScriptMs: result.timing?.executeScriptMs ?? 0,
        authSessionMs: result.timing?.authSessionMs ?? 0,
        backendFetchMs: result.timing?.backendFetchMs ?? 0,
        jsonParseMs: result.timing?.jsonParseMs ?? 0,
      },
    },
  };
}

export function requiresMainWorld(rawResult: unknown): boolean {
  const parsed = executionResultSchema.safeParse(rawResult);
  if (!parsed.success || parsed.data[0]?.result === undefined) return false;
  const result = parsed.data[0].result;
  if (result.kind === "failure") return result.reason === "authentication";
  return (
    result.kind === "response" &&
    (result.status === 401 || result.status === 403 || result.redirected)
  );
}

export function projectDiscoveryHasResponseEnvelope(
  rawResult: unknown,
): boolean {
  const parsed = executionResultSchema.safeParse(rawResult);
  return parsed.success && parsed.data[0]?.result.kind === "response";
}

export function hasSuccessfulResponse(rawResult: unknown): boolean {
  const parsed = executionResultSchema.safeParse(rawResult);
  const result = parsed.success ? parsed.data[0]?.result : undefined;
  return (
    result?.kind === "response" &&
    result.status >= 200 &&
    result.status < 300 &&
    !result.redirected
  );
}
