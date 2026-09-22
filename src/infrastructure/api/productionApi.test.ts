import { describe, expect, it, vi } from "vitest";
import { FakeClock } from "../fake/FakeClock";
import {
  PageContextReadTransport,
  type FixedReadRequest,
  type PageContextReadExecutor,
} from "./PageContextReadTransport";
import { ProductionConversationGateway } from "./ProductionConversationGateway";
import {
  executeReadWithRetry,
  parseRetryAfter,
  type ReadAttemptResult,
} from "./readRetry";
import {
  normalizeDisplayTimestamp,
  normalizeDisplayTitle,
  parsePaginationCursor,
  parseSafetyCriticalIdentifier,
} from "./readValidation";

describe("production read validation", () => {
  it("blocks malformed safety-critical identifiers and cursors", () => {
    expect(parseSafetyCriticalIdentifier("conversation-id")).toBe(
      "conversation-id",
    );
    expect(parseSafetyCriticalIdentifier(42)).toBeNull();
    expect(parseSafetyCriticalIdentifier("")).toBeNull();
    expect(parsePaginationCursor("next")).toBe("next");
    expect(parsePaginationCursor(null)).toBeNull();
    expect(parsePaginationCursor({ cursor: "next" })).toBe(false);
  });

  it("degrades invalid display metadata without inventing values", () => {
    expect(normalizeDisplayTitle("Title")).toBe("Title");
    expect(normalizeDisplayTitle("  ")).toBe("(Untitled)");
    expect(normalizeDisplayTitle(null)).toBe("(Untitled)");
    expect(normalizeDisplayTimestamp(123)).toBe(123);
    expect(normalizeDisplayTimestamp(Number.NaN)).toBeNull();
    expect(normalizeDisplayTimestamp("123")).toBeNull();
  });

  function gatewayWith(
    execute: PageContextReadExecutor["execute"],
    sourceAvailable = true,
  ) {
    const source = {
      validate: vi
        .fn()
        .mockResolvedValue(
          sourceAvailable ? { kind: "valid", tabId: 7 } : { kind: "invalid" },
        ),
    };
    const executor: PageContextReadExecutor = { execute };
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
        },
      },
    ];
  }

  it("parses observed standalone fields and degrades display metadata", async () => {
    const requests: FixedReadRequest[] = [];
    const gateway = gatewayWith((_tabId, request) => {
      requests.push(request);
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
    expect(requests[0]?.pathname).toBe("/backend-api/conversations");
    expect(requests[0]?.query.offset).toBe("0");
  });

  it("blocks malformed standalone IDs and pagination metadata", async () => {
    const malformedId = gatewayWith(() =>
      Promise.resolve(
        response({
          items: [{ title: "display only" }],
          total: 1,
          limit: 100,
          offset: 0,
        }),
      ),
    );
    await expect(
      malformedId.fetchStandaloneConversationPage(null),
    ).resolves.toEqual({ kind: "failure", reason: "compatibility" });

    const wrongOffset = gatewayWith(() =>
      Promise.resolve(response({ items: [], total: 0, limit: 100, offset: 1 })),
    );
    await expect(
      wrongOffset.fetchStandaloneConversationPage(null),
    ).resolves.toEqual({ kind: "failure", reason: "compatibility" });
  });

  it("enumerates and deduplicates observed nested Project IDs", async () => {
    const gateway = gatewayWith((_tabId, request) =>
      Promise.resolve(
        response(
          request.query.cursor === undefined
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
    await expect(gateway.fetchProjects()).resolves.toEqual({
      kind: "success",
      value: [{ id: "project-one" }, { id: "project-two" }],
    });
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
    await expect(gateway.fetchProjects()).resolves.toEqual({
      kind: "failure",
      reason: "compatibility",
    });
  });

  it("parses Project conversation membership and encodes the Project ID", async () => {
    const requests: FixedReadRequest[] = [];
    const gateway = gatewayWith((_tabId, request) => {
      requests.push(request);
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
      value: { conversationIds: ["conversation-one"], nextCursor: null },
    });
    expect(requests[0]?.pathname).toBe(
      "/backend-api/gizmos/project%2Fone/conversations",
    );
  });

  it("revalidates the source before reads and contains no DELETE transport", async () => {
    const gateway = gatewayWith(() => Promise.resolve(response({})), false);
    await expect(gateway.fetchProjects()).resolves.toEqual({
      kind: "failure",
      reason: "source-unavailable",
    });
    await expect(gateway.deleteConversation("anything")).resolves.toEqual({
      kind: "fatal",
      reason: "response-anomaly",
    });
  });
});

describe("production read retry policy", () => {
  it("accepts valid 2xx and does not retry 401, 403, or unexpected 4xx", async () => {
    const clock = new FakeClock();
    for (const status of [401, 403]) {
      await expect(
        executeReadWithRetry({
          attempt: vi.fn().mockResolvedValue({
            kind: "response",
            status,
            body: null,
            retryAfter: null,
          }),
          clock,
        }),
      ).resolves.toEqual({ kind: "failure", reason: "authentication" });
    }
    await expect(
      executeReadWithRetry({
        attempt: vi.fn().mockResolvedValue({
          kind: "response",
          status: 404,
          body: null,
          retryAfter: null,
        }),
        clock,
      }),
    ).resolves.toEqual({ kind: "failure", reason: "request" });
    await expect(
      executeReadWithRetry({
        attempt: vi.fn().mockResolvedValue({
          kind: "response",
          status: 204,
          body: { ok: true },
          retryAfter: null,
        }),
        clock,
      }),
    ).resolves.toEqual({ kind: "success", value: { ok: true } });
  });

  it("retries 429, 5xx, and transient network failures deterministically", async () => {
    const clock = new FakeClock();
    const outcomes: ReadAttemptResult[] = [
      { kind: "response", status: 429, body: null, retryAfter: "2" },
      { kind: "response", status: 500, body: null, retryAfter: null },
      { kind: "network-error" },
      { kind: "response", status: 200, body: "ready", retryAfter: null },
    ];
    const attempt = vi.fn((): Promise<ReadAttemptResult> =>
      Promise.resolve(outcomes.shift() ?? { kind: "network-error" }),
    );

    await expect(executeReadWithRetry({ attempt, clock })).resolves.toEqual({
      kind: "success",
      value: "ready",
    });
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(clock.requestedSleeps).toEqual([2_000, 2_000, 4_000]);
  });

  it("parses both Retry-After forms and rejects excessive waits", async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseRetryAfter("2", now)).toBe(2_000);
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:04 GMT", now)).toBe(4_000);
    expect(parseRetryAfter("invalid", now)).toBeNull();

    const clock = new FakeClock(now);
    await expect(
      executeReadWithRetry({
        attempt: vi.fn().mockResolvedValue({
          kind: "response",
          status: 429,
          body: null,
          retryAfter: "301",
        }),
        clock,
      }),
    ).resolves.toEqual({ kind: "failure", reason: "retry-later" });
    expect(clock.requestedSleeps).toEqual([]);
  });

  it("stops after four retryable attempts", async () => {
    const attempt = vi.fn().mockResolvedValue({
      kind: "network-error",
    });
    const clock = new FakeClock();
    await expect(executeReadWithRetry({ attempt, clock })).resolves.toEqual({
      kind: "failure",
      reason: "network",
    });
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(clock.requestedSleeps).toEqual([1_000, 2_000, 4_000]);
  });
});
