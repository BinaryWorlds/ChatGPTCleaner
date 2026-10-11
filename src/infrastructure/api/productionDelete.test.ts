import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "infrastructure/fake/FakeClock";
import { MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH } from "domain/identifier";
import {
  PageContextDeleteTransport,
  classifyDeleteResponse,
  createChromePageContextDeleteExecutor,
  createDeleteConversationOperation,
  type DeleteConversationOperation,
  type PageContextDeleteExecutor,
} from "./PageContextDeleteTransport";

afterEach(() => {
  vi.useRealTimers();
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
    readonly deleteTimeout?: boolean;
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
        deleteTimeout: options.deleteTimeout ?? false,
      },
    },
  ];
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T) => resolvePromise(value),
  } as const;
}

describe("production DELETE classification", () => {
  const base = {
    retryAfterMs: null,
    redirected: false,
    responseType: "basic",
    contentType: null,
    deleteTimeout: false,
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

  it("classifies only the explicit DELETE timeout response separately", () => {
    expect(
      classifyDeleteResponse({ ...base, status: 500, deleteTimeout: true }),
    ).toEqual({
      kind: "retryable",
      reason: "delete-timeout",
      status: 500,
    });
    expect(
      classifyDeleteResponse({ ...base, status: 502, deleteTimeout: true }),
    ).toEqual({ kind: "retryable", reason: "server", status: 502 });
  });

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

  it("does not report a slow response during source preparation", async () => {
    let resolveSource:
      | ((value: { readonly kind: "valid"; readonly tabId: number }) => void)
      | undefined;
    const sourceValidation = new Promise<{
      readonly kind: "valid";
      readonly tabId: number;
    }>((resolve) => {
      resolveSource = resolve;
    });
    const onResponseSlow = vi.fn();
    const execute = vi.fn(
      (
        _tabId: number,
        _operation: DeleteConversationOperation,
        reportSlow?: () => void,
      ) => {
        reportSlow?.();
        return Promise.resolve(responseEnvelope(204));
      },
    );
    const transport = new PageContextDeleteTransport(
      { validate: vi.fn(() => sourceValidation) },
      { execute },
      new FakeClock(),
    );

    const deletion = transport.deleteConversation("conversation-1", {
      onResponseSlow,
    });
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
    expect(onResponseSlow).not.toHaveBeenCalled();

    resolveSource?.({ kind: "valid", tabId: 17 });
    await expect(deletion).resolves.toEqual({ kind: "deleted", status: 204 });
    expect(onResponseSlow).toHaveBeenCalledOnce();
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

  it.each([
    {
      caseName: "maps a bridge source failure to invalid source origin",
      bridgeReason: "source-unavailable",
      expectedReason: "source-unavailable",
      expectedErrorKind: "SourceTabInvalidOrigin",
      expectedErrorCode: "SOURCE_TAB_INVALID_ORIGIN",
    },
    {
      caseName:
        "maps a bridge authentication failure to unavailable authentication",
      bridgeReason: "authentication",
      expectedReason: "authentication",
      expectedErrorKind: "AuthenticationUnavailable",
      expectedErrorCode: "AUTHENTICATION_UNAVAILABLE",
    },
    {
      caseName: "maps a bridge compatibility failure to a response anomaly",
      bridgeReason: "compatibility",
      expectedReason: "response-anomaly",
      expectedErrorKind: "ApiCompatibilityFailure",
      expectedErrorCode: "API_COMPATIBILITY_FAILURE",
    },
  ] as const)(
    "$caseName",
    async ({
      bridgeReason,
      expectedReason,
      expectedErrorKind,
      expectedErrorCode,
    }) => {
      const transport = new PageContextDeleteTransport(
        validSource(),
        {
          execute: vi
            .fn()
            .mockResolvedValue([
              { result: { kind: "failure", reason: bridgeReason } },
            ]),
        },
        new FakeClock(),
      );

      await expect(
        transport.deleteConversation("conversation-1"),
      ).resolves.toMatchObject({
        kind: "fatal",
        reason: expectedReason,
        error: {
          kind: expectedErrorKind,
          code: expectedErrorCode,
        },
      });
    },
  );

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

  it("prioritizes source loss when the executor throws and revalidation fails", async () => {
    const validate = vi
      .fn()
      .mockResolvedValueOnce({ kind: "valid", tabId: 17 })
      .mockResolvedValueOnce({ kind: "invalid" });
    const execute = vi.fn().mockRejectedValue(new Error("executor failed"));
    const transport = new PageContextDeleteTransport(
      { validate },
      { execute },
      new FakeClock(),
    );

    await expect(
      transport.deleteConversation("conversation-1"),
    ).resolves.toMatchObject({
      kind: "fatal",
      reason: "source-unavailable",
      error: {
        kind: "SourceTabUnavailable",
        code: "SOURCE_TAB_UNAVAILABLE",
      },
    });
    expect(validate).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("narrow injected DELETE operation", () => {
  interface SlowResponseSignal {
    readonly signalId: string;
    readonly thresholdMs: number;
  }

  interface ScriptDetails {
    readonly world: string;
    readonly args: readonly [
      DeleteConversationOperation,
      SlowResponseSignal | null,
    ];
    readonly func: (
      operation: DeleteConversationOperation,
      slowResponseSignal?: unknown,
    ) => Promise<unknown>;
  }

  type RuntimeMessageListener = Parameters<
    typeof browser.runtime.onMessage.addListener
  >[0];

  function createRuntimeMessageBridge(tabId: number) {
    const listeners = new Set<RuntimeMessageListener>();
    const sendMessage = vi.fn(
      (message: unknown, callback?: () => void): void => {
        for (const listener of listeners) {
          Reflect.apply(listener, undefined, [
            message,
            { id: "test-extension", tab: { id: tabId } },
            vi.fn(),
          ]);
        }
        callback?.();
      },
    );
    return {
      browserRuntime: {
        id: "test-extension",
        onMessage: {
          addListener: (listener: RuntimeMessageListener) => {
            listeners.add(listener);
          },
          removeListener: (listener: RuntimeMessageListener) => {
            listeners.delete(listener);
          },
        },
      },
      chromeRuntime: { sendMessage, lastError: undefined },
      listenerCount: () => listeners.size,
      sendMessage,
    };
  }

  async function settleAsyncWork(): Promise<void> {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  }

  async function captureInjectedOperation(): Promise<ScriptDetails> {
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
    return captured;
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

  it.each([
    {
      caseName: "exact timeout detail",
      body: { detail: "Request timeout" },
      expectedDeleteTimeout: true,
    },
    {
      caseName: "different server detail",
      body: { detail: "Internal server error" },
      expectedDeleteTimeout: false,
    },
  ])(
    "marks only a DELETE 500 with $caseName",
    async ({ body, expectedDeleteTimeout }) => {
      vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
      Reflect.set(
        globalThis,
        "__chatgptCleanerDeleteAccessToken",
        "test-token",
      );
      const fetchMock = vi
        .fn<(url: string, init: RequestInit) => Promise<unknown>>()
        .mockResolvedValue({
          status: 500,
          ok: false,
          redirected: false,
          type: "basic",
          headers: { get: () => "application/json" },
          json: () => Promise.resolve(body),
        });
      vi.stubGlobal("fetch", fetchMock);
      const captured = await captureInjectedOperation();

      await expect(captured.func(captured.args[0])).resolves.toMatchObject({
        kind: "response",
        status: 500,
        deleteTimeout: expectedDeleteTimeout,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
    },
  );

  it("signals only after a dispatched DELETE has awaited its response for 3 seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
    const runtime = createRuntimeMessageBridge(17);
    const sessionResponse = deferred<unknown>();
    const deleteResponse = deferred<unknown>();
    const fetchMock = vi
      .fn<() => Promise<unknown>>()
      .mockReturnValueOnce(sessionResponse.promise)
      .mockReturnValueOnce(deleteResponse.promise);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", { runtime: runtime.chromeRuntime });
    const executeScript = vi.fn(async (details: ScriptDetails) => [
      {
        result: await details.func(details.args[0], details.args[1]),
      },
    ]);
    vi.stubGlobal("browser", {
      runtime: runtime.browserRuntime,
      scripting: { executeScript },
    });
    const onResponseSlow = vi.fn();

    const execution = createChromePageContextDeleteExecutor().execute(
      17,
      {
        kind: "delete-conversation",
        conversationId: "conversation-123",
      },
      onResponseSlow,
    );
    await settleAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runtime.listenerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onResponseSlow).not.toHaveBeenCalled();
    sessionResponse.resolve({
      status: 200,
      ok: true,
      redirected: false,
      type: "basic",
      headers: { get: () => null },
      json: () => Promise.resolve({ accessToken: "test-token" }),
    });
    await settleAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_999);
    expect(onResponseSlow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onResponseSlow).toHaveBeenCalledOnce();

    deleteResponse.resolve({
      status: 204,
      ok: true,
      redirected: false,
      type: "basic",
      headers: { get: () => null },
    });
    await expect(execution).resolves.toMatchObject([
      { result: { kind: "response", status: 204 } },
    ]);
    expect(runtime.listenerCount()).toBe(0);
    const slowSignal = runtime.sendMessage.mock.calls[0]?.[0];
    runtime.sendMessage(slowSignal, vi.fn());
    expect(onResponseSlow).toHaveBeenCalledOnce();
  });

  it("routes concurrent slow signals only to their matching attempt and cleans up stale listeners", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
    Reflect.set(globalThis, "__chatgptCleanerDeleteAccessToken", "test-token");
    const runtime = createRuntimeMessageBridge(17);
    const firstResponse = deferred<unknown>();
    const secondResponse = deferred<unknown>();
    const fetchMock = vi.fn((url: string) =>
      url.endsWith("/first") ? firstResponse.promise : secondResponse.promise,
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", { runtime: runtime.chromeRuntime });
    vi.stubGlobal("browser", {
      runtime: runtime.browserRuntime,
      scripting: {
        executeScript: vi.fn(async (details: ScriptDetails) => [
          {
            result: await details.func(details.args[0], details.args[1]),
          },
        ]),
      },
    });
    const firstSlow = vi.fn();
    const secondSlow = vi.fn();
    const executor = createChromePageContextDeleteExecutor();

    const firstExecution = executor.execute(
      17,
      { kind: "delete-conversation", conversationId: "first" },
      firstSlow,
    );
    await settleAsyncWork();
    await vi.advanceTimersByTimeAsync(1_000);
    const secondExecution = executor.execute(
      17,
      { kind: "delete-conversation", conversationId: "second" },
      secondSlow,
    );
    await settleAsyncWork();
    expect(runtime.listenerCount()).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(firstSlow).toHaveBeenCalledOnce();
    expect(secondSlow).not.toHaveBeenCalled();
    const firstSignal = runtime.sendMessage.mock.calls[0]?.[0];

    firstResponse.resolve({
      status: 204,
      ok: true,
      redirected: false,
      type: "basic",
      headers: { get: () => null },
    });
    await expect(firstExecution).resolves.toMatchObject([
      { result: { kind: "response", status: 204 } },
    ]);
    expect(runtime.listenerCount()).toBe(1);
    runtime.sendMessage(firstSignal, vi.fn());
    expect(firstSlow).toHaveBeenCalledOnce();
    expect(secondSlow).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(firstSlow).toHaveBeenCalledOnce();
    expect(secondSlow).toHaveBeenCalledOnce();
    const secondSignal = runtime.sendMessage.mock.calls.at(-1)?.[0];

    secondResponse.resolve({
      status: 204,
      ok: true,
      redirected: false,
      type: "basic",
      headers: { get: () => null },
    });
    await expect(secondExecution).resolves.toMatchObject([
      { result: { kind: "response", status: 204 } },
    ]);
    expect(runtime.listenerCount()).toBe(0);
    runtime.sendMessage(secondSignal, vi.fn());
    expect(firstSlow).toHaveBeenCalledOnce();
    expect(secondSlow).toHaveBeenCalledOnce();
  });

  it("cleans up the timer without a signal when DELETE responds before the threshold", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
    const runtime = createRuntimeMessageBridge(17);
    const fetchMock = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        redirected: false,
        type: "basic",
        headers: { get: () => null },
        json: () => Promise.resolve({ accessToken: "test-token" }),
      })
      .mockResolvedValueOnce({
        status: 204,
        ok: true,
        redirected: false,
        type: "basic",
        headers: { get: () => null },
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", { runtime: runtime.chromeRuntime });
    vi.stubGlobal("browser", {
      runtime: runtime.browserRuntime,
      scripting: {
        executeScript: vi.fn(async (details: ScriptDetails) => [
          {
            result: await details.func(details.args[0], details.args[1]),
          },
        ]),
      },
    });
    const onResponseSlow = vi.fn();

    await expect(
      createChromePageContextDeleteExecutor().execute(
        17,
        {
          kind: "delete-conversation",
          conversationId: "conversation-123",
        },
        onResponseSlow,
      ),
    ).resolves.toMatchObject([{ result: { kind: "response", status: 204 } }]);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onResponseSlow).not.toHaveBeenCalled();
    expect(runtime.sendMessage).not.toHaveBeenCalled();
    expect(runtime.listenerCount()).toBe(0);
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

  it("returns a network failure when session acquisition rejects and does not DELETE", async () => {
    vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
    const fetchMock = vi.fn(() =>
      Promise.reject(new Error("session request failed")),
    );
    vi.stubGlobal("fetch", fetchMock);
    const captured = await captureInjectedOperation();

    await expect(captured.func(captured.args[0])).resolves.toEqual({
      kind: "network-failure",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chatgpt.com/api/auth/session",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns an authentication failure for an unauthenticated session and does not DELETE", async () => {
    vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        status: 401,
        ok: false,
        redirected: false,
        type: "basic",
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const captured = await captureInjectedOperation();

    await expect(captured.func(captured.args[0])).resolves.toEqual({
      kind: "failure",
      reason: "authentication",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chatgpt.com/api/auth/session",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns a compatibility failure for a non-authentication session error and does not DELETE", async () => {
    vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        status: 500,
        ok: false,
        redirected: false,
        type: "basic",
        headers: { get: () => null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const captured = await captureInjectedOperation();

    await expect(captured.func(captured.args[0])).resolves.toEqual({
      kind: "failure",
      reason: "compatibility",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chatgpt.com/api/auth/session",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each([
    { caseName: "missing", sessionBody: {} },
    { caseName: "empty", sessionBody: { accessToken: "" } },
  ] as const)(
    "returns an authentication failure for a $caseName access token and does not DELETE",
    async ({ sessionBody }) => {
      vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
      const fetchMock = vi.fn(() =>
        Promise.resolve({
          status: 200,
          ok: true,
          redirected: false,
          type: "basic",
          headers: { get: () => null },
          json: () => Promise.resolve(sessionBody),
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const captured = await captureInjectedOperation();

      await expect(captured.func(captured.args[0])).resolves.toEqual({
        kind: "failure",
        reason: "authentication",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://chatgpt.com/api/auth/session",
        expect.objectContaining({ method: "GET" }),
      );
    },
  );

  it("returns a compatibility failure for malformed session JSON and does not DELETE", async () => {
    vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        status: 200,
        ok: true,
        redirected: false,
        type: "basic",
        headers: { get: () => null },
        json: () => Promise.reject(new SyntaxError("malformed session JSON")),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const captured = await captureInjectedOperation();

    await expect(captured.func(captured.args[0])).resolves.toEqual({
      kind: "failure",
      reason: "compatibility",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chatgpt.com/api/auth/session",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns a network failure when DELETE rejects after session acquisition", async () => {
    vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
    const fetchMock = vi
      .fn<(url: string, init: RequestInit) => Promise<unknown>>(() =>
        Promise.resolve(),
      )
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        redirected: false,
        type: "basic",
        headers: { get: () => null },
        json: () => Promise.resolve({ accessToken: "PRIVATE_TOKEN_SENTINEL" }),
      })
      .mockRejectedValueOnce(new Error("DELETE request failed"));
    vi.stubGlobal("fetch", fetchMock);
    const captured = await captureInjectedOperation();

    await expect(captured.func(captured.args[0])).resolves.toEqual({
      kind: "network-failure",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it.each([
    {
      status: 401,
      expectedReason: "authentication",
      expectedErrorKind: "AuthenticationUnavailable",
      expectedErrorCode: "AUTHENTICATION_UNAVAILABLE",
    },
    {
      status: 403,
      expectedReason: "authorization",
      expectedErrorKind: "AuthorizationDenied",
      expectedErrorCode: "AUTHORIZATION_DENIED",
    },
  ] as const)(
    "invalidates cached authentication after DELETE returns $status",
    async ({
      status,
      expectedReason,
      expectedErrorKind,
      expectedErrorCode,
    }) => {
      vi.stubGlobal("window", { location: { origin: "https://chatgpt.com" } });
      const response = (responseStatus: number) => ({
        status: responseStatus,
        ok: responseStatus >= 200 && responseStatus < 300,
        redirected: false,
        type: "basic",
        headers: { get: () => null },
      });
      const fetchMock = vi
        .fn<(url: string, init: RequestInit) => Promise<unknown>>(() =>
          Promise.resolve(),
        )
        .mockResolvedValueOnce({
          ...response(200),
          json: () => Promise.resolve({ accessToken: "stale-token" }),
        })
        .mockResolvedValueOnce(response(status))
        .mockResolvedValueOnce({
          ...response(200),
          json: () => Promise.resolve({ accessToken: "fresh-token" }),
        })
        .mockResolvedValueOnce(response(204));
      vi.stubGlobal("fetch", fetchMock);
      const captured = await captureInjectedOperation();
      const transport = new PageContextDeleteTransport(
        validSource(),
        {
          execute: async (_tabId, operation) => [
            { result: await captured.func(operation) },
          ],
        },
        new FakeClock(),
      );

      await expect(
        transport.deleteConversation("conversation-1"),
      ).resolves.toMatchObject({
        kind: "fatal",
        reason: expectedReason,
        error: {
          kind: expectedErrorKind,
          code: expectedErrorCode,
        },
        status,
      });
      await expect(
        transport.deleteConversation("conversation-2"),
      ).resolves.toEqual({ kind: "deleted", status: 204 });

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
      const firstDeleteRequest = fetchMock.mock.calls[1]?.[1];
      expect(firstDeleteRequest).toMatchObject({ method: "DELETE" });
      expect(
        new Headers(firstDeleteRequest?.headers).get("authorization"),
      ).toBe("Bearer stale-token");
      expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "GET" });
      const secondDeleteRequest = fetchMock.mock.calls[3]?.[1];
      expect(secondDeleteRequest).toMatchObject({ method: "DELETE" });
      expect(
        new Headers(secondDeleteRequest?.headers).get("authorization"),
      ).toBe("Bearer fresh-token");
    },
  );
});
