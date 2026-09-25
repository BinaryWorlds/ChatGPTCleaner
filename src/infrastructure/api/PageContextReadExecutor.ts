import { STANDALONE_CONVERSATION_PAGE_LIMIT } from "../../application/ports/ConversationGateway";
import {
  executionResultSchema,
  hasSuccessfulResponse,
  projectDiscoveryHasResponseEnvelope,
  requiresMainWorld,
  createProjectConversationOperation,
  createProjectDiscoveryOperation,
  type PageContextReadExecutor,
  type PageExecutionWorld,
  type PageReadOperation,
  type PageScriptRunner,
} from "./PageContextReadContracts";
import { logReadEvent } from "../observability/readLogging";

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
    paginationStep = Math.floor(offset / STANDALONE_CONVERSATION_PAGE_LIMIT) +
      1,
  ): Promise<unknown> {
    return this.execute(tabId, {
      kind: "standalone",
      offset,
      pageLimit: STANDALONE_CONVERSATION_PAGE_LIMIT,
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

    logReadEvent({
      operation: operation.kind,
      page: operation.paginationStep,
      world: "ISOLATED",
      stage: projectTransportFallback
        ? "AUTH_OR_TRANSPORT_FALLBACK_TO_MAIN"
        : "AUTH_FALLBACK_TO_MAIN",
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

function createChromePageScriptRunner(): PageScriptRunner {
  return {
    execute: async (tabId, world, operation) => {
      logReadEvent({
        operation: operation.kind,
        page: operation.paginationStep,
        world,
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
            const standalonePageLimit = 100;
            const projectConversationPageLimit = 5;
            const maximumIdentifierLength = 512;
            const maximumCursorLength = 2_048;
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
              receivedArgRecord.cursor.length <= maximumCursorLength &&
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
              narrowOperation.pageLimit === standalonePageLimit
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
              narrowOperation.projectId.length <= maximumIdentifierLength &&
              typeof narrowOperation.cursor === "string" &&
              narrowOperation.cursor.length <= maximumCursorLength &&
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
                limit: String(projectConversationPageLimit),
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
                redirected: response.redirected,
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
          stage: `${world}_EXECUTE_SCRIPT_REJECTED`,
          responseReceived: false,
        });
        throw error;
      }

      const parsed = executionResultSchema.safeParse(rawExecutionResult);
      const result = parsed.success ? parsed.data[0]?.result : undefined;
      let resultStage = `${world}_RESPONSE`;
      if (!Array.isArray(rawExecutionResult)) {
        resultStage = `${world}_EXECUTE_SCRIPT_RESULT_NOT_ARRAY`;
      } else if (rawExecutionResult.length === 0) {
        resultStage = `${world}_EXECUTE_SCRIPT_RESULT_EMPTY`;
      } else if (rawExecutionResult[0] === undefined) {
        resultStage = `${world}_EXECUTE_SCRIPT_RESULT_ENTRY_MISSING`;
      } else if (
        typeof rawExecutionResult[0] !== "object" ||
        rawExecutionResult[0] === null ||
        !("result" in rawExecutionResult[0])
      ) {
        resultStage = `${world}_EXECUTE_SCRIPT_RESULT_PROPERTY_MISSING`;
      } else if (Reflect.get(rawExecutionResult[0], "result") === undefined) {
        resultStage = `${world}_EXECUTE_SCRIPT_RESULT_UNDEFINED`;
      } else if (!parsed.success) {
        resultStage = `${world}_EXECUTE_SCRIPT_RESULT_MALFORMED`;
      } else if (result?.kind === "transport-error") {
        resultStage = `${world}_${result.stage ?? "TRANSPORT_ERROR"}`;
      } else if (result?.kind === "network-error") {
        resultStage = `${world}_TRANSPORT_ERROR`;
      } else if (result?.kind === "failure") {
        resultStage = `${world}_INJECTED_FAILURE`;
      }
      logReadEvent({
        operation: operation.kind,
        page: operation.paginationStep,
        world,
        stage: resultStage,
        responseReceived: result?.kind === "response",
        ...(result?.kind === "response"
          ? {
              status: result.status,
              redirected: result.redirected,
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
