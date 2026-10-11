import { describe, expect, it, vi } from "vitest";
import type { SafeLogFields } from "./logger";
import {
  createLogger,
  createOperationId,
  sanitizeLogFields,
  summarizeUnknownError,
  type LogSink,
} from "./logger";
import { logSchemaValidationFailure } from "./readLogging";
import { executeReadWithRetry } from "infrastructure/api/readRetry";
import { FakeClock } from "infrastructure/fake/FakeClock";

function capturingSink() {
  const entries: { level: string; message: string; fields?: SafeLogFields }[] =
    [];
  const record =
    (level: string) => (message: string, fields?: SafeLogFields) => {
      entries.push({
        level,
        message,
        ...(fields === undefined ? {} : { fields }),
      });
    };
  const sink: LogSink = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
  return { entries, sink };
}

describe("privacy-safe logger", () => {
  it("emits DEBUG in development mode", () => {
    const capture = capturingSink();
    createLogger("development", capture.sink).debug("inventory.page.started");
    expect(capture.entries).toHaveLength(1);
  });

  it("emits DEBUG in debug mode", () => {
    const capture = capturingSink();
    createLogger("debug", capture.sink).debug("protectedStore.load.started");
    expect(capture.entries).toHaveLength(1);
    expect(capture.entries[0]?.message).toContain(
      "protectedStore.load.started",
    );
  });

  it("emits DEBUG in demo mode", () => {
    const capture = capturingSink();
    createLogger("demo", capture.sink).debug("inventory.page.started");
    expect(capture.entries).toHaveLength(1);
  });

  it("suppresses DEBUG and INFO in production", () => {
    const capture = capturingSink();
    const productionLogger = createLogger("production", capture.sink);
    productionLogger.debug("inventory.page.started");
    productionLogger.info("inventory.completed");
    expect(capture.entries).toEqual([]);
  });

  it("emits WARN and ERROR in production", () => {
    const capture = capturingSink();
    const productionLogger = createLogger("production", capture.sink);
    productionLogger.warn("api.request.retry");
    productionLogger.error("api.request.failed", { errorType: "error" });
    expect(capture.entries.map((entry) => entry.level)).toEqual([
      "warn",
      "error",
    ]);
  });

  it("suppresses handled deletion retry diagnostics in production while retaining genuine errors", () => {
    const capture = capturingSink();
    const productionLogger = createLogger("production", capture.sink);
    productionLogger.debug("deletion.attempt.retry", {
      ordinal: 1,
      total: 2,
      attempt: 1,
      reason: "server",
      delayMs: 1_000,
    });
    productionLogger.error("deletion.run.failed", {
      errorType: "error",
      errorName: "UnexpectedFailure",
    });
    expect(capture.entries).toHaveLength(1);
    expect(capture.entries[0]?.level).toBe("error");
    expect(capture.entries[0]?.message).toContain("deletion.run.failed");
  });

  it("retains explicitly safe metadata", () => {
    expect(
      sanitizeLogFields({
        page: 2,
        itemCount: 100,
        retryable: true,
        requestsPerMinute: 60,
      }),
    ).toEqual({
      page: 2,
      itemCount: 100,
      retryable: true,
      requestsPerMinute: 60,
    });
  });

  it.each(["authorization", "TOKEN", "cookieValue", "sessionKey"])(
    "drops authentication-like field %s",
    (key) => {
      expect(sanitizeLogFields({ [key]: "secret" })).toEqual({});
    },
  );

  it.each([
    "conversationId",
    "conversationIds",
    "projectId",
    "projectIds",
    "title",
    "content",
    "message",
  ])("drops private data field %s", (key) => {
    expect(sanitizeLogFields({ [key]: "private" })).toEqual({});
  });

  it("drops raw objects including Error and API responses defensively", () => {
    const unsafe = {
      safeObject: new Error("secret"),
      response: { body: "secret" },
      count: 2,
    } as unknown as SafeLogFields;
    expect(sanitizeLogFields(unsafe)).toEqual({ count: 2 });
  });

  it("summarizes errors without message or stack", () => {
    expect(
      summarizeUnknownError(new Error("private backend response")),
    ).toEqual({ errorType: "error", errorName: "Error" });
  });

  it("uses an opaque UUID operation ID without persistence", () => {
    const uuid = "12345678-1234-4123-8123-123456789abc";
    const storageWrite = vi.fn();
    expect(createOperationId(() => uuid)).toBe(uuid);
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("rejects prose or private values in event names", () => {
    const capture = capturingSink();
    createLogger("debug", capture.sink).debug("PRIVATE_TITLE_SENTINEL");
    expect(capture.entries[0]?.message).toContain("logger.invalidEvent");
  });

  it("never emits privacy sentinel values", () => {
    const capture = capturingSink();
    const debugLogger = createLogger("debug", capture.sink);
    debugLogger.debug("api.request.failed", {
      token: "SUPER_SECRET_TOKEN_SENTINEL",
      conversationId: "PRIVATE_CONVERSATION_ID_SENTINEL",
      projectId: "PRIVATE_PROJECT_ID_SENTINEL",
      title: "PRIVATE_TITLE_SENTINEL",
      content: "PRIVATE_CONTENT_SENTINEL",
      email: "PRIVATE_EMAIL_SENTINEL",
      page: 1,
    });
    debugLogger.error(
      "api.request.failed",
      summarizeUnknownError(new Error("SUPER_SECRET_TOKEN_SENTINEL")),
    );
    const output = JSON.stringify(capture.entries);
    for (const sentinel of [
      "SUPER_SECRET_TOKEN_SENTINEL",
      "PRIVATE_CONVERSATION_ID_SENTINEL",
      "PRIVATE_PROJECT_ID_SENTINEL",
      "PRIVATE_TITLE_SENTINEL",
      "PRIVATE_CONTENT_SENTINEL",
      "PRIVATE_EMAIL_SENTINEL",
    ]) {
      expect(output).not.toContain(sentinel);
    }
  });
});

describe("schema logging privacy", () => {
  it("records only safe issue codes and schema paths", () => {
    const capture = capturingSink();
    logSchemaValidationFailure(
      "standalone",
      1,
      [{ code: "invalid_type", path: ["items", 0, "id"] }],
      createLogger("debug", capture.sink),
    );
    expect(capture.entries[0]?.fields).toMatchObject({
      issueCount: 1,
      issueCodes: ["invalid_type"],
      paths: ["items[].id"],
    });
  });

  it("rejects unsafe schema path segments", () => {
    const capture = capturingSink();
    logSchemaValidationFailure(
      "projects",
      1,
      [{ code: "invalid_type", path: ["PRIVATE_PROJECT_ID_SENTINEL"] }],
      createLogger("debug", capture.sink),
    );
    expect(JSON.stringify(capture.entries)).not.toContain(
      "PRIVATE_PROJECT_ID_SENTINEL",
    );
  });
});

describe("retry logging levels", () => {
  it("does not log a recovered retry as terminal ERROR", async () => {
    const capture = capturingSink();
    const activeLogger = createLogger("debug", capture.sink);
    let attempt = 0;
    await executeReadWithRetry({
      activeLogger,
      clock: new FakeClock(),
      operation: "standaloneConversations.list",
      attempt: () => {
        attempt += 1;
        return Promise.resolve(
          attempt === 1
            ? {
                kind: "response" as const,
                status: 500,
                body: null,
                retryAfter: null,
              }
            : {
                kind: "response" as const,
                status: 200,
                body: null,
                retryAfter: null,
              },
        );
      },
    });
    expect(capture.entries.filter((entry) => entry.level === "error")).toEqual(
      [],
    );
  });

  it("logs exactly one terminal ERROR after retry exhaustion", async () => {
    const capture = capturingSink();
    await executeReadWithRetry({
      activeLogger: createLogger("debug", capture.sink),
      clock: new FakeClock(),
      operation: "standaloneConversations.list",
      attempt: () => Promise.resolve({ kind: "network-error" }),
    });
    expect(
      capture.entries.filter((entry) => entry.level === "error"),
    ).toHaveLength(1);
  });

  it("does not log cancellation as ERROR", async () => {
    const capture = capturingSink();
    const controller = new AbortController();
    controller.abort();
    await executeReadWithRetry({
      activeLogger: createLogger("debug", capture.sink),
      clock: new FakeClock(),
      signal: controller.signal,
      operation: "standaloneConversations.list",
      attempt: () =>
        Promise.resolve({
          kind: "response",
          status: 500,
          body: null,
          retryAfter: null,
        }),
    });
    expect(capture.entries.filter((entry) => entry.level === "error")).toEqual(
      [],
    );
  });
});
