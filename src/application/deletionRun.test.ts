import { describe, expect, it, vi } from "vitest";
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
import {
  canRetryFailedDeletion,
  DeletionRun,
  deletionRunOwnsWorkflow,
  isDeletionRunActive,
  type DeletionRunProgress,
} from "./deletionRun";
import type {
  ApplicationObservability,
  ObservabilityFields,
} from "./ports/Observability";
import type {
  ProtectedConversationIdsResult,
  ProtectedConversationStore,
} from "./ports/ProtectedConversationStore";
import { mutateProtectedConversationIds } from "./protection";

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
  const confirmation = confirmDeletionPlan(plan);
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

class UnreadableProtectedConversationStore implements ProtectedConversationStore {
  public loadProtectedConversationIds(): Promise<never> {
    return Promise.reject(new Error("Storage unavailable"));
  }

  public saveProtectedConversationIds(): Promise<void> {
    return Promise.resolve();
  }
}

class DeferredSaveProtectedConversationStore implements ProtectedConversationStore {
  public loadCount = 0;
  public saveCount = 0;
  private protectedIds = new Set<string>();
  private pendingSave:
    | {
        readonly protectedIds: ReadonlySet<string>;
        readonly resolve: () => void;
        readonly reject: () => void;
      }
    | undefined;

  public loadProtectedConversationIds(): Promise<ProtectedConversationIdsResult> {
    this.loadCount += 1;
    return Promise.resolve({
      kind: "success",
      protectedConversationIds: new Set(this.protectedIds),
    });
  }

  public saveProtectedConversationIds(
    protectedConversationIds: ReadonlySet<string>,
  ): Promise<void> {
    this.saveCount += 1;
    return new Promise((resolve, reject) => {
      const savedIds = new Set(protectedConversationIds);
      this.pendingSave = {
        protectedIds: savedIds,
        resolve: () => {
          this.protectedIds = savedIds;
          resolve();
        },
        reject: () => reject(new Error("Storage unavailable")),
      };
    });
  }

  public hasPendingSave(): boolean {
    return this.pendingSave !== undefined;
  }

  public resolveSave(): void {
    const pendingSave = this.takePendingSave();
    pendingSave.resolve();
  }

  public rejectSave(): void {
    const pendingSave = this.takePendingSave();
    pendingSave.reject();
  }

  private takePendingSave(): NonNullable<
    DeferredSaveProtectedConversationStore["pendingSave"]
  > {
    const pendingSave = this.pendingSave;
    if (pendingSave === undefined) throw new Error("No pending save");
    this.pendingSave = undefined;
    return pendingSave;
  }
}

class CapturingObservability implements ApplicationObservability {
  public readonly entries: {
    readonly level: "info" | "warn" | "error";
    readonly event: string;
    readonly errorCode?: string;
    readonly fields?: ObservabilityFields;
  }[] = [];
  private sequence = 0;

