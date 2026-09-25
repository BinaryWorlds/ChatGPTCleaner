import { describe, expect, it } from "vitest";
import {
  buildDeletionPlan,
  confirmDeletionPlan,
  type ConfirmedDeletionPlan,
} from "../domain/deletionPlan";
import type { Conversation } from "../domain/conversation";
import type {
  DestructiveRunLock,
  LockResult,
} from "./ports/DestructiveRunLock";
import { FakeClock } from "../infrastructure/fake/FakeClock";
import { FakeConversationGateway } from "../infrastructure/fake/FakeConversationGateway";
import { FakeDestructiveRunLock } from "../infrastructure/fake/FakeDestructiveRunLock";
import { FakeProtectedConversationStore } from "../infrastructure/fake/FakeStores";
import { type FakeGatewayFixture } from "../infrastructure/fake/fixtures";
import { DeletionRun } from "./deletionRun";
import type {
  ApplicationObservability,
  ObservabilityFields,
} from "./ports/Observability";

function confirmedPlan(ids: readonly string[]): ConfirmedDeletionPlan {
  const conversations: Conversation[] = ids.map((id) => ({
    id,
    title: id,
    createdAt: null,
    updatedAt: null,
  }));
  const plan = buildDeletionPlan({
    selectedConversationIds: ids,
    standaloneConversations: conversations,
    projectConversationIds: new Set(),
    protectedConversationIds: new Set(),
  });
  const confirmation = confirmDeletionPlan(plan, `DELETE ${ids.length}`);
  if (confirmation.kind !== "confirmed") {
    throw new Error("Test setup failed to confirm a deletion plan.");
  }
  return confirmation.plan;
}

function fixtureForDeletion(
  ids: readonly string[],
  deleteOutcomes: FakeGatewayFixture["deleteOutcomes"],
): FakeGatewayFixture {
  return {
    standalonePages: {
      first: {
        conversations: ids.map((id) => ({ id, title: id })),
        nextCursor: null,
      },
    },
    projects: [],
    projectConversationPages: {},
    ...(deleteOutcomes === undefined ? {} : { deleteOutcomes }),
  };
}

async function settleAsyncWork(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    await Promise.resolve();
  }
}

class MutatingDestructiveRunLock implements DestructiveRunLock {
  private acquisitionCount = 0;

  public constructor(
    private readonly onAcquire: (acquisitionCount: number) => Promise<void>,
  ) {}

  public async runExclusive<T>(work: () => Promise<T>): Promise<LockResult<T>> {
    this.acquisitionCount += 1;
    await this.onAcquire(this.acquisitionCount);
    return { kind: "acquired", value: await work() };
  }
}

class CapturingObservability implements ApplicationObservability {
  public readonly entries: {
    readonly level: "debug" | "info" | "warn" | "error";
    readonly event: string;
    readonly errorCode?: string;
    readonly fields?: ObservabilityFields;
  }[] = [];
  private sequence = 0;

  public createOperationId(): string {
    this.sequence += 1;
    return `operation-${this.sequence}`;
  }

  public debug(event: string, fields?: ObservabilityFields): void {
    this.entries.push({
      level: "debug",
      event,
      ...(fields === undefined ? {} : { fields }),
    });
  }

  public info(event: string, fields?: ObservabilityFields): void {
    this.entries.push({
      level: "info",
      event,
      ...(fields === undefined ? {} : { fields }),
    });
  }

  public warn(event: string, fields?: ObservabilityFields): void {
    this.entries.push({
      level: "warn",
      event,
      ...(fields === undefined ? {} : { fields }),
    });
  }

  public error(
    event: string,
    errorCode: string,
    fields?: ObservabilityFields,
  ): void {
    this.entries.push({
      level: "error",
      event,
      errorCode,
      ...(fields === undefined ? {} : { fields }),
    });
  }
}

class ConcurrencyTrackingDeleteGateway extends FakeConversationGateway {
  public activeDeletes = 0;
  public maxActiveDeletes = 0;

