import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSafetyInventory } from "../../application/inventory";
import { FakeClock } from "../fake/FakeClock";
import {
  IsolatedFirstPageContextReadExecutor,
  createChromePageContextReadExecutor,
} from "./PageContextReadExecutor";
import {
  createProjectConversationOperation,
  createProjectDiscoveryOperation,
  type PageContextReadExecutor,
  type PageReadOperation,
  type PageScriptRunner,
} from "./PageContextReadContracts";
import { PageContextReadTransport } from "./SourceBoundPageContextReadTransport";
import { ProductionConversationGateway } from "./ProductionConversationGateway";
import { STANDALONE_CONVERSATION_PAGE_LIMIT } from "../../application/ports/ConversationGateway";
import { MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH } from "../../domain/identifier";
import {
  MAX_PAGINATION_CURSOR_LENGTH,
  normalizeDisplayTitle,
  parsePaginationCursor,
  parseSafetyCriticalIdentifier,
} from "./readValidation";

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "__chatgptCleanerReadAccessToken");
});

describe("production read validation", () => {
  it("blocks malformed safety-critical identifiers and cursors", () => {
    expect(parseSafetyCriticalIdentifier("conversation-id")).toBe(
      "conversation-id",
    );
    expect(parseSafetyCriticalIdentifier(42)).toBeNull();
    expect(parseSafetyCriticalIdentifier("")).toBeNull();
    expect(parseSafetyCriticalIdentifier("   ")).toBeNull();
    expect(
      parseSafetyCriticalIdentifier(
        "a".repeat(MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH),
      ),
    ).not.toBeNull();
    expect(
      parseSafetyCriticalIdentifier(
        "a".repeat(MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH + 1),
      ),
    ).toBeNull();
    expect(parsePaginationCursor("next")).toBe("next");
    expect(parsePaginationCursor(null)).toBeNull();
    expect(parsePaginationCursor({ cursor: "next" })).toBe(false);
    expect(
      parsePaginationCursor("c".repeat(MAX_PAGINATION_CURSOR_LENGTH)),
    ).not.toBe(false);
    expect(
      parsePaginationCursor("c".repeat(MAX_PAGINATION_CURSOR_LENGTH + 1)),
    ).toBe(false);
  });

  it("degrades invalid display metadata without inventing values", () => {
    expect(normalizeDisplayTitle("Title")).toBe("Title");
    expect(normalizeDisplayTitle("  ")).toBe("(Untitled)");
    expect(normalizeDisplayTitle(null)).toBe("(Untitled)");
  });

  function gatewayWith(
    execute: (tabId: number, operation: PageReadOperation) => Promise<unknown>,
    sourceAvailable = true,
  ) {
    const source = {
      validate: vi
        .fn()
        .mockResolvedValue(
          sourceAvailable ? { kind: "valid", tabId: 7 } : { kind: "invalid" },
        ),
    };
    const executor: PageContextReadExecutor = {
      fetchStandalonePage: (tabId, offset, paginationStep = 1) =>
        execute(tabId, {
          kind: "standalone",
          offset,
          pageLimit: STANDALONE_CONVERSATION_PAGE_LIMIT,
          paginationStep,
        }),
      fetchProjectsPage: (tabId, cursor, paginationStep = 1) =>
        execute(tabId, createProjectDiscoveryOperation(cursor, paginationStep)),
      fetchProjectConversationsPage: (
        tabId,
        projectId,
        cursor,
        paginationStep = 1,
      ) =>
        execute(
          tabId,
          createProjectConversationOperation(projectId, cursor, paginationStep),
        ),
    };
    return new ProductionConversationGateway(
      new PageContextReadTransport(source, executor, new FakeClock()),
    );
  }

  function response(body: unknown): unknown {
    return [
      {
        result: {
          kind: "response",
          status: 200,
          body,
          retryAfter: null,
          redirected: false,
          contentType: "application/json",
          jsonParsed: true,
        },
      },
    ];
  }

  it("parses observed standalone fields and degrades display metadata", async () => {
    const requests: PageReadOperation[] = [];
    const gateway = gatewayWith((_tabId, operation) => {
      requests.push(operation);
      return Promise.resolve(
        response({
          items: [
            {
              id: "conversation-one",
              title: null,
              create_time: "2026-01-02T03:04:05Z",
              update_time: "not-a-date",
              ignored_extra_field: true,
            },
          ],
          total: 1,
          limit: 100,
          offset: 0,
          ignored_top_level_field: true,
        }),
      );
    });

    await expect(
      gateway.fetchStandaloneConversationPage(null),
    ).resolves.toEqual({
      kind: "success",
      value: {
        conversations: [
          {
            id: "conversation-one",
            title: "(Untitled)",
            createdAt: Date.parse("2026-01-02T03:04:05Z"),
            updatedAt: null,
          },
        ],
        nextCursor: null,
      },
    });
    expect(requests[0]).toEqual({
      kind: "standalone",
      offset: 0,
      pageLimit: 100,
      paginationStep: 1,
    });
  });

  it("continues on full pages despite changing totals and stops on a short page", async () => {
    const requestedOffsets: number[] = [];
    const totals = new Map([
      [0, 393],
      [100, 450],
      [200, 410],
      [300, 393],
    ]);
    const gateway = gatewayWith((_tabId, operation) => {
      if (operation.kind !== "standalone") {
        throw new Error("Expected standalone operation");
      }
      requestedOffsets.push(operation.offset);
      const itemCount = operation.offset === 300 ? 93 : 100;
      return Promise.resolve(
        response({
          items: Array.from({ length: itemCount }, (_, index) => ({
            id: `conversation-${operation.offset + index}`,
          })),
          total: totals.get(operation.offset),
          limit: 100,
          offset: operation.offset,
        }),
      );
    });

    let cursor: string | null = null;
    for (let page = 0; page < 4; page += 1) {
      const result = await gateway.fetchStandaloneConversationPage(cursor);
      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      cursor = result.value.nextCursor;
    }

    expect(requestedOffsets).toEqual([0, 100, 200, 300]);
    expect(cursor).toBeNull();
  });

  it("continues when the backend reports a smaller effective page limit", async () => {
    const requestedOffsets: number[] = [];
    const gateway = gatewayWith((_tabId, operation) => {
      if (operation.kind !== "standalone") {
        throw new Error("Expected standalone operation");
      }
      requestedOffsets.push(operation.offset);
      const itemCount = operation.offset === 56 ? 4 : 28;
      return Promise.resolve(
        response({
          items: Array.from({ length: itemCount }, (_, index) => ({
            id: `conversation-${operation.offset + index}`,
          })),
          total: 60,
          limit: 28,
          offset: operation.offset,
        }),
      );
    });

    let cursor: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const result = await gateway.fetchStandaloneConversationPage(cursor);
      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      cursor = result.value.nextCursor;
    }

    expect(requestedOffsets).toEqual([0, 28, 56]);
    expect(cursor).toBeNull();
  });

  it("completes Application inventory through production cursors with a smaller effective limit", async () => {
    const requestedOffsets: number[] = [];
    const gateway = gatewayWith((_tabId, operation) => {
      if (operation.kind === "projects") {
        return Promise.resolve(response({ items: [], cursor: null }));
      }
      if (operation.kind !== "standalone") {
        throw new Error("Unexpected Project conversation operation");
      }

      requestedOffsets.push(operation.offset);
      const itemCount = operation.offset === 56 ? 4 : 28;
      return Promise.resolve(
        response({
          items: Array.from({ length: itemCount }, (_, index) => ({
            id: `conversation-${operation.offset + index}`,
          })),
          total: 60,
          limit: 28,
          offset: operation.offset,
        }),
      );
    });

    const result = await loadSafetyInventory(gateway);

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.inventory.standaloneConversations).toHaveLength(60);
    expect(requestedOffsets).toEqual([0, 28, 56]);
  });

  it("uses a changing total only as a hint that a non-empty short page has more", async () => {
    const gateway = gatewayWith((_tabId, operation) => {
      if (operation.kind !== "standalone") {
        throw new Error("Expected standalone operation");
      }
      return Promise.resolve(
        response({
          items:
            operation.offset === 0
              ? Array.from({ length: 28 }, (_, index) => ({
                  id: `conversation-${index}`,
                }))
              : [],
          total: operation.offset === 0 ? 1_600 : 28,
          limit: 100,
          offset: operation.offset,
        }),
      );
    });

    const first = await gateway.fetchStandaloneConversationPage(null);
    expect(first).toMatchObject({
      kind: "success",
      value: { nextCursor: "28" },
    });
    const second = await gateway.fetchStandaloneConversationPage("28");
    expect(second).toMatchObject({
      kind: "success",
      value: { nextCursor: null },
    });
  });

  it("blocks malformed standalone IDs and pagination metadata", async () => {
    const malformedId = gatewayWith(() =>
      Promise.resolve(
        response({
          items: [{ title: "private-title-must-not-leak" }],
          total: 1,
          limit: 100,
          offset: 0,
        }),
      ),
    );
    const malformedResult =
      await malformedId.fetchStandaloneConversationPage(null);
    expect(malformedResult).toMatchObject({
      kind: "failure",
      reason: "compatibility",
      diagnostic: {
        operation: "standalone",
        endpointFamily: "/backend-api/conversations",
        paginationStep: 1,
        fieldPath: "items[0].id",
        expectedType: "string",
        actualType: "absent",
        missingRequiredField: "id",
      },
    });
    expect(JSON.stringify(malformedResult)).not.toContain(
      "private-title-must-not-leak",
    );

    const wrongOffset = gatewayWith(() =>
      Promise.resolve(response({ items: [], total: 0, limit: 100, offset: 1 })),
    );
    await expect(
      wrongOffset.fetchStandaloneConversationPage(null),
    ).resolves.toMatchObject({ kind: "failure", reason: "compatibility" });
  });

  it("enumerates and deduplicates observed nested Project IDs", async () => {
    const gateway = gatewayWith((_tabId, operation) =>
      Promise.resolve(
        response(
          operation.kind === "projects" && operation.cursor.length === 0
            ? {
                items: [
                  { gizmo: { gizmo: { id: "project-one" } } },
                  { gizmo: { gizmo: { id: "project-one" } } },
                ],
                cursor: "next-page",
              }
            : {
                items: [{ gizmo: { gizmo: { id: "project-two" } } }],
                cursor: null,
              },
        ),
      ),
    );
    await expect(gateway.fetchProjects()).resolves.toMatchObject({
      kind: "success",
      value: [{ id: "project-one" }, { id: "project-two" }],
    });
  });

  it("keeps Project discovery pagination sequential", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    let activeReads = 0;
    let maxActiveReads = 0;
    const gateway = gatewayWith((_tabId, operation) => {
      if (operation.kind !== "projects") {
        throw new Error("Expected Project discovery operation");
      }
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      return new Promise((resolve) => {
        pending.set(operation.cursor, (value) => {
          activeReads -= 1;
          resolve(value);
        });
      });
    });

    const loading = gateway.fetchProjects();
    await Promise.resolve();
    await Promise.resolve();
    expect([...pending.keys()]).toEqual([""]);
    pending.get("")?.(
      response({
        items: [{ gizmo: { gizmo: { id: "project-one" } } }],
        cursor: "next",
      }),
    );
    await vi.waitFor(() => {
      expect([...pending.keys()]).toEqual(["", "next"]);
    });
    pending.get("next")?.(response({ items: [], cursor: null }));

    await expect(loading).resolves.toMatchObject({ kind: "success" });
    expect(maxActiveReads).toBe(1);
  });

  it("blocks Project discovery cursor non-progress", async () => {
    const gateway = gatewayWith(() =>
      Promise.resolve(
        response({
          items: [{ gizmo: { gizmo: { id: "project-one" } } }],
          cursor: "same-cursor",
        }),
      ),
    );
    await expect(gateway.fetchProjects()).resolves.toMatchObject({
      kind: "failure",
      reason: "compatibility",
    });
  });

  it("parses Project conversation membership and encodes the Project ID", async () => {
    const requests: PageReadOperation[] = [];
    const gateway = gatewayWith((_tabId, operation) => {
      requests.push(operation);
      return Promise.resolve(
        response({
          items: [{ id: "conversation-one", title: "ignored" }],
          cursor: null,
        }),
      );
    });
    await expect(
      gateway.fetchProjectConversationPage("project/one", null),
    ).resolves.toEqual({
      kind: "success",
      value: {
        conversations: [
          {
            id: "conversation-one",
            title: "ignored",
            createdAt: null,
            updatedAt: null,
          },
        ],
        nextCursor: null,
      },
    });
    expect(requests[0]).toEqual({
      kind: "project-conversations",
      projectId: "project/one",
      cursor: "",
      paginationStep: 1,
    });
  });

  it("pins successful standalone reads to ISOLATED and fails closed without reprobe", async () => {
    const success = response({ items: [] });
    const authenticationFailure = [
      {
        result: {
          kind: "response",
          status: 401,
          body: null,
          retryAfter: null,
          redirected: false,
          contentType: "application/json",
          jsonParsed: true,
        },
      },
    ];
    const runScript = vi
      .fn()
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(authenticationFailure);
    const runner: PageScriptRunner = { execute: runScript };
    const executor = new IsolatedFirstPageContextReadExecutor(runner);

    await expect(executor.fetchStandalonePage(42, 0)).resolves.toEqual(success);
    await expect(executor.fetchStandalonePage(42, 100)).resolves.toEqual(
      success,
    );
    await expect(executor.fetchStandalonePage(42, 200)).resolves.toEqual(
      authenticationFailure,
    );
    expect(runScript).toHaveBeenNthCalledWith(1, 42, "ISOLATED", {
      kind: "standalone",
      offset: 0,
      pageLimit: 100,
      paginationStep: 1,
    });
    expect(runScript).toHaveBeenNthCalledWith(2, 42, "ISOLATED", {
      kind: "standalone",
      offset: 100,
      pageLimit: 100,
      paginationStep: 2,
    });
    expect(runScript).toHaveBeenNthCalledWith(3, 42, "ISOLATED", {
      kind: "standalone",
      offset: 200,
      pageLimit: 100,
      paginationStep: 3,
    });
  });

  it("does not fall back to MAIN for non-authentication failures", async () => {
    const networkFailure = [{ result: { kind: "network-error" } }];
    const runScript = vi.fn().mockResolvedValue(networkFailure);
    const runner: PageScriptRunner = { execute: runScript };
    const executor = new IsolatedFirstPageContextReadExecutor(runner);

    await expect(executor.fetchStandalonePage(42, 0)).resolves.toEqual(
      networkFailure,
    );
    expect(runScript).toHaveBeenCalledOnce();
    expect(runScript).toHaveBeenCalledWith(42, "ISOLATED", {
      kind: "standalone",
      offset: 0,
      pageLimit: 100,
      paginationStep: 1,
    });
  });

  it("compares Project discovery in MAIN when ISOLATED returns a transport error", async () => {
    const isolatedFailure = [
      {
        result: {
          kind: "transport-error",
          phase: "fetch",
          errorName: "TypeError",
          errorMessage: "Failed to fetch",
        },
      },
    ];
    const mainResponse = response({ items: [] });
    const runScript = vi.fn((_tabId: number, world: "ISOLATED" | "MAIN") =>
      Promise.resolve(world === "ISOLATED" ? isolatedFailure : mainResponse),
    );
    const runner: PageScriptRunner = { execute: runScript };
    const executor = new IsolatedFirstPageContextReadExecutor(runner);

    await expect(executor.fetchProjectsPage(42, null)).resolves.toEqual(
      mainResponse,
    );
    await expect(executor.fetchStandalonePage(42, 0)).resolves.toEqual(
      isolatedFailure,
    );
    expect(runScript.mock.calls.map((call) => call[1])).toEqual([
      "ISOLATED",
      "MAIN",
      "ISOLATED",
    ]);
  });

  it("validates page-world response metadata before exposing a body", async () => {
    const source = {
      validate: vi.fn().mockResolvedValue({ kind: "valid", tabId: 42 }),
    };
    const malformedExecutor: PageContextReadExecutor = {
      fetchStandalonePage: vi.fn().mockResolvedValue([
        {
          result: {
            kind: "response",
            status: 200,
            body: { items: [] },
            retryAfter: null,
            redirected: false,
            contentType: "text/html",
            jsonParsed: false,
          },
        },
      ]),
      fetchProjectsPage: vi.fn(),
      fetchProjectConversationsPage: vi.fn(),
    };
    const transport = new PageContextReadTransport(
      source,
      malformedExecutor,
      new FakeClock(),
    );

    await expect(transport.readStandalonePage(0)).resolves.toMatchObject({
      kind: "failure",
      reason: "compatibility",
    });
  });

  it.each([401, 403])(
    "fails closed on an actual %i standalone response without probing MAIN",
    async (status) => {
      const requests: PageReadOperation[] = [];
      const gateway = gatewayWith((_tabId, operation) => {
        requests.push(operation);
        return Promise.resolve([
          {
            result: {
              kind: "response",
              status,
              body: null,
              retryAfter: null,
              redirected: false,
              contentType: "application/json",
              jsonParsed: true,
            },
          },
        ]);
      });

      await expect(
        gateway.fetchStandaloneConversationPage(null),
      ).resolves.toEqual({ kind: "failure", reason: "authentication" });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.kind).toBe("standalone");
    },
  );

  it("adds no artificial delay between successful production pages", async () => {
    const source = {
      validate: vi.fn().mockResolvedValue({ kind: "valid", tabId: 42 }),
    };
    const successfulResponse = response({ items: [] });
    const executor: PageContextReadExecutor = {
      fetchStandalonePage: vi.fn().mockResolvedValue(successfulResponse),
      fetchProjectsPage: vi.fn().mockResolvedValue(successfulResponse),
      fetchProjectConversationsPage: vi
        .fn()
        .mockResolvedValue(successfulResponse),
    };
    const clock = new FakeClock();
    const transport = new PageContextReadTransport(source, executor, clock);

    await transport.beginSafetyInventoryRead();
    await transport.readStandalonePage(0);
    await transport.readStandalonePage(100);

    expect(clock.requestedSleeps).toEqual([]);
    expect(source.validate).toHaveBeenCalledOnce();

    await transport.beginSafetyInventoryRead();
    expect(source.validate).toHaveBeenCalledTimes(2);
  });

  it("passes the canonical first-page Project discovery contract to its exact injected validator", async () => {
    interface ScriptDetails {
      readonly world: "ISOLATED" | "MAIN";
      readonly args: readonly [PageReadOperation, "ISOLATED" | "MAIN"];
      readonly func: (operation: unknown, world: unknown) => Promise<unknown>;
    }

    const requestedUrls: string[] = [];
    const backendRequestHeaders: Headers[] = [];
    const serializedOperations: unknown[] = [];
    let backendStatus = 200;
    let backendResponseBody: unknown = { items: [] };
    vi.stubGlobal("window", {
      location: { origin: "https://chatgpt.com" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        requestedUrls.push(url);
        expect(init.method).toBe("GET");
        const isSessionRequest = new URL(url).pathname === "/api/auth/session";
        if (!isSessionRequest) {
          backendRequestHeaders.push(new Headers(init.headers));
        }
        const status = isSessionRequest ? 200 : backendStatus;
        const body = isSessionRequest
          ? { accessToken: "test-project-access-token" }
          : backendResponseBody;
        return Promise.resolve({
          status,
          ok: status >= 200 && status < 300,
          redirected: false,
          type: "basic",
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "content-type" ? "application/json" : null,
          },
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(JSON.stringify(body)),
        });
      }),
    );
    const executeScript = vi.fn(async (details: ScriptDetails) => {
      const serializedArgsJson = JSON.stringify(details.args);
      const serializedArgs = JSON.parse(serializedArgsJson) as unknown;
      if (!Array.isArray(serializedArgs) || serializedArgs.length !== 2) {
        throw new Error("Expected two JSON-compatible executeScript arguments");
      }
      serializedOperations.push(serializedArgs[0]);
      return [
        { result: await details.func(serializedArgs[0], serializedArgs[1]) },
      ];
    });
    vi.stubGlobal("browser", { scripting: { executeScript } });
    const executor = createChromePageContextReadExecutor();

    await Promise.all([
      executor.fetchStandalonePage(42, 0),
      executor.fetchStandalonePage(42, 100),
      executor.fetchStandalonePage(42, 200),
    ]);
    await executor.fetchProjectsPage(42, null);
    await executor.fetchProjectConversationsPage(42, "project/one", null);

    expect(
      requestedUrls.every(
        (url) => new URL(url).origin === "https://chatgpt.com",
      ),
    ).toBe(true);
    const backendUrls = requestedUrls.filter((url) =>
      new URL(url).pathname.startsWith("/backend-api/"),
    );
    expect(
      requestedUrls.filter(
        (url) => new URL(url).pathname === "/api/auth/session",
      ),
    ).toHaveLength(1);
    expect(backendUrls.map((url) => new URL(url).pathname)).toEqual([
      "/backend-api/conversations",
      "/backend-api/conversations",
      "/backend-api/conversations",
      "/backend-api/gizmos/snorlax/sidebar",
      "/backend-api/gizmos/project%2Fone/conversations",
    ]);
    expect(new URL(backendUrls[0] ?? "").searchParams.toString()).toBe(
      "offset=0&limit=100&order=updated&is_archived=false&is_starred=false",
    );
    expect(new URL(backendUrls[1] ?? "").searchParams.get("offset")).toBe(
      "100",
    );
    expect(new URL(backendUrls[2] ?? "").searchParams.get("offset")).toBe(
      "200",
    );
    expect(new URL(backendUrls[3] ?? "").searchParams.toString()).toBe(
      "owned_only=true&conversations_per_gizmo=0",
    );
    expect(new URL(backendUrls[4] ?? "").searchParams.toString()).toBe(
      "cursor=0&limit=5&owned_only=true",
    );
    expect(
      backendRequestHeaders.every(
        (headers) =>
          headers.get("accept") === "application/json" &&
          headers.get("authorization") === "Bearer test-project-access-token" &&
          !headers.has("chatgpt-account-id"),
      ),
    ).toBe(true);
    expect(Reflect.get(executor, "fetchUrl")).toBeUndefined();
    expect(executeScript.mock.calls.map(([details]) => details.world)).toEqual([
      "ISOLATED",
      "ISOLATED",
      "ISOLATED",
      "ISOLATED",
      "ISOLATED",
    ]);
    const projectDiscoveryDetails = executeScript.mock.calls[3]?.[0];
    expect(projectDiscoveryDetails?.args[0]).toEqual({
      kind: "projects",
      ownedOnly: true,
      conversationsPerGizmo: 0,
      cursor: "",
      paginationStep: 1,
    });
    expect(serializedOperations[3]).toEqual(projectDiscoveryDetails?.args[0]);
    expect(projectDiscoveryDetails?.args[0].kind).toBe("projects");
    if (projectDiscoveryDetails?.args[0].kind !== "projects") {
      throw new Error("Expected the Project discovery operation");
    }
    expect(projectDiscoveryDetails.args[0].cursor).toBe("");
    await expect(executeScript.mock.results[3]?.value).resolves.toMatchObject([
      { result: { kind: "response", status: 200 } },
    ]);
    expect(executeScript.mock.calls[4]?.[0].args[0]).toEqual({
      kind: "project-conversations",
      projectId: "project/one",
      cursor: "",
      paginationStep: 1,
    });
    await expect(executeScript.mock.results[4]?.value).resolves.toMatchObject([
      { result: { kind: "response", status: 200 } },
    ]);

    const injectedFunction: unknown = executeScript.mock.calls[0]?.[0].func;
    if (typeof injectedFunction !== "function") {
      throw new Error("Expected an injected narrow read function");
    }
    backendStatus = 401;
    backendResponseBody = {
      detail: { message: "Unauthorized", code: "missing_auth" },
    };
    await expect(
      Reflect.apply(injectedFunction, undefined, [
        createProjectDiscoveryOperation(null, 1),
        "ISOLATED",
      ]),
    ).resolves.toMatchObject({
      kind: "response",
      status: 401,
      body: null,
    });
    backendStatus = 200;
    backendResponseBody = { items: [] };
    const requestCount = requestedUrls.length;
    await expect(
      Reflect.apply(injectedFunction, undefined, [
        { kind: "arbitrary", url: "https://example.com/private" },
      ]),
    ).resolves.toEqual({ kind: "failure", reason: "compatibility" });
    expect(requestedUrls).toHaveLength(requestCount);

    await expect(
      Reflect.apply(injectedFunction, undefined, [
        createProjectDiscoveryOperation(
          "c".repeat(MAX_PAGINATION_CURSOR_LENGTH),
          1,
        ),
        "ISOLATED",
      ]),
    ).resolves.toMatchObject({ kind: "response", status: 200 });
    const requestCountAfterMaximumCursor = requestedUrls.length;
    await expect(
      Reflect.apply(injectedFunction, undefined, [
        createProjectDiscoveryOperation(
          "c".repeat(MAX_PAGINATION_CURSOR_LENGTH + 1),
          1,
        ),
        "ISOLATED",
      ]),
    ).resolves.toMatchObject({
      kind: "failure",
      errorName: "InvalidOperationArguments",
    });
    expect(requestedUrls).toHaveLength(requestCountAfterMaximumCursor);

    const maximumProjectId = "p".repeat(MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH);
    await expect(
      Reflect.apply(injectedFunction, undefined, [
        createProjectConversationOperation(maximumProjectId, null, 1),
        "ISOLATED",
      ]),
    ).resolves.toMatchObject({ kind: "response", status: 200 });
    const requestCountAfterMaximumProjectId = requestedUrls.length;
    await expect(
      Reflect.apply(injectedFunction, undefined, [
        createProjectConversationOperation(`${maximumProjectId}p`, null, 1),
        "ISOLATED",
      ]),
    ).resolves.toMatchObject({
      kind: "failure",
      errorName: "InvalidOperationArguments",
    });
    expect(requestedUrls).toHaveLength(requestCountAfterMaximumProjectId);

    const maximumProjectCursor = "c".repeat(MAX_PAGINATION_CURSOR_LENGTH);
    await expect(
      Reflect.apply(injectedFunction, undefined, [
        createProjectConversationOperation(
          "project-one",
          maximumProjectCursor,
          1,
        ),
        "ISOLATED",
      ]),
    ).resolves.toMatchObject({ kind: "response", status: 200 });
    const requestCountAfterMaximumProjectCursor = requestedUrls.length;
    await expect(
      Reflect.apply(injectedFunction, undefined, [
        createProjectConversationOperation(
          "project-one",
          `${maximumProjectCursor}c`,
          1,
        ),
        "ISOLATED",
      ]),
    ).resolves.toMatchObject({
      kind: "failure",
      errorName: "InvalidOperationArguments",
    });
    expect(requestedUrls).toHaveLength(requestCountAfterMaximumProjectCursor);

    await expect(
      Reflect.apply(injectedFunction, undefined, [
        { kind: "projects", cursor: "", paginationStep: 1 },
        "ISOLATED",
      ]),
    ).resolves.toMatchObject({
      kind: "failure",
      errorName: "InvalidOperationArguments",
    });
    expect(requestedUrls).toHaveLength(requestCountAfterMaximumProjectCursor);

    vi.stubGlobal("window", {
      location: { origin: "chrome-extension://manager" },
    });
    await expect(
      Reflect.apply(injectedFunction, undefined, [
        createProjectDiscoveryOperation(null, 1),
        "ISOLATED",
      ]),
    ).resolves.toEqual({
      kind: "failure",
      reason: "source-unavailable",
      stage: "FUNCTION_ENTERED",
      errorName: "SourceOriginMismatch",
      errorMessage: "Source tab origin does not match https://chatgpt.com",
      requestPathname: "/backend-api/gizmos/snorlax/sidebar",
      world: "ISOLATED",
    });
    expect(requestedUrls).toHaveLength(requestCountAfterMaximumProjectCursor);
  });

  it("revalidates the source before reads and contains no DELETE transport", async () => {
    const gateway = gatewayWith(() => Promise.resolve(response({})), false);
    await expect(gateway.fetchProjects()).resolves.toEqual({
      kind: "failure",
      reason: "source-unavailable",
    });
    await expect(gateway.deleteConversation("anything")).resolves.toMatchObject(
      {
        kind: "fatal",
        reason: "response-anomaly",
        error: { code: "API_COMPATIBILITY_FAILURE" },
      },
    );
  });
});
