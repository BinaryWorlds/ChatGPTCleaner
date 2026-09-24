import { z } from "zod";
import { STANDALONE_PAGE_LIMIT } from "./readLimits";
import type { Clock } from "../../application/ports/Clock";
import type { ReadResult } from "../../application/ports/ConversationGateway";
import type { SourceTabValidator } from "./ProductionConversationGateway";
import { executeReadWithRetry, type ReadAttemptResult } from "./readRetry";
import { createReadDiagnostic } from "./readDiagnostics";
import {
  logReadEvent,
  safeExternalErrorName,
} from "../observability/readLogging";
import { createOperationId, logger } from "../observability/logger";

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

export type PageExecutionWorld = "ISOLATED" | "MAIN";

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

function debugRequest(operation: PageReadOperation): {
  readonly endpoint: string;
  readonly query: Readonly<Record<string, string | number | boolean>>;
} {
  if (operation.kind === "standalone") {
    return {
      endpoint: "/backend-api/conversations",
      query: {
        offset: operation.offset,
        limit: operation.pageLimit,
        order: "updated",
        is_archived: false,
        is_starred: false,
      },
    };
  }
  if (operation.kind === "projects") {
    return {
      endpoint: "/backend-api/gizmos/snorlax/sidebar",
      query: {
        owned_only: operation.ownedOnly,
        conversations_per_gizmo: operation.conversationsPerGizmo,
        ...(operation.cursor.length === 0 ? {} : { cursor: "<present>" }),
      },
    };
  }
  return {
    endpoint: "/backend-api/gizmos/{project-id}/conversations",
    query: {
      cursor: operation.cursor.length === 0 ? "0" : "<present>",
      limit: 5,
      owned_only: true,
    },
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
  ok: z.boolean().optional(),
  responseType: z.string().optional(),
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
  world: z.enum(["ISOLATED", "MAIN"]).optional(),
  status: z.number().int().min(100).max(599).optional(),
  redirected: z.boolean().optional(),
  contentType: z.string().nullable().optional(),
});

const jsonErrorSchema = z.object({
  kind: z.literal("json-error"),
  phase: z.enum(["body-read", "json-parse"]),
  status: z.number().int().min(100).max(599),
  contentType: z.string().nullable(),
  errorName: z.string(),
  errorMessage: z.string(),
});

const executionResultSchema = z
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
          world: z.enum(["ISOLATED", "MAIN"]).optional(),
          status: z.number().int().min(100).max(599).optional(),
          redirected: z.boolean().optional(),
          contentType: z.string().nullable().optional(),
        }),
        transportErrorSchema,
        jsonErrorSchema,
        pageResponseSchema,
      ]),
    }),
  )
  .length(1);

function sourceFailure(): Extract<
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

