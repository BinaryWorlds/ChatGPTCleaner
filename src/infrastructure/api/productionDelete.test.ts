import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "../fake/FakeClock";
import { MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH } from "../../domain/identifier";
import {
  PageContextDeleteTransport,
  classifyDeleteResponse,
  createChromePageContextDeleteExecutor,
  createDeleteConversationOperation,
  type DeleteConversationOperation,
  type PageContextDeleteExecutor,
} from "./PageContextDeleteTransport";

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "__chatgptCleanerDeleteAccessToken");
});

function validSource() {
  return { validate: vi.fn().mockResolvedValue({ kind: "valid", tabId: 17 }) };
}

function responseEnvelope(
  status: number,
  options: {
    readonly retryAfter?: string | null;
    readonly redirected?: boolean;
    readonly responseType?: string;
    readonly contentType?: string | null;
  } = {},
): unknown {
  return [
    {
      result: {
        kind: "response",
        status,
        retryAfter: options.retryAfter ?? null,
        redirected: options.redirected ?? false,
        responseType: options.responseType ?? "basic",
        contentType: options.contentType ?? null,
      },
    },
  ];
}

describe("production DELETE classification", () => {
  const base = {
    retryAfterMs: null,
    redirected: false,
    responseType: "basic",
    contentType: null,
  } as const;

  it.each([200, 202, 204, 299])("classifies empty %i as deleted", (status) => {
    expect(classifyDeleteResponse({ ...base, status })).toEqual({
      kind: "deleted",
      status,
    });
  });

  it.each([404, 410] as const)("classifies %i as skipped", (status) => {
    expect(classifyDeleteResponse({ ...base, status })).toEqual({
      kind: "skipped",
      status,
    });
  });

  it("classifies 429 with a bounded normalized delay as retryable", () => {
    expect(
      classifyDeleteResponse({ ...base, status: 429, retryAfterMs: 2_000 }),
    ).toEqual({
      kind: "retryable",
      reason: "rate-limit",
      retryAfterMs: 2_000,
      status: 429,
    });
  });

  it("stops safely instead of waiting over five minutes", () => {
    expect(
      classifyDeleteResponse({ ...base, status: 429, retryAfterMs: 300_001 }),
    ).toMatchObject({ kind: "fatal", reason: "retry-later" });
  });

  it.each([500, 502, 599])(
    "classifies %i as retryable server failure",
    (status) => {
      expect(classifyDeleteResponse({ ...base, status })).toEqual({
        kind: "retryable",
        reason: "server",
        status,
      });
    },
  );

  it("maps 401 and 403 to distinct typed fatal errors", () => {
    expect(classifyDeleteResponse({ ...base, status: 401 })).toMatchObject({
      kind: "fatal",
      reason: "authentication",
      error: { code: "AUTHENTICATION_UNAVAILABLE" },
    });
    expect(classifyDeleteResponse({ ...base, status: 403 })).toMatchObject({
      kind: "fatal",
      reason: "authorization",
      error: { code: "AUTHORIZATION_DENIED" },
    });
  });

  it("treats unexpected non-retryable 4xx as fatal", () => {
    expect(classifyDeleteResponse({ ...base, status: 422 })).toMatchObject({
      kind: "fatal",
      reason: "client",
    });
  });

  it("treats redirect and HTML success anomalies as fatal", () => {
    expect(
      classifyDeleteResponse({ ...base, status: 302, redirected: true }),
    ).toMatchObject({ kind: "fatal", reason: "response-anomaly" });
    expect(
      classifyDeleteResponse({
        ...base,
        status: 200,
        contentType: "text/html; charset=utf-8",
      }),
    ).toMatchObject({ kind: "fatal", reason: "response-anomaly" });
  });
});

