import {
  ChatGptOperation,
  PROJECT_CONVERSATION_INITIAL_CURSOR,
  STANDALONE_CONVERSATION_PAGE_LIMIT,
} from "application/ports/ConversationGateway";
import { AppConfig } from "config";
import { ApiRequestLifecycleEvent } from "application/ports/Observability";
import {
  executionResultSchema,
  hasSuccessfulResponse,
  projectDiscoveryHasResponseEnvelope,
  requiresMainWorld,
  type PageContextReadExecutor,
  type PageExecutionWorld,
  type PageReadOperation,
  type PageScriptRunner,
} from "./PageContextReadContracts";
import { logger } from "infrastructure/observability/logger";

export class IsolatedFirstPageContextReadExecutor implements PageContextReadExecutor {
  private readonly successfulWorlds = new Map<
    PageReadOperation["kind"],
    PageExecutionWorld
  >();

  public constructor(
    private readonly runner: PageScriptRunner,
    private readonly projectConversationPageSize: number = AppConfig.inventory
      .projectConversationPageSize,
  ) {
    if (
      !Number.isSafeInteger(projectConversationPageSize) ||
      projectConversationPageSize <= 0
    ) {
      throw new RangeError(
        "Project conversation page size must be a positive integer",
      );
    }
  }

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
      paginationStep,
    });
  }

  public fetchProjectsPage(
    tabId: number,
    cursor: string | null,
    paginationStep = 1,
  ): Promise<unknown> {
    return this.execute(tabId, {
      kind: "projects",
      cursor: cursor ?? "",
      paginationStep,
    });
  }

  public fetchProjectConversationsPage(
    tabId: number,
    projectId: string,
    cursor: string | null,
    paginationStep = 1,
  ): Promise<unknown> {
    return this.execute(tabId, {
      kind: "project-conversations",
      projectId,
      cursor: cursor ?? PROJECT_CONVERSATION_INITIAL_CURSOR,
      projectConversationPageSize: this.projectConversationPageSize,
      paginationStep,
    });
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
      let rawExecutionResult: unknown;
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
            const projectDiscoveryOwnedOnly = true;
            const projectDiscoveryConversationsPerGizmo = 0;
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
                  };
                }
                return { kind: "failure", reason: "authentication" };
              }

              const requestSessionToken =
                async (): Promise<AccessTokenResult> => {
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
                  return { kind: "success", accessToken };
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
                }
              | {
                  readonly kind: "failure";
                  readonly reason: "authentication";
                }
            > => {
              const requestWithToken = async (
                accessToken: string,
              ): Promise<Response> =>
                fetch(requestUrl.href, {
                  method: "GET",
                  credentials: "include",
                  redirect: "follow",
                  headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${accessToken}`,
                  },
                });

              let session = await loadAccessToken(false);
              if (session.kind === "failure") return session;
              let response = await requestWithToken(session.accessToken);
              if (response.status === 401 || response.status === 403) {
                if (executionWorld === "ISOLATED") {
                  isolatedTokenCache.__chatgptCleanerReadAccessToken =
                    undefined;
                }
                session = await loadAccessToken(true);
                if (session.kind === "failure") return session;
                response = await requestWithToken(session.accessToken);
              }
              return {
                kind: "response",
                response,
              };
            };

            let pathname: string;
            let query: Readonly<Record<string, string>>;
            if (
              narrowOperation.kind === "standalone" &&
              Number.isSafeInteger(narrowOperation.offset) &&
              narrowOperation.offset >= 0
            ) {
              pathname = "/backend-api/conversations";
              query = {
                offset: String(narrowOperation.offset),
                limit: String(standalonePageLimit),
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
                owned_only: String(projectDiscoveryOwnedOnly),
                conversations_per_gizmo: String(
                  projectDiscoveryConversationsPerGizmo,
                ),
                ...(narrowOperation.cursor.length === 0
                  ? {}
                  : { cursor: narrowOperation.cursor }),
              };
            } else if (
              receivedArgRecord !== null &&
              narrowOperation.kind === "project-conversations" &&
              typeof narrowOperation.projectId === "string" &&
              narrowOperation.projectId.trim().length > 0 &&
              narrowOperation.projectId.length <= maximumIdentifierLength &&
              typeof narrowOperation.cursor === "string" &&
              narrowOperation.cursor.length <= maximumCursorLength &&
              typeof receivedArgRecord.projectConversationPageSize ===
                "number" &&
              Number.isSafeInteger(
                receivedArgRecord.projectConversationPageSize,
              ) &&
              receivedArgRecord.projectConversationPageSize > 0 &&
              typeof narrowOperation.paginationStep === "number" &&
              Number.isSafeInteger(narrowOperation.paginationStep) &&
              narrowOperation.paginationStep > 0
            ) {
              pathname = `/backend-api/gizmos/${encodeURIComponent(narrowOperation.projectId)}/conversations`;
              query = {
                cursor: narrowOperation.cursor,
                limit: String(receivedArgRecord.projectConversationPageSize),
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
              try {
                const fetchResult = await apiFetch(url);
                if (fetchResult.kind === "failure") return fetchResult;
                response = fetchResult.response;
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
              };
            } catch {
              return { kind: "network-error" };
            }
          },
        });
      } catch (error) {
        logger.warn(ApiRequestLifecycleEvent.Failed, {
          operation:
            operation.kind === "standalone"
              ? ChatGptOperation.StandaloneConversationsList
              : operation.kind === "projects"
                ? ChatGptOperation.ProjectsList
                : ChatGptOperation.ProjectConversationsList,
          page: operation.paginationStep,
          world,
          stage: `${world}_EXECUTE_SCRIPT_REJECTED`,
          responseReceived: false,
        });
        throw error;
      }

      const parsed = executionResultSchema.safeParse(rawExecutionResult);
      const result = parsed.success ? parsed.data[0]?.result : undefined;
      let failureStage: string | null = null;
      if (!Array.isArray(rawExecutionResult)) {
        failureStage = `${world}_EXECUTE_SCRIPT_RESULT_NOT_ARRAY`;
      } else if (rawExecutionResult.length === 0) {
        failureStage = `${world}_EXECUTE_SCRIPT_RESULT_EMPTY`;
      } else if (rawExecutionResult[0] === undefined) {
        failureStage = `${world}_EXECUTE_SCRIPT_RESULT_ENTRY_MISSING`;
      } else if (
        typeof rawExecutionResult[0] !== "object" ||
        rawExecutionResult[0] === null ||
        !("result" in rawExecutionResult[0])
      ) {
        failureStage = `${world}_EXECUTE_SCRIPT_RESULT_PROPERTY_MISSING`;
      } else if (Reflect.get(rawExecutionResult[0], "result") === undefined) {
        failureStage = `${world}_EXECUTE_SCRIPT_RESULT_UNDEFINED`;
      } else if (!parsed.success) {
        failureStage = `${world}_EXECUTE_SCRIPT_RESULT_MALFORMED`;
      } else if (result?.kind === "transport-error") {
        failureStage = `${world}_${result.stage ?? "TRANSPORT_ERROR"}`;
      } else if (result?.kind === "network-error") {
        failureStage = `${world}_TRANSPORT_ERROR`;
      } else if (result?.kind === "failure") {
        failureStage = `${world}_INJECTED_FAILURE`;
      }
      if (failureStage !== null) {
        logger.warn(ApiRequestLifecycleEvent.Failed, {
          operation:
            operation.kind === "standalone"
              ? ChatGptOperation.StandaloneConversationsList
              : operation.kind === "projects"
                ? ChatGptOperation.ProjectsList
                : ChatGptOperation.ProjectConversationsList,
          page: operation.paginationStep,
          world,
          stage: failureStage,
          responseReceived: false,
        });
      }
      return rawExecutionResult;
    },
  };
}

export function createChromePageContextReadExecutor(
  projectConversationPageSize: number = AppConfig.inventory
    .projectConversationPageSize,
): PageContextReadExecutor {
  return new IsolatedFirstPageContextReadExecutor(
    createChromePageScriptRunner(),
    projectConversationPageSize,
  );
}