function normalizeExecutionResult(
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
  if (result.kind === "json-error") {
    return {
      kind: "failure",
      reason: "compatibility",
      diagnostic: createReadDiagnostic({
        operation,
        paginationStep,
        category: "response-format",
        httpStatus: result.status,
        jsonParsed: false,
        fieldPath: result.phase,
        expectedType: "valid JSON response",
        actualType: "non-json",
      }),
    };
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

function requiresMainWorld(rawResult: unknown): boolean {
  const parsed = executionResultSchema.safeParse(rawResult);
  if (!parsed.success || parsed.data[0]?.result === undefined) return false;
  const result = parsed.data[0].result;
  if (result.kind === "failure") return result.reason === "authentication";
  return (
    result.kind === "response" &&
    (result.status === 401 || result.status === 403 || result.redirected)
  );
}

function projectDiscoveryHasResponseEnvelope(rawResult: unknown): boolean {
  const parsed = executionResultSchema.safeParse(rawResult);
  return parsed.success && parsed.data[0]?.result.kind === "response";
}

export class IsolatedFirstPageContextReadExecutor implements PageContextReadExecutor {
  private readonly successfulWorlds = new Map<
    PageReadOperation["kind"],
    PageExecutionWorld
  >();

  public constructor(private readonly runner: PageScriptRunner) {}

  public beginInventoryRun(): void {
    this.successfulWorlds.clear();
  }

  public fetchStandalonePage(
    tabId: number,
    offset: number,
    paginationStep = Math.floor(offset / STANDALONE_PAGE_LIMIT) + 1,
  ): Promise<unknown> {
    return this.execute(tabId, {
      kind: "standalone",
      offset,
      pageLimit: STANDALONE_PAGE_LIMIT,
      paginationStep,
    });
  }

  public fetchProjectsPage(
    tabId: number,
    cursor: string | null,
    paginationStep = 1,
  ): Promise<unknown> {
    return this.execute(
      tabId,
      createProjectDiscoveryOperation(cursor, paginationStep),
    );
  }

  public fetchProjectConversationsPage(
    tabId: number,
    projectId: string,
    cursor: string | null,
    paginationStep = 1,
  ): Promise<unknown> {
    return this.execute(
      tabId,
      createProjectConversationOperation(projectId, cursor, paginationStep),
    );
  }

  private async execute(
    tabId: number,
    operation: PageReadOperation,
  ): Promise<unknown> {
    const successfulWorld = this.successfulWorlds.get(operation.kind);
    if (successfulWorld !== undefined) {
      return this.runner.execute(tabId, successfulWorld, operation);
    }

    const isolatedResult = await this.runner.execute(
      tabId,
      "ISOLATED",
      operation,
    );
    if (hasSuccessfulResponse(isolatedResult)) {
      this.successfulWorlds.set(operation.kind, "ISOLATED");
      return isolatedResult;
    }
    if (operation.kind === "standalone") return isolatedResult;
    const authenticationFallback = requiresMainWorld(isolatedResult);
    const projectTransportFallback =
      operation.kind === "projects" &&
      !projectDiscoveryHasResponseEnvelope(isolatedResult);
    if (!authenticationFallback && !projectTransportFallback) {
      return isolatedResult;
    }

    const request = debugRequest(operation);
    logReadEvent({
      operation: operation.kind,
      page: operation.paginationStep,
      world: "ISOLATED",
      endpoint: request.endpoint,
      stage: projectTransportFallback
        ? "AUTH_OR_TRANSPORT_FALLBACK_TO_MAIN"
        : "AUTH_FALLBACK_TO_MAIN",
      reason: projectTransportFallback
        ? "ISOLATED produced no response envelope"
        : "ISOLATED returned 401, 403, or a redirect",
    });

    let mainResult: unknown;
    try {
      mainResult = await this.runner.execute(tabId, "MAIN", operation);
    } catch {
      return isolatedResult;
    }
    if (hasSuccessfulResponse(mainResult)) {
      this.successfulWorlds.set(operation.kind, "MAIN");
    }
    return mainResult;
  }
}

function hasSuccessfulResponse(rawResult: unknown): boolean {
  const parsed = executionResultSchema.safeParse(rawResult);
  const result = parsed.success ? parsed.data[0]?.result : undefined;
  return (
    result?.kind === "response" &&
    result.status >= 200 &&
    result.status < 300 &&
    !result.redirected
  );
}

export class PageContextReadTransport {
  private boundSourceTabId: number | null = null;
  private pendingSourceTabMs = 0;
  private operationId = createOperationId();

  public constructor(
    private readonly sourceTab: SourceTabValidator,
    private readonly executor: PageContextReadExecutor,
    private readonly clock: Clock,
  ) {}

  public async beginSafetyInventoryRead(): Promise<ReadResult<null>> {
    this.operationId = createOperationId();
    this.boundSourceTabId = null;
    this.executor.beginInventoryRun?.();
    logger.debug("sourceTab.validation.started", {
      operationId: this.operationId,
    });
    const startedAt = performance.now();
    const source = await this.sourceTab.validate();
    this.pendingSourceTabMs = performance.now() - startedAt;
    if (source.kind !== "valid") {
      logger.warn("sourceTab.validation.failed", {
        operationId: this.operationId,
        errorCode: "SOURCE_TAB_UNAVAILABLE",
      });
      return sourceFailure();
    }
    this.boundSourceTabId = source.tabId;
    logger.debug("sourceTab.validation.succeeded", {
      operationId: this.operationId,
      durationMs: Math.round(this.pendingSourceTabMs),
    });
    return { kind: "success", value: null };
  }

  public readStandalonePage(
    offset: number,
  ): Promise<ReadResult<ReadTransportPayload>> {
    const paginationStep = Math.floor(offset / STANDALONE_PAGE_LIMIT) + 1;
    return this.read("standalone", paginationStep, (tabId) =>
      this.executor.fetchStandalonePage(tabId, offset, paginationStep),
    );
  }

  public readProjectsPage(
    cursor: string | null,
    paginationStep = 1,
  ): Promise<ReadResult<ReadTransportPayload>> {
    return this.read("projects", paginationStep, (tabId) =>
      this.executor.fetchProjectsPage(tabId, cursor, paginationStep),
    );
  }

  public readProjectConversationPage(
    projectId: string,
    cursor: string | null,
    paginationStep = 1,
  ): Promise<ReadResult<ReadTransportPayload>> {
    return this.read("project-conversations", paginationStep, (tabId) =>
      this.executor.fetchProjectConversationsPage(
        tabId,
        projectId,
        cursor,
        paginationStep,
      ),
    );
  }

  private async read(
    operation: PageReadOperation["kind"],
    paginationStep: number,
    execute: (tabId: number) => Promise<unknown>,
  ): Promise<ReadResult<ReadTransportPayload>> {
    if (this.boundSourceTabId === null) {
      const sourceResult = await this.beginSafetyInventoryRead();
      if (sourceResult.kind === "failure") return sourceResult;
    }
    const sourceTabMs = this.pendingSourceTabMs;
    this.pendingSourceTabMs = 0;
    return executeReadWithRetry<ReadTransportPayload>({
      clock: this.clock,
      operationId: this.operationId,
      page: paginationStep,
      operation:
        operation === "standalone"
          ? "standaloneConversations.list"
          : operation === "projects"
            ? "projects.list"
            : "projectConversations.list",
      attempt: async () => {
        const sourceTabId = this.boundSourceTabId;
        if (sourceTabId === null) {
          logReadEvent({
            operation,
            page: paginationStep,
            stage: "REQUEST_NOT_STARTED",
            responseReceived: false,
            reason: "source tab was not validated for this inventory operation",
          });
          return sourceFailure();
        }

        let rawResult: unknown;
        try {
          rawResult = await execute(sourceTabId);
        } catch (error) {
          logReadEvent({
            operation,
            page: paginationStep,
            stage: "TRANSPORT_ERROR",
            responseReceived: false,
            errorName: safeExternalErrorName(error),
          });
          return { kind: "network-error" };
        }
        return normalizeExecutionResult(
          rawResult,
          operation,
          paginationStep,
          sourceTabMs,
        );
      },
    });
  }
}

function createChromePageScriptRunner(): PageScriptRunner {
  return {
    execute: async (tabId, world, operation) => {
      const request = debugRequest(operation);
      logReadEvent({
        operation: operation.kind,
        page: operation.paginationStep,
        world,
        endpoint: request.endpoint,
        query: request.query,
        stage: `${world}_EXECUTION_START`,
      });
      let rawExecutionResult: unknown;
      const executeScriptStartedAt = performance.now();
      try {
        rawExecutionResult = await browser.scripting.executeScript({
          target: { tabId },
          world,
          args: [operation, world],
          func: async (
            narrowOperation: PageReadOperation,
            executionWorld: PageExecutionWorld,
          ) => {
            const projectPathname = "/backend-api/gizmos/snorlax/sidebar";
            const targetOrigin = "https://chatgpt.com";
            const receivedArgs: unknown = narrowOperation;
            const receivedArgRecord =
              typeof receivedArgs === "object" && receivedArgs !== null
                ? (receivedArgs as Readonly<Record<string, unknown>>)
                : null;
            const projectDiscoveryArgumentsValid =
              receivedArgRecord?.kind === "projects" &&
              receivedArgRecord.ownedOnly === true &&
              receivedArgRecord.conversationsPerGizmo === 0 &&
              typeof receivedArgRecord.cursor === "string" &&
              receivedArgRecord.cursor.length <= 2_048 &&
              typeof receivedArgRecord.paginationStep === "number" &&
              Number.isSafeInteger(receivedArgRecord.paginationStep) &&
              receivedArgRecord.paginationStep > 0;
            if (window.location.origin !== targetOrigin) {
              if (narrowOperation.kind === "projects") {
                return {
                  kind: "failure",
                  reason: "source-unavailable",
                  stage: "FUNCTION_ENTERED",
                  errorName: "SourceOriginMismatch",
                  errorMessage:
                    "Source tab origin does not match https://chatgpt.com",
                  requestPathname: projectPathname,
                  world: executionWorld,
                };
              }
              return { kind: "failure", reason: "source-unavailable" };
            }

            const isolatedTokenCache = globalThis as typeof globalThis & {
              __chatgptCleanerReadAccessToken?: unknown;
              __chatgptCleanerReadAccessTokenPromise?: unknown;
            };
            type AccessTokenResult =
              | {
                  readonly kind: "success";
                  readonly accessToken: string;
                  readonly authSessionMs: number;
                }
              | {
                  readonly kind: "failure";
                  readonly reason: "authentication";
                };
            const loadAccessToken = async (
              forceRefresh: boolean,
            ): Promise<AccessTokenResult> => {
              const cachedAccessToken =
                executionWorld === "ISOLATED" && !forceRefresh
                  ? isolatedTokenCache.__chatgptCleanerReadAccessToken
                  : undefined;
              if (
                typeof cachedAccessToken === "string" &&
                cachedAccessToken.trim().length > 0
              ) {
                return {
                  kind: "success",
                  accessToken: cachedAccessToken,
                  authSessionMs: 0,
                };
              }

              const inFlightSession =
                isolatedTokenCache.__chatgptCleanerReadAccessTokenPromise;
              if (
                executionWorld === "ISOLATED" &&
                inFlightSession instanceof Promise
              ) {
                const sharedResult: unknown =
                  await (inFlightSession as Promise<unknown>);
                if (
                  typeof sharedResult === "object" &&
                  sharedResult !== null &&
                  "kind" in sharedResult &&
                  sharedResult.kind === "success" &&
                  "accessToken" in sharedResult &&
                  typeof sharedResult.accessToken === "string"
                ) {
                  return {
                    kind: "success",
                    accessToken: sharedResult.accessToken,
                    authSessionMs: 0,
                  };
                }
                return { kind: "failure", reason: "authentication" };
              }

              const requestSessionToken =
                async (): Promise<AccessTokenResult> => {
                  const sessionStartedAt = performance.now();
                  let sessionResponse: Response;
                  try {
                    sessionResponse = await fetch(
                      new URL("/api/auth/session", targetOrigin).href,
                      {
                        method: "GET",
                        credentials: "include",
                        redirect: "follow",
                        headers: { Accept: "application/json" },
                      },
                    );
                  } catch {
                    return { kind: "failure", reason: "authentication" };
                  }
                  const authSessionMs = performance.now() - sessionStartedAt;
                  if (!sessionResponse.ok || sessionResponse.redirected) {
                    return { kind: "failure", reason: "authentication" };
                  }
                  let sessionBody: unknown;
                  try {
                    sessionBody = JSON.parse(
                      await sessionResponse.text(),
                    ) as unknown;
                  } catch {
                    return { kind: "failure", reason: "authentication" };
                  }
                  if (typeof sessionBody !== "object" || sessionBody === null) {
                    return { kind: "failure", reason: "authentication" };
                  }
                  const accessToken =
                    "accessToken" in sessionBody
                      ? sessionBody.accessToken
                      : undefined;
                  if (
                    typeof accessToken !== "string" ||
                    accessToken.trim().length === 0
                  ) {
                    return { kind: "failure", reason: "authentication" };
                  }
                  return { kind: "success", accessToken, authSessionMs };
                };

              const sessionPromise = requestSessionToken();
              if (executionWorld === "ISOLATED") {
                isolatedTokenCache.__chatgptCleanerReadAccessTokenPromise =
                  sessionPromise;
              }
              const result = await sessionPromise;
              if (
                executionWorld === "ISOLATED" &&
                isolatedTokenCache.__chatgptCleanerReadAccessTokenPromise ===
                  sessionPromise
              ) {
                isolatedTokenCache.__chatgptCleanerReadAccessTokenPromise =
                  undefined;
                if (result.kind === "success") {
                  isolatedTokenCache.__chatgptCleanerReadAccessToken =
                    result.accessToken;
                }
              }
              return result;
            };
            const apiFetch = async (
              requestUrl: URL,
            ): Promise<
              | {
                  readonly kind: "response";
                  readonly response: Response;
                  readonly authSessionMs: number;
                  readonly backendFetchMs: number;
                }
              | {
                  readonly kind: "failure";
                  readonly reason: "authentication";
                }
            > => {
              const requestWithToken = async (
                accessToken: string,
              ): Promise<{
                readonly response: Response;
                readonly backendFetchMs: number;
              }> => {
                const startedAt = performance.now();
                const response = await fetch(requestUrl.href, {
                  method: "GET",
                  credentials: "include",
                  redirect: "follow",
                  headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${accessToken}`,
                  },
                });
                return {
                  response,
                  backendFetchMs: performance.now() - startedAt,
                };
              };

              let session = await loadAccessToken(false);
              if (session.kind === "failure") return session;
              let backend = await requestWithToken(session.accessToken);
              let authSessionMs = session.authSessionMs;
              let backendFetchMs = backend.backendFetchMs;
              if (
                backend.response.status === 401 ||
                backend.response.status === 403
              ) {
                if (executionWorld === "ISOLATED") {
                  isolatedTokenCache.__chatgptCleanerReadAccessToken =
                    undefined;
                }
                session = await loadAccessToken(true);
                if (session.kind === "failure") return session;
                authSessionMs += session.authSessionMs;
                backend = await requestWithToken(session.accessToken);
                backendFetchMs += backend.backendFetchMs;
              }
              return {
                kind: "response",
                response: backend.response,
                authSessionMs,
                backendFetchMs,
              };
            };

            let pathname: string;
            let query: Readonly<Record<string, string>>;
            if (
              narrowOperation.kind === "standalone" &&
              Number.isSafeInteger(narrowOperation.offset) &&
              narrowOperation.offset >= 0 &&
              narrowOperation.pageLimit === 100
            ) {
              pathname = "/backend-api/conversations";
              query = {
                offset: String(narrowOperation.offset),
                limit: String(narrowOperation.pageLimit),
                order: "updated",
                is_archived: "false",
                is_starred: "false",
              };
            } else if (
              narrowOperation.kind === "projects" &&
              projectDiscoveryArgumentsValid
            ) {
              pathname = projectPathname;
              query = {
                owned_only: String(narrowOperation.ownedOnly),
                conversations_per_gizmo: String(
                  narrowOperation.conversationsPerGizmo,
                ),
                ...(narrowOperation.cursor.length === 0
                  ? {}
                  : { cursor: narrowOperation.cursor }),
              };
            } else if (
              narrowOperation.kind === "project-conversations" &&
              typeof narrowOperation.projectId === "string" &&
              narrowOperation.projectId.trim().length > 0 &&
              narrowOperation.projectId.length <= 512 &&
              typeof narrowOperation.cursor === "string" &&
              narrowOperation.cursor.length <= 2_048 &&
              typeof narrowOperation.paginationStep === "number" &&
              Number.isSafeInteger(narrowOperation.paginationStep) &&
              narrowOperation.paginationStep > 0
            ) {
              pathname = `/backend-api/gizmos/${encodeURIComponent(narrowOperation.projectId)}/conversations`;
              query = {
                cursor:
                  narrowOperation.cursor.length === 0
                    ? "0"
                    : narrowOperation.cursor,
                limit: "5",
                owned_only: "true",
              };
            } else {
              if (narrowOperation.kind === "projects") {
                return {
                  kind: "failure",
                  reason: "compatibility",
                  stage: "FUNCTION_ENTERED",
                  errorName: "InvalidOperationArguments",
                  errorMessage:
                    "Project discovery operation arguments failed validation",
                  requestPathname: projectPathname,
                  world: executionWorld,
                };
              }
              if (narrowOperation.kind === "project-conversations") {
                return {
                  kind: "failure",
                  reason: "compatibility",
                  stage: "FUNCTION_ENTERED",
                  errorName: "InvalidOperationArguments",
                  errorMessage:
                    "Project conversation operation arguments failed validation",
                  requestPathname:
                    "/backend-api/gizmos/{project-id}/conversations",
                  world: executionWorld,
                };
              }
              return { kind: "failure", reason: "compatibility" };
            }

            let url: URL;
            try {
              url = new URL(pathname, targetOrigin);
              for (const [key, value] of Object.entries(query)) {
                url.searchParams.set(key, value);
              }
            } catch (error) {
              if (narrowOperation.kind !== "projects") throw error;
              const errorName =
                error instanceof Error ? error.name : "NonError";
              const errorMessage = "URL construction failed";
              return {
                kind: "transport-error",
                phase: "before-fetch",
                stage: "URL_BUILT",
                errorName,
                errorMessage,
                requestPathname: pathname,
                world: executionWorld,
              };
            }

            if (narrowOperation.kind === "projects") {
              let response: Response;
              let authSessionMs: number;
              let backendFetchMs: number;
              try {
                const fetchResult = await apiFetch(url);
                if (fetchResult.kind === "failure") return fetchResult;
                response = fetchResult.response;
                authSessionMs = fetchResult.authSessionMs;
                backendFetchMs = fetchResult.backendFetchMs;
              } catch (error) {
                const errorName =
                  error instanceof Error ? error.name : "NonError";
                const errorMessage = "Read request failed before a response";
                return {
                  kind: "transport-error",
                  phase: "fetch",
                  stage: "FETCH_THROWN",
                  errorName,
                  errorMessage,
                  requestPathname: pathname,
                  world: executionWorld,
                };
              }

              const contentType = response.headers.get("Content-Type");
              let responseText: string;
              const jsonParseStartedAt = performance.now();
              try {
                responseText = await response.text();
              } catch (error) {
                const errorName =
                  error instanceof Error ? error.name : "NonError";
                const errorMessage = "Response body could not be read";
                return {
                  kind: "transport-error",
                  stage: "BODY_READ_FAILED",
                  status: response.status,
                  redirected: response.redirected,
                  contentType,
                  errorName,
                  errorMessage,
                  requestPathname: pathname,
                  world: executionWorld,
                };
              }

              let parsedBody: unknown;
              try {
                parsedBody = JSON.parse(responseText) as unknown;
              } catch (error) {
                const errorName =
                  error instanceof Error ? error.name : "NonError";
                const errorMessage = "Response body was not valid JSON";
                return {
                  kind: "transport-error",
                  stage: "JSON_PARSE_FAILED",
                  status: response.status,
                  redirected: response.redirected,
                  contentType,
                  errorName,
                  errorMessage,
                  requestPathname: pathname,
                  world: executionWorld,
                };
              }

              return {
                kind: "response",
                status: response.status,
                ok: response.ok,
                redirected: response.redirected,
                responseType: response.type,
                contentType,
                body: response.ok ? parsedBody : null,
                retryAfter: response.headers.get("Retry-After"),
                jsonParsed: true,
                timing: {
                  authSessionMs,
                  backendFetchMs,
                  jsonParseMs: performance.now() - jsonParseStartedAt,
                },
              };
            }

            try {
              const fetchResult = await apiFetch(url);
              if (fetchResult.kind === "failure") return fetchResult;
              const response = fetchResult.response;
              const contentType = response.headers.get("Content-Type");
              const mediaType = contentType
                ?.split(";", 1)[0]
                ?.trim()
                .toLowerCase();
              const hasJsonContentType =
                mediaType === "application/json" ||
                mediaType?.endsWith("+json") === true;
              let body: unknown = null;
              let jsonParsed = false;
              const jsonParseStartedAt = performance.now();
              if (hasJsonContentType) {
                try {
                  body = (await response.json()) as unknown;
                  jsonParsed = true;
                } catch (error) {
                  body = null;
                  void error;
                }
              }
              return {
                kind: "response",
                status: response.status,
                body,
                retryAfter: response.headers.get("Retry-After"),
                redirected: response.redirected,
                contentType,
                jsonParsed,
                timing: {
                  authSessionMs: fetchResult.authSessionMs,
                  backendFetchMs: fetchResult.backendFetchMs,
                  jsonParseMs: performance.now() - jsonParseStartedAt,
                },
              };
            } catch {
              return { kind: "network-error" };
            }
          },
        });
        const executeScriptMs = performance.now() - executeScriptStartedAt;
        const parsedExecution =
          executionResultSchema.safeParse(rawExecutionResult);
        const parsedResult = parsedExecution.success
          ? parsedExecution.data[0]?.result
          : undefined;
        if (parsedResult?.kind === "response") {
          rawExecutionResult = [
            {
              result: {
                ...parsedResult,
                timing: {
                  ...parsedResult.timing,
                  executeScriptMs,
                },
              },
            },
          ];
        }
      } catch (error) {
        logReadEvent({
          operation: operation.kind,
          page: operation.paginationStep,
          world,
          endpoint: request.endpoint,
          stage: `${world}_EXECUTE_SCRIPT_REJECTED`,
          responseReceived: false,
          reason: "chrome.scripting.executeScript rejected",
          errorName: safeExternalErrorName(error),
        });
        throw error;
      }

      const parsed = executionResultSchema.safeParse(rawExecutionResult);
      const result = parsed.success ? parsed.data[0]?.result : undefined;
      let resultStage = `${world}_RESPONSE`;
      let resultReason: string | undefined;
      if (!Array.isArray(rawExecutionResult)) {
        resultStage = `${world}_EXECUTE_SCRIPT_RESULT_NOT_ARRAY`;
        resultReason = "executeScript result is not an array";
      } else if (rawExecutionResult.length === 0) {
        resultStage = `${world}_EXECUTE_SCRIPT_RESULT_EMPTY`;
        resultReason = "executeScript returned an empty array";
      } else if (rawExecutionResult[0] === undefined) {
        resultStage = `${world}_EXECUTE_SCRIPT_RESULT_ENTRY_MISSING`;
        resultReason = "executeScript result[0] is missing";
      } else if (
        typeof rawExecutionResult[0] !== "object" ||
        rawExecutionResult[0] === null ||
        !("result" in rawExecutionResult[0])
      ) {
        resultStage = `${world}_EXECUTE_SCRIPT_RESULT_PROPERTY_MISSING`;
        resultReason = "executeScript result[0].result is missing";
      } else if (Reflect.get(rawExecutionResult[0], "result") === undefined) {
        resultStage = `${world}_EXECUTE_SCRIPT_RESULT_UNDEFINED`;
        resultReason = "executeScript result[0].result is undefined";
      } else if (!parsed.success) {
        resultStage = `${world}_EXECUTE_SCRIPT_RESULT_MALFORMED`;
        resultReason = "executeScript result envelope failed validation";
      } else if (result?.kind === "transport-error") {
        resultStage = `${world}_${result.stage ?? "TRANSPORT_ERROR"}`;
        resultReason = `injected function reported ${result.stage ?? result.phase ?? "transport error"}`;
      } else if (result?.kind === "json-error") {
        resultStage =
          result.phase === "body-read"
            ? `${world}_BODY_READ_ERROR`
            : `${world}_JSON_PARSE_ERROR`;
        resultReason =
          result.phase === "body-read"
            ? "response body read threw"
            : "JSON parsing threw";
      } else if (result?.kind === "network-error") {
        resultStage = `${world}_TRANSPORT_ERROR`;
        resultReason = "legacy network-error envelope";
      } else if (result?.kind === "failure") {
        resultStage = `${world}_INJECTED_FAILURE`;
        resultReason = result.reason;
      }
      logReadEvent({
        operation: operation.kind,
        page: operation.paginationStep,
        world,
        endpoint: request.endpoint,
        stage: resultStage,
        responseReceived: result?.kind === "response",
        ...(resultReason === undefined ? {} : { reason: resultReason }),
        ...(result?.kind === "transport-error" || result?.kind === "json-error"
          ? { errorName: result.errorName }
          : {}),
        ...(result?.kind === "failure" && result.errorName !== undefined
          ? {
              errorName: result.errorName,
            }
          : {}),
        ...(result?.kind === "response"
          ? {
              status: result.status,
              ok: result.status >= 200 && result.status < 300,
              redirected: result.redirected,
              contentType: result.contentType,
              jsonParsed: result.jsonParsed,
            }
          : {}),
      });
      return rawExecutionResult;
    },
  };
}

export function createChromePageContextReadExecutor(): PageContextReadExecutor {
  return new IsolatedFirstPageContextReadExecutor(
    createChromePageScriptRunner(),
  );
}