  public override async deleteConversation(conversationId: string) {
    this.activeDeletes += 1;
    this.maxActiveDeletes = Math.max(this.maxActiveDeletes, this.activeDeletes);
    await Promise.resolve();
    try {
      return await super.deleteConversation(conversationId);
    } finally {
      this.activeDeletes -= 1;
    }
  }
}

describe("destructive run", () => {
  it.each([0, 121, 1.5, Number.NaN])(
    "rejects an invalid Application requests-per-minute value: %s",
    (requestsPerMinute) => {
      const clock = new FakeClock();
      expect(
        () =>
          new DeletionRun({
            confirmedPlan: confirmedPlan(["one"]),
            requestsPerMinute,
            gateway: new FakeConversationGateway(
              fixtureForDeletion(["one"], {}),
              clock,
            ),
            protectedConversationStore: new FakeProtectedConversationStore(),
            clock,
            destructiveRunLock: new FakeDestructiveRunLock(),
          }),
      ).toThrow(RangeError);
    },
  );

  it("logs the privacy-safe API lifecycle for a successful DELETE attempt", async () => {
    const clock = new FakeClock();
    const observability = new CapturingObservability();
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["PRIVATE_CONVERSATION_ID_SENTINEL"]),
      requestsPerMinute: 60,
      gateway: new FakeConversationGateway(
        fixtureForDeletion(["PRIVATE_CONVERSATION_ID_SENTINEL"], {}),
        clock,
      ),
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      observability,
    });

    await run.startDeletion();

    expect(
      observability.entries.some(
        ({ level, event, fields }) =>
          level === "debug" &&
          event === "api.request.started" &&
          fields?.operation === "conversation.delete" &&
          fields.ordinal === 1 &&
          fields.attempt === 1,
      ),
    ).toBe(true);
    expect(
      observability.entries.some(
        ({ level, event, fields }) =>
          level === "debug" &&
          event === "api.request.succeeded" &&
          fields?.operation === "conversation.delete" &&
          fields.status === 204 &&
          fields.ordinal === 1 &&
          fields.attempt === 1,
      ),
    ).toBe(true);
    expect(JSON.stringify(observability.entries)).not.toContain(
      "PRIVATE_CONVERSATION_ID_SENTINEL",
    );
  });

  it("keeps DELETE strictly sequential with one request in flight", async () => {
    const ids = ["one", "two", "three"];
    const clock = new FakeClock();
    const gateway = new ConcurrencyTrackingDeleteGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    await run.startDeletion();
    expect(gateway.maxActiveDeletes).toBe(1);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(ids);
  });

  it("honors Retry-After without stacking fallback or normal spacing", async () => {
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["limited"], {
        limited: ["long-rate-limit", "success"],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["limited"]),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    await run.startDeletion();
    expect(clock.requestedSleeps).toEqual([120_000]);
    expect(gateway.deleteAttempts.map(({ startedAt }) => startedAt)).toEqual([
      0, 120_000,
    ]);
  });

  it("handles success, 404, 410, retries, and sequential rate limiting", async () => {
    const ids = ["success", "gone", "removed", "limited", "server", "network"];
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {
        success: ["success"],
        gone: [404],
        removed: [410],
        limited: [429, "success"],
        server: [500, "success"],
        network: ["network", "success"],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const state = await run.startDeletion();
    expect(state.kind).toBe("finished");
    expect(state.progress.deleted).toBe(4);
    expect(state.progress.skipped).toBe(2);
    expect(state.progress.retries).toBe(3);
    expect(gateway.deleteAttempts).toHaveLength(9);
    for (let index = 1; index < gateway.deleteAttempts.length; index += 1) {
      const previous = gateway.deleteAttempts[index - 1];
      const current = gateway.deleteAttempts[index];
      if (previous === undefined || current === undefined) continue;
      expect(current.startedAt - previous.startedAt).toBeGreaterThanOrEqual(
        1_000,
      );
    }
  });

  it("stops fatally on 403 without attempting later IDs", async () => {
    const ids = ["forbidden", "untouched"];
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, { forbidden: [403] }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    expect((await run.startDeletion()).kind).toBe("fatal");
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["forbidden"]);
  });

  it.each([
    [401, "authentication"],
    [403, "authorization"],
    [422, "client"],
  ] as const)(
    "stops on fatal HTTP %i before the next confirmed ID",
    async (status, reason) => {
      const ids = ["fatal", "untouched"];
      const clock = new FakeClock();
      const lockState = { active: false };
      const gateway = new FakeConversationGateway(
        fixtureForDeletion(ids, { fatal: [status] }),
        clock,
      );
      const run = new DeletionRun({
        confirmedPlan: confirmedPlan(ids),
        requestsPerMinute: 60,
        gateway,
        protectedConversationStore: new FakeProtectedConversationStore(),
        clock,
        destructiveRunLock: new FakeDestructiveRunLock(lockState),
      });

      const result = await run.startDeletion();
      expect(result).toMatchObject({ kind: "fatal", reason });
      expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["fatal"]);
      expect(lockState.active).toBe(false);
    },
  );

  it("continues after exhausted server and network failures", async () => {
    const ids = ["server-failed", "network-failed", "success"];
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {
        "server-failed": [500, 500, 500, 500, 500],
        "network-failed": [
          "network",
          "network",
          "network",
          "network",
          "network",
        ],
        success: ["success"],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const result = await run.startDeletion();
    expect(result).toMatchObject({
      kind: "finished",
      progress: { failed: 2, deleted: 1, processed: 3 },
    });
    expect(gateway.deleteAttempts.at(-1)?.id).toBe("success");
  });

  it("logs destructive ordinals without IDs and only one terminal fatal error", async () => {
    const privateId = "PRIVATE_CONVERSATION_ID_SENTINEL";
    const clock = new FakeClock();
    const observability = new CapturingObservability();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion([privateId], { [privateId]: [403] }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan([privateId]),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      observability,
    });

    await run.startDeletion();
    const serializedLogs = JSON.stringify(observability.entries);
    expect(serializedLogs).not.toContain(privateId);
    expect(serializedLogs).not.toContain("PRIVATE_TOKEN_SENTINEL");
    expect(serializedLogs).not.toContain("PRIVATE_RESPONSE_SENTINEL");
    expect(serializedLogs).toContain('"ordinal":1');
    expect(
      observability.entries.filter(({ level }) => level === "error"),
    ).toHaveLength(1);
  });

  it("does not log a recovered retry as terminal ERROR", async () => {
    const clock = new FakeClock();
    const observability = new CapturingObservability();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["retry"], { retry: [500, "success"] }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["retry"]),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      observability,
    });

    await run.startDeletion();
    expect(
      observability.entries.filter(({ level }) => level === "error"),
    ).toEqual([]);
    expect(
      observability.entries.some(
        ({ event }) => event === "deletion.attempt.retry",
      ),
    ).toBe(true);
  });

  it("maps an exhausted rate limit to RATE_LIMITED without a terminal run error", async () => {
    const clock = new FakeClock();
    const observability = new CapturingObservability();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["limited"], {
        limited: [429, 429, 429, 429, 429],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["limited"]),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      observability,
    });

    await run.startDeletion();
    expect(
      observability.entries.filter(({ level }) => level === "error"),
    ).toEqual([]);
    expect(
      observability.entries.some(
        ({ level, event, fields }) =>
          level === "warn" &&
          event === "deletion.attempt.failed" &&
          fields?.errorCode === "RATE_LIMITED",
      ),
    ).toBe(true);
  });

  it("allows only one destructive executor", async () => {
    const sharedLockState = { active: true };
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["a"]),
      requestsPerMinute: 60,
      gateway: new FakeConversationGateway(
        fixtureForDeletion(["a"], {}),
        new FakeClock(),
      ),
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock: new FakeClock(),
      destructiveRunLock: new FakeDestructiveRunLock(sharedLockState),
    });

    expect((await run.startDeletion()).kind).toBe("blocked");
  });

  it("revalidates confirmed IDs after acquiring the lock and before the first DELETE", async () => {
    const clock = new FakeClock();
    const store = new FakeProtectedConversationStore();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["a"], {}),
      clock,
    );
    const lock = new MutatingDestructiveRunLock(async () => {
      await store.saveProtectedConversationIds(new Set(["a"]));
    });
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["a"]),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: lock,
    });

    const result = await run.startDeletion();

    expect(result.kind).toBe("finished");
    expect(gateway.deleteAttempts).toEqual([]);
  });

  it("blocks before the first DELETE when post-lock revalidation fails", async () => {
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["a"], {}),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["a"]),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore([42]),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const result = await run.startDeletion();

    expect(result).toMatchObject({
      kind: "blocked",
      reason: "protected-storage",
    });
    expect(gateway.deleteAttempts).toEqual([]);
  });

  it("pauses a local wait, revalidates, resumes, and does not replay success", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock(0, false);
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);
    run.pauseDeletion();
    await settleAsyncWork();
    expect(run.getState().kind).toBe("paused");
    run.resumeDeletion();
    await settleAsyncWork();
    clock.advanceBy(1_000);
    await settleAsyncWork();

    expect((await completion).kind).toBe("finished");
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("lets an in-flight attempt finish and holds the lock while paused", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock(0, false);
    const fixture = {
      ...fixtureForDeletion(ids, {}),
      latencyMs: 100,
    };
    const gateway = new FakeConversationGateway(fixture, clock);
    const sharedLockState = { active: false };
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(sharedLockState),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    run.pauseDeletion();
    expect(run.getState().kind).toBe("pausing");
    clock.advanceBy(100);
    await settleAsyncWork();

    expect(run.getState().kind).toBe("paused");
    expect(sharedLockState.active).toBe(true);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);

    run.stopDeletion();
    expect((await completion).kind).toBe("stopped");
    expect(sharedLockState.active).toBe(false);
  });

  it("stop cancels a local wait and starts no further attempt", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock(0, false);
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    run.stopDeletion();

    expect((await completion).kind).toBe("stopped");
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);
  });

  it("resume removes a newly protected remaining ID", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock(0, false);
    const store = new FakeProtectedConversationStore();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    run.pauseDeletion();
    await settleAsyncWork();
    expect(run.getState().kind).toBe("paused");
    await store.saveProtectedConversationIds(new Set(["b"]));
    run.resumeDeletion();
    await settleAsyncWork();
    expect(run.getState().progress.remaining).toBe(0);
    expect(run.getState().kind).toBe("finished");

    expect((await completion).kind).toBe("finished");
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);
  });

  it("retry failed revalidates and cannot add or delete a newly protected ID", async () => {
    const clock = new FakeClock();
    const store = new FakeProtectedConversationStore();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["failed"], {
        failed: [500, 500, 500, 500, 500, "success"],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["failed"]),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const initial = await run.startDeletion();
    expect(initial.progress.failed).toBe(1);
    await store.saveProtectedConversationIds(new Set(["failed"]));
    const retried = await run.retryFailedDeletion();

    expect(retried.kind).toBe("finished");
    expect(gateway.deleteAttempts).toHaveLength(5);
  });

  it("revalidates Retry Failed again after reacquiring the lock", async () => {
    const clock = new FakeClock();
    const store = new FakeProtectedConversationStore();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["failed"], {
        failed: [500, 500, 500, 500, 500, "success"],
      }),
      clock,
    );
    const lock = new MutatingDestructiveRunLock(async (acquisitionCount) => {
      if (acquisitionCount === 2) {
        await store.saveProtectedConversationIds(new Set(["failed"]));
      }
    });
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["failed"]),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: lock,
    });

    expect((await run.startDeletion()).progress.failed).toBe(1);
    const retried = await run.retryFailedDeletion();

    expect(retried.kind).toBe("finished");
    expect(gateway.deleteAttempts).toHaveLength(5);
  });

  it("retry failed can delete only the previously confirmed failed subset", async () => {
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["failed"], {
        failed: [500, 500, 500, 500, 500, "success"],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["failed"]),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    expect((await run.startDeletion()).progress.failed).toBe(1);
    const retryResult = await run.retryFailedDeletion();

    expect(retryResult.kind).toBe("finished");
    expect(retryResult.progress.deleted).toBe(1);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "failed",
      "failed",
      "failed",
      "failed",
      "failed",
      "failed",
    ]);
  });
});