describe("production DELETE transport", () => {
  it("uses a small canonical operation and rejects malformed IDs before execution", async () => {
    expect(createDeleteConversationOperation("conversation_123-abc")).toEqual({
      kind: "delete-conversation",
      conversationId: "conversation_123-abc",
    });
    expect(createDeleteConversationOperation("bad/id")).toBeNull();
    expect(createDeleteConversationOperation(" ")).toBeNull();

    const execute = vi.fn();
    const executor: PageContextDeleteExecutor = { execute };
    const transport = new PageContextDeleteTransport(
      validSource(),
      executor,
      new FakeClock(),
    );
    await expect(transport.deleteConversation("bad/id")).resolves.toMatchObject(
      {
        kind: "fatal",
        reason: "response-anomaly",
      },
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("revalidates the exact bound source tab before execution", async () => {
    const execute = vi.fn();
    const executor: PageContextDeleteExecutor = { execute };
    const transport = new PageContextDeleteTransport(
      { validate: vi.fn().mockResolvedValue({ kind: "invalid" }) },
      executor,
      new FakeClock(),
    );
    await expect(
      transport.deleteConversation("conversation-1"),
    ).resolves.toMatchObject({
      kind: "fatal",
      reason: "source-unavailable",
      error: { code: "SOURCE_TAB_UNAVAILABLE" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("normalizes network and malformed bridge results fail-closed", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ result: { kind: "network-failure" } }])
      .mockResolvedValueOnce([{ result: { status: 204 } }])
      .mockResolvedValueOnce([
        {
          result: {
            kind: "network-failure",
            rawResponse: "PRIVATE_RESPONSE_SENTINEL",
          },
        },
      ]);
    const transport = new PageContextDeleteTransport(
      validSource(),
      { execute },
      new FakeClock(),
    );
    await expect(
      transport.deleteConversation("conversation-1"),
    ).resolves.toEqual({ kind: "retryable", reason: "network" });
    await expect(
      transport.deleteConversation("conversation-1"),
    ).resolves.toMatchObject({
      kind: "fatal",
      reason: "response-anomaly",
      error: { code: "API_COMPATIBILITY_FAILURE" },
    });
    await expect(
      transport.deleteConversation("conversation-1"),
    ).resolves.toMatchObject({
      kind: "fatal",
      reason: "response-anomaly",
      error: { code: "API_COMPATIBILITY_FAILURE" },
    });
  });

  it("parses Retry-After delta seconds and HTTP-date centrally", async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const execute = vi
      .fn()
      .mockResolvedValueOnce(responseEnvelope(429, { retryAfter: "2" }))
      .mockResolvedValueOnce(
        responseEnvelope(429, {
          retryAfter: "Thu, 01 Jan 2026 00:00:04 GMT",
        }),
      );
    const transport = new PageContextDeleteTransport(
      validSource(),
      { execute },
      new FakeClock(now),
    );
    await expect(
      transport.deleteConversation("conversation-1"),
    ).resolves.toMatchObject({ retryAfterMs: 2_000 });
    await expect(
      transport.deleteConversation("conversation-1"),
    ).resolves.toMatchObject({ retryAfterMs: 4_000 });
  });

  it("normalizes a thrown executor failure as retryable network failure", async () => {
    const transport = new PageContextDeleteTransport(
      validSource(),
      { execute: vi.fn().mockRejectedValue(new Error("private response")) },
      new FakeClock(),
    );
    await expect(
      transport.deleteConversation("conversation-1"),
    ).resolves.toEqual({ kind: "retryable", reason: "network" });
  });
});

describe("narrow injected DELETE operation", () => {
  interface ScriptDetails {
    readonly world: string;
    readonly args: readonly [DeleteConversationOperation];
    readonly func: (operation: DeleteConversationOperation) => Promise<unknown>;
  }

  it("constructs only the fixed chatgpt.com DELETE with no body", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        requests.push({ url, init });
        const session = new URL(url).pathname === "/api/auth/session";
        return Promise.resolve({
          status: session ? 200 : 204,
          ok: true,
          redirected: false,
          type: "basic",
          headers: { get: () => null },
          json: () =>
            Promise.resolve({ accessToken: "PRIVATE_TOKEN_SENTINEL" }),
        });
      }),
    );
    const executeScript = vi.fn(async (details: ScriptDetails) => [
      { result: await details.func(details.args[0]) },
    ]);
    vi.stubGlobal("browser", { scripting: { executeScript } });

    const result = await createChromePageContextDeleteExecutor().execute(17, {
      kind: "delete-conversation",
      conversationId: "conversation-123",
    });

    expect(result).toMatchObject([
      { result: { kind: "response", status: 204 } },
    ]);
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(executeScript.mock.calls[0]?.[0].world).toBe("ISOLATED");
    expect(requests).toHaveLength(2);
    const destructiveRequest = requests[1];
    expect(destructiveRequest).toBeDefined();
    expect(new URL(destructiveRequest?.url ?? "").origin).toBe(
      "https://chatgpt.com",
    );
    expect(new URL(destructiveRequest?.url ?? "").pathname).toBe(
      "/backend-api/conversation/id/conversation-123",
    );
    expect(destructiveRequest?.init).toMatchObject({
      method: "DELETE",
      credentials: "include",
      redirect: "manual",
    });
    expect(destructiveRequest?.init.body).toBeUndefined();
    expect(
      Reflect.get(createChromePageContextDeleteExecutor(), "fetchUrl"),
    ).toBeUndefined();
  });

  it("rejects malformed/arbitrary operations and wrong origin before fetch", async () => {
    const fetchMock = vi.fn((url: string) => {
      const session = new URL(url).pathname === "/api/auth/session";
      return Promise.resolve({
        status: session ? 200 : 204,
        ok: true,
        redirected: false,
        type: "basic",
        headers: { get: () => null },
        json: () => Promise.resolve({ accessToken: "test-token" }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
    const capturedDetails: ScriptDetails[] = [];
    vi.stubGlobal("browser", {
      scripting: {
        executeScript: vi.fn((details: ScriptDetails) => {
          capturedDetails.push(details);
          return Promise.resolve([]);
        }),
      },
    });
    await createChromePageContextDeleteExecutor().execute(17, {
      kind: "delete-conversation",
      conversationId: "conversation-123",
    });
    const captured = capturedDetails[0];
    if (captured === undefined) throw new Error("Expected injected function");
    const injected = captured.func;
    await expect(
      Reflect.apply(injected, undefined, [
        { kind: "delete-conversation", conversationId: "bad/id" },
      ]),
    ).resolves.toEqual({ kind: "failure", reason: "compatibility" });
    expect(fetchMock).not.toHaveBeenCalled();
    const maximumLengthId = "a".repeat(MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH);
    expect(createDeleteConversationOperation(maximumLengthId)).not.toBeNull();
    await expect(
      Reflect.apply(injected, undefined, [
        { kind: "delete-conversation", conversationId: maximumLengthId },
      ]),
    ).resolves.toMatchObject({ kind: "response", status: 204 });
    const requestCountAfterValidId = fetchMock.mock.calls.length;
    const oversizedId = `${maximumLengthId}a`;
    expect(createDeleteConversationOperation(oversizedId)).toBeNull();
    await expect(
      Reflect.apply(injected, undefined, [
        { kind: "delete-conversation", conversationId: oversizedId },
      ]),
    ).resolves.toEqual({ kind: "failure", reason: "compatibility" });
    expect(fetchMock).toHaveBeenCalledTimes(requestCountAfterValidId);
    await expect(
      Reflect.apply(injected, undefined, [
        {
          kind: "delete-conversation",
          conversationId: "conversation-123",
          url: "https://example.com",
          method: "POST",
        },
      ]),
    ).resolves.toEqual({ kind: "failure", reason: "compatibility" });
    vi.stubGlobal("window", { location: { origin: "https://example.com" } });
    await expect(injected(captured.args[0])).resolves.toEqual({
      kind: "failure",
      reason: "source-unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(requestCountAfterValidId);
  });
});