  public createOperationId(): string {
    this.sequence += 1;
    return `operation-${this.sequence}`;
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

describe("deletion workflow ownership", () => {
  const progress: DeletionRunProgress = {
    total: 1,
    processed: 1,
    deleted: 0,
    failed: 0,
    skipped: 1,
    remaining: 0,
    retries: 0,
    requestsPerMinute: 60,
    activeElapsedMs: 0,
    etaMs: 0,
    paused: false,
    currentConversationId: null,
    failedConversationIds: [],
  };

  it.each(["running", "pausing", "paused", "stopping"] as const)(
    "treats %s as an active deletion run",
    (kind) => {
      expect(isDeletionRunActive({ kind, progress })).toBe(true);
    },
  );

  it("does not treat absent or terminal deletion runs as active", () => {
    expect(isDeletionRunActive(null)).toBe(false);
    expect(isDeletionRunActive({ kind: "stopped", progress })).toBe(false);
    expect(isDeletionRunActive({ kind: "finished", progress })).toBe(false);
  });

  it("owns active and retryable states but releases terminal states without failed work", () => {
    expect(deletionRunOwnsWorkflow({ kind: "paused", progress })).toBe(true);
    expect(
      deletionRunOwnsWorkflow({
        kind: "finished",
        progress: { ...progress, failedConversationIds: ["retryable"] },
      }),
    ).toBe(true);
    expect(deletionRunOwnsWorkflow({ kind: "finished", progress })).toBe(false);
    expect(deletionRunOwnsWorkflow({ kind: "stopped", progress })).toBe(false);
  });

  it.each([
    { kind: "stopped" } as const,
    { kind: "fatal", reason: "unexpected-run-error" } as const,
  ])("keeps failed work retryable in the $kind state", (terminalState) => {
    const state = {
      ...terminalState,
      progress: {
        ...progress,
        failed: 1,
        skipped: 0,
        failedConversationIds: ["failed"],
      },
    };

    expect(state.kind).toBe(terminalState.kind);
    expect(state.progress.failedConversationIds).toEqual(["failed"]);
    expect(canRetryFailedDeletion(state)).toBe(true);
  });
});

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
    const removedIds: string[] = [];
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
      onConversationRemoved: (conversationId) =>
        removedIds.push(conversationId),
    });

    const state = await run.startDeletion();
    expect(state.kind).toBe("finished");
    expect(state.progress.deleted).toBe(4);
    expect(state.progress.skipped).toBe(2);
    expect(state.progress.retries).toBe(3);
    expect(removedIds).toEqual(ids);
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

  it.each([
    [401, "authentication"],
    [403, "authorization"],
    [422, "client"],
  ] as const)(
    "stops on fatal HTTP %i before the next confirmed ID",
    async (status, reason) => {
      const ids = ["fatal", "untouched"];
      const removedIds: string[] = [];
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
        onConversationRemoved: (conversationId) =>
          removedIds.push(conversationId),
      });

      const result = await run.startDeletion();
      expect(result).toMatchObject({ kind: "fatal", reason });
      expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["fatal"]);
      expect(removedIds).toEqual([]);
      expect(lockState.active).toBe(false);
    },
  );

  it("continues after exhausted server and network failures", async () => {
    const ids = ["server-failed", "network-failed", "success"];
    const removedIds: string[] = [];
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
      onConversationRemoved: (conversationId) =>
        removedIds.push(conversationId),
    });

    const result = await run.startDeletion();
    expect(result).toMatchObject({
      kind: "finished",
      progress: { failed: 2, deleted: 1, processed: 3 },
    });
    expect(removedIds).toEqual(["success"]);
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

  it("preserves failed retry eligibility when the Retry Failed lock is unavailable", async () => {
    const sharedLockState = { active: false };
    const lockUnavailable = vi.fn();
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
      destructiveRunLock: new FakeDestructiveRunLock(sharedLockState),
      onLockUnavailable: lockUnavailable,
    });

    const failedState = await run.startDeletion();
    expect(canRetryFailedDeletion(failedState)).toBe(true);

    sharedLockState.active = true;
    const contendedState = await run.retryFailedDeletion();

    expect(lockUnavailable).toHaveBeenCalledOnce();
    expect(contendedState).toEqual(failedState);
    expect(canRetryFailedDeletion(run.getState())).toBe(true);
    expect(gateway.deleteAttempts).toHaveLength(5);

    sharedLockState.active = false;
    const retriedState = await run.retryFailedDeletion();

    expect(retriedState.kind).toBe("finished");
    expect(retriedState.progress.failedConversationIds).toEqual([]);
    expect(gateway.deleteAttempts).toHaveLength(6);
  });

  it.each([{ ids: ["a"] }, { ids: ["a", "b"] }])(
    "starts DELETE for $ids with zero inventory reads",
    async ({ ids }) => {
      const clock = new FakeClock();
      const gateway = new FakeConversationGateway(
        fixtureForDeletion(ids, {}),
        clock,
      );
      const protectedStore = new FakeProtectedConversationStore();
      const run = new DeletionRun({
        confirmedPlan: confirmedPlan(ids),
        requestsPerMinute: 120,
        gateway,
        protectedConversationStore: protectedStore,
        clock,
        destructiveRunLock: new FakeDestructiveRunLock(),
      });

      expect((await run.startDeletion()).kind).toBe("finished");
      expect(gateway.safetyInventoryReadCount).toBe(0);
      expect(gateway.standalonePageReadCount).toBe(0);
      expect(gateway.projectDiscoveryReadCount).toBe(0);
      expect(gateway.projectConversationPageReadCount).toBe(0);
      expect(protectedStore.loadCount).toBe(1);
      expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(ids);
    },
  );

  it("removes an ID protected after confirmation once the lock is acquired", async () => {
    const ids = ["newly-protected", "still-eligible"];
    const clock = new FakeClock();
    const store = new FakeProtectedConversationStore();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const lock = new MutatingDestructiveRunLock(async () => {
      await store.saveProtectedConversationIds(new Set(["newly-protected"]));
    });
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: lock,
    });

    expect((await run.startDeletion()).kind).toBe("finished");
    expect(store.loadCount).toBe(1);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "still-eligible",
    ]);
  });

  it("issues no DELETE when every ID becomes protected after lock acquisition", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock();
    const store = new FakeProtectedConversationStore();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const lock = new MutatingDestructiveRunLock(async () => {
      await store.saveProtectedConversationIds(new Set(ids));
    });
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: lock,
    });

    expect((await run.startDeletion()).kind).toBe("finished");
    expect(gateway.deleteAttempts).toEqual([]);
  });

  it.each([
    {
      failure: "validation",
      store: new FakeProtectedConversationStore("invalid"),
    },
    {
      failure: "read",
      store: new UnreadableProtectedConversationStore(),
    },
  ])(
    "blocks before DELETE on protected-store $failure failure",
    async ({ store }) => {
      const clock = new FakeClock();
      const gateway = new FakeConversationGateway(
        fixtureForDeletion(["a"], {}),
        clock,
      );
      const run = new DeletionRun({
        confirmedPlan: confirmedPlan(["a"]),
        requestsPerMinute: 60,
        gateway,
        protectedConversationStore: store,
        clock,
        destructiveRunLock: new FakeDestructiveRunLock(),
      });

      await expect(run.startDeletion()).resolves.toMatchObject({
        kind: "blocked",
        reason: "protected-storage",
      });
      expect(gateway.deleteAttempts).toEqual([]);
    },
  );

  it("pauses a local wait, resumes, and does not replay success", async () => {
    const ids = ["a", "b"];
    const removedIds: string[] = [];
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
      onConversationRemoved: (conversationId) =>
        removedIds.push(conversationId),
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
    expect(removedIds).toEqual(["a", "b"]);
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

  it("holds the destructive lock until a paused protection write settles after Stop", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock(0, false);
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const store = new DeferredSaveProtectedConversationStore();
    const sharedLockState = { active: false };
    const lock = new FakeDestructiveRunLock(sharedLockState);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: lock,
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    run.pauseDeletion();
    await settleAsyncWork();
    expect(run.getState().kind).toBe("paused");

    const mutation = mutateProtectedConversationIds({
      mutation: { kind: "protect", conversationIds: new Set(["b"]) },
      protectedConversationStore: store,
      destructiveRunLock: lock,
      currentRunLockOwner: run,
    });
    await settleAsyncWork();
    expect(store.hasPendingSave()).toBe(true);

    run.stopDeletion();
    await settleAsyncWork();
    expect(run.getState().kind).toBe("stopping");
    expect(sharedLockState.active).toBe(true);
    await expect(
      lock.runExclusive(() => Promise.resolve("competing executor")),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);

    store.resolveSave();
    await expect(mutation).resolves.toMatchObject({ kind: "saved" });
    await expect(completion).resolves.toMatchObject({ kind: "stopped" });
    expect(sharedLockState.active).toBe(false);
    await expect(
      lock.runExclusive(() => Promise.resolve("after stop")),
    ).resolves.toEqual({ kind: "acquired", value: "after stop" });
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);
  });

  it("rejects programmatic Resume while a paused protection mutation is pending", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock(0, false);
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const store = new DeferredSaveProtectedConversationStore();
    const sharedLockState = { active: false };
    const lock = new FakeDestructiveRunLock(sharedLockState);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: lock,
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    run.pauseDeletion();
    await settleAsyncWork();
    expect(run.getState().kind).toBe("paused");

    const mutation = mutateProtectedConversationIds({
      mutation: { kind: "unprotect", conversationIds: new Set(["b"]) },
      protectedConversationStore: store,
      destructiveRunLock: lock,
      currentRunLockOwner: run,
    });
    await settleAsyncWork();
    expect(store.hasPendingSave()).toBe(true);

    run.resumeDeletion();
    await settleAsyncWork();
    clock.advanceBy(1_000);
    await settleAsyncWork();
    expect(run.getState().kind).toBe("paused");
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);
    expect(sharedLockState.active).toBe(true);

    store.resolveSave();
    await expect(mutation).resolves.toMatchObject({ kind: "saved" });
    run.resumeDeletion();
    await settleAsyncWork();
    clock.advanceBy(1_000);
    await settleAsyncWork();

    await expect(completion).resolves.toMatchObject({ kind: "finished" });
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(sharedLockState.active).toBe(false);
  });

  it("rejects a run-owned protection mutation when Stop wins registration", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock(0, false);
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const store = new DeferredSaveProtectedConversationStore();
    const sharedLockState = { active: false };
    const lock = new FakeDestructiveRunLock(sharedLockState);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: lock,
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    run.pauseDeletion();
    await settleAsyncWork();
    expect(run.getState().kind).toBe("paused");
    const loadCountBeforeMutation = store.loadCount;
    const saveCountBeforeMutation = store.saveCount;

    run.stopDeletion();
    const mutation = mutateProtectedConversationIds({
      mutation: { kind: "protect", conversationIds: new Set(["b"]) },
      protectedConversationStore: store,
      destructiveRunLock: lock,
      currentRunLockOwner: run,
    });

    await expect(mutation).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
    await expect(completion).resolves.toMatchObject({ kind: "stopped" });
    expect(store.loadCount).toBe(loadCountBeforeMutation);
    expect(store.saveCount).toBe(saveCountBeforeMutation);
    expect(store.hasPendingSave()).toBe(false);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);
    expect(sharedLockState.active).toBe(false);
  });

  it("blocks a paused run until a failed protection write reaches a safe terminal state", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock(0, false);
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const store = new DeferredSaveProtectedConversationStore();
    const sharedLockState = { active: false };
    const lock = new FakeDestructiveRunLock(sharedLockState);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: lock,
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    run.pauseDeletion();
    await settleAsyncWork();

    const mutation = mutateProtectedConversationIds({
      mutation: { kind: "protect", conversationIds: new Set(["b"]) },
      protectedConversationStore: store,
      destructiveRunLock: lock,
      currentRunLockOwner: run,
    });
    const rejectedMutation = expect(mutation).rejects.toThrow(
      "Storage unavailable",
    );
    await settleAsyncWork();
    run.stopDeletion();
    store.rejectSave();

    await rejectedMutation;
    await expect(completion).resolves.toMatchObject({
      kind: "blocked",
      reason: "protected-storage",
    });
    expect(sharedLockState.active).toBe(false);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);
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

  it("stop during a retry delay prevents another DELETE attempt", async () => {
    const clock = new FakeClock(0, false);
    const removedIds: string[] = [];
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["retrying"], {
        retrying: [500, "success"],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["retrying"]),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      onConversationRemoved: (conversationId) =>
        removedIds.push(conversationId),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();

    expect(gateway.deleteAttempts).toHaveLength(1);
    expect(clock.requestedSleeps).toHaveLength(1);
    expect(run.getState()).toMatchObject({
      kind: "running",
      progress: { processed: 0, remaining: 1 },
    });

    run.stopDeletion();
    const stoppedState = await completion;
    clock.advanceBy(120_000);
    await settleAsyncWork();

    expect(stoppedState).toMatchObject({
      kind: "stopped",
      progress: {
        processed: 0,
        deleted: 0,
        failed: 0,
        skipped: 0,
        remaining: 1,
        failedConversationIds: [],
      },
    });
    expect(gateway.deleteAttempts).toHaveLength(1);
    expect(removedIds).toEqual([]);
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
    expect(store.loadCount).toBe(2);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);
  });

  it("blocks Resume when the protected-ID reload fails and preserves progress", async () => {
    let protectedStoreLoadCount = 0;
    const store: ProtectedConversationStore = {
      loadProtectedConversationIds: () => {
        protectedStoreLoadCount += 1;
        if (protectedStoreLoadCount === 1) {
          return Promise.resolve({
            kind: "success",
            protectedConversationIds: new Set<string>(),
          });
        }
        return Promise.reject(new Error("Storage unavailable"));
      },
      saveProtectedConversationIds: () => Promise.resolve(),
    };
    const ids = ["completed", "remaining"];
    const removedIds: string[] = [];
    const clock = new FakeClock(0, false);
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const sharedLockState = { active: false };
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(sharedLockState),
      onConversationRemoved: (conversationId) =>
        removedIds.push(conversationId),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    run.pauseDeletion();
    await settleAsyncWork();
    expect(run.getState()).toMatchObject({
      kind: "paused",
      progress: { processed: 1, deleted: 1, remaining: 1 },
    });

    run.resumeDeletion();
    const blockedState = await completion;

    expect(blockedState).toMatchObject({
      kind: "blocked",
      reason: "protected-storage",
      progress: {
        total: 2,
        processed: 1,
        deleted: 1,
        failed: 0,
        skipped: 0,
        remaining: 1,
        failedConversationIds: [],
      },
    });
    expect(protectedStoreLoadCount).toBe(2);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["completed"]);
    expect(removedIds).toEqual(["completed"]);
    expect(sharedLockState.active).toBe(false);
  });

  it("retry failed cannot add or delete a newly protected ID", async () => {
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
    expect(store.loadCount).toBe(2);
    expect(gateway.deleteAttempts).toHaveLength(5);
  });

  it("reloads only local protection after reacquiring the Retry Failed lock", async () => {
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
    const ids = ["succeeded", "failed"];
    const removedIds: string[] = [];
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {
        failed: [500, 500, 500, 500, 500, "success"],
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
      onConversationRemoved: (conversationId) =>
        removedIds.push(conversationId),
    });

    expect(await run.startDeletion()).toMatchObject({
      progress: { deleted: 1, failed: 1 },
    });
    expect(removedIds).toEqual(["succeeded"]);
    const retryResult = await run.retryFailedDeletion();

    expect(retryResult.kind).toBe("finished");
    expect(retryResult.progress.deleted).toBe(1);
    expect(removedIds).toEqual(["succeeded", "failed"]);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "succeeded",
      "failed",
      "failed",
      "failed",
      "failed",
      "failed",
      "failed",
    ]);
  });

  it("never dispatches an ID outside the confirmed set", async () => {
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["confirmed", "not-confirmed"], {}),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["confirmed"]),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    await run.startDeletion();

    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["confirmed"]);
  });

  it("Resume performs no ChatGPT inventory reads", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["a", "b"], {}),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["a", "b"]),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    run.pauseDeletion();
    await settleAsyncWork();
    run.resumeDeletion();
    await settleAsyncWork();
    clock.advanceBy(1_000);
    await settleAsyncWork();

    await completion;
    expect(gateway.safetyInventoryReadCount).toBe(0);
    expect(gateway.standalonePageReadCount).toBe(0);
    expect(gateway.projectDiscoveryReadCount).toBe(0);
    expect(gateway.projectConversationPageReadCount).toBe(0);
  });

  it("Retry Failed performs no ChatGPT inventory reads", async () => {
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
    await run.retryFailedDeletion();

    expect(gateway.safetyInventoryReadCount).toBe(0);
    expect(gateway.standalonePageReadCount).toBe(0);
    expect(gateway.projectDiscoveryReadCount).toBe(0);
    expect(gateway.projectConversationPageReadCount).toBe(0);
    expect(gateway.deleteAttempts).toHaveLength(6);
  });
});
