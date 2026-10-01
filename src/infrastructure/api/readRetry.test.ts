import { describe, expect, it, vi } from "vitest";
import { FakeClock } from "../fake/FakeClock";
import { createLogger, type LogSink } from "../observability/logger";
import {
  appErrorForReadFailure,
  executeReadWithRetry,
  parseRetryAfter,
  type ReadAttemptResult,
} from "./readRetry";

function createCapturingReadLogger() {
  const sink = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies LogSink;
  return { activeLogger: createLogger("debug", sink), sink };
}

describe("production read retry policy", () => {
  it("maps transport failure to network failure", () => {
    expect(
      appErrorForReadFailure({ operation: "inventory", networkFailure: true }),
    ).toMatchObject({ kind: "NetworkFailure", retryable: true });
  });

  it("maps cancellation without treating it as retryable", () => {
    expect(
      appErrorForReadFailure({ operation: "inventory", cancelled: true }),
    ).toMatchObject({ kind: "OperationCancelled", retryable: false });
  });

  it("accepts valid 2xx and does not retry 401, 403, or unexpected 4xx", async () => {
    const clock = new FakeClock();
    const { activeLogger, sink } = createCapturingReadLogger();
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
          activeLogger,
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
        activeLogger,
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
        activeLogger,
      }),
    ).resolves.toEqual({ kind: "success", value: { ok: true } });
    expect(sink.warn).toHaveBeenCalledTimes(3);
    expect(sink.error).not.toHaveBeenCalled();
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
    const { activeLogger, sink } = createCapturingReadLogger();

    await expect(
      executeReadWithRetry({ attempt, clock, activeLogger }),
    ).resolves.toEqual({ kind: "success", value: "ready" });
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(clock.requestedSleeps).toEqual([2_000, 2_000, 4_000]);
    expect(sink.warn).toHaveBeenCalledTimes(3);
    expect(sink.error).not.toHaveBeenCalled();
  });

  it("parses both Retry-After forms and rejects excessive waits", async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseRetryAfter("2", now)).toBe(2_000);
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:04 GMT", now)).toBe(4_000);
    expect(parseRetryAfter("invalid", now)).toBeNull();

    const clock = new FakeClock(now);
    const { activeLogger, sink } = createCapturingReadLogger();
    await expect(
      executeReadWithRetry({
        attempt: vi.fn().mockResolvedValue({
          kind: "response",
          status: 429,
          body: null,
          retryAfter: "301",
        }),
        clock,
        activeLogger,
      }),
    ).resolves.toEqual({ kind: "failure", reason: "retry-later" });
    expect(clock.requestedSleeps).toEqual([]);
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.error).not.toHaveBeenCalled();
  });

  it("stops after four retryable attempts", async () => {
    const attempt = vi.fn().mockResolvedValue({
      kind: "network-error",
    });
    const clock = new FakeClock();
    const { activeLogger, sink } = createCapturingReadLogger();
    await expect(
      executeReadWithRetry({ attempt, clock, activeLogger }),
    ).resolves.toEqual({ kind: "failure", reason: "network" });
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(clock.requestedSleeps).toEqual([1_000, 2_000, 4_000]);
    expect(sink.warn).toHaveBeenCalledTimes(3);
    expect(sink.error).toHaveBeenCalledTimes(1);
  });

  it("preserves server classification after exhausting 5xx retries", async () => {
    const attempt = vi.fn().mockResolvedValue({
      kind: "response",
      status: 503,
      body: null,
      retryAfter: null,
    });
    const clock = new FakeClock();
    const { activeLogger, sink } = createCapturingReadLogger();

    await expect(
      executeReadWithRetry({ attempt, clock, activeLogger }),
    ).resolves.toEqual({ kind: "failure", reason: "server" });
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(clock.requestedSleeps).toEqual([1_000, 2_000, 4_000]);
    expect(sink.warn).toHaveBeenCalledTimes(3);
    expect(sink.error).toHaveBeenCalledTimes(1);
  });
});
