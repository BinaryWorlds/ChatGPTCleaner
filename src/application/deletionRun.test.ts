import { describe, expect, it, vi } from "vitest";
import {
  buildDeletionPlan,
  confirmDeletionPlan,
  type ConfirmedDeletionPlan,
} from "domain/deletionPlan";
import { AppConfig } from "config";
import type { Conversation } from "domain/conversation";
import type {
  DestructiveRunLock,
  LockResult,
} from "./ports/DestructiveRunLock";
import type {
  DeleteAttemptEvents,
  DeleteAttemptResult,
} from "./ports/ConversationGateway";
import { createAppError } from "./AppError";
import { FakeClock } from "infrastructure/fake/FakeClock";
import { FakeConversationGateway } from "infrastructure/fake/FakeConversationGateway";
import { FakeDestructiveRunLock } from "infrastructure/fake/FakeDestructiveRunLock";
import { FakeProtectedConversationStore } from "infrastructure/fake/FakeStores";
import { type FakeGatewayFixture } from "infrastructure/fake/fixtures";
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

async function advanceAndSettle(
  clock: FakeClock,
  milliseconds: number,
): Promise<void> {
  clock.advanceBy(milliseconds);
  await settleAsyncWork();
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

class DeferredDeleteGateway extends FakeConversationGateway {
  public activeDeletes = 0;
  public maxActiveDeletes = 0;
  public sameIdOverlap = false;
  private readonly activeIds = new Set<string>();
  private readonly pendingAttempts: Array<{
    readonly id: string;
    readonly events?: DeleteAttemptEvents;
    readonly resolve: (result: DeleteAttemptResult) => void;
    readonly reject: (cause: unknown) => void;
  }> = [];

  public constructor(private readonly schedulingClock: FakeClock) {
    super(fixtureForDeletion([], {}), schedulingClock);
  }

  public override deleteConversation(
    conversationId: string,
    events?: DeleteAttemptEvents,
  ): Promise<DeleteAttemptResult> {
    this.deleteAttempts.push({
      id: conversationId,
      startedAt: this.schedulingClock.now(),
    });
    if (this.activeIds.has(conversationId)) this.sameIdOverlap = true;
    this.activeIds.add(conversationId);
    this.activeDeletes += 1;
    this.maxActiveDeletes = Math.max(this.maxActiveDeletes, this.activeDeletes);

    return new Promise((resolve, reject) => {
      this.pendingAttempts.push({
        id: conversationId,
        ...(events === undefined ? {} : { events }),
        resolve: (result) => {
          this.finish(conversationId);
          resolve(result);
        },
        reject: (cause) => {
          this.finish(conversationId);
          reject(cause instanceof Error ? cause : new Error("Rejected"));
        },
      });
    });
  }

  public resolveNext(
    conversationId: string,
    result: DeleteAttemptResult,
  ): void {
    const index = this.pendingAttempts.findIndex(
      ({ id }) => id === conversationId,
    );
    const pending = this.pendingAttempts[index];
    if (pending === undefined) throw new Error(`No active ${conversationId}`);
    this.pendingAttempts.splice(index, 1);
    pending.resolve(result);
  }

  public rejectNext(conversationId: string, cause: unknown): void {
    const index = this.pendingAttempts.findIndex(
      ({ id }) => id === conversationId,
    );
    const pending = this.pendingAttempts[index];
    if (pending === undefined) throw new Error(`No active ${conversationId}`);
    this.pendingAttempts.splice(index, 1);
    pending.reject(cause);
  }

  public reportSlowResponse(conversationId: string): void {
    this.slowResponseCallback(conversationId)();
  }

  public slowResponseCallback(conversationId: string): () => void {
    const pending = this.pendingAttempts.find(
      ({ id }) => id === conversationId,
    );
    if (pending === undefined) throw new Error(`No active ${conversationId}`);
    const callback = pending.events?.onResponseSlow;
    if (callback === undefined)
      throw new Error(`No slow event for ${conversationId}`);
    return callback;
  }

  private finish(conversationId: string): void {
    this.activeDeletes -= 1;
    this.activeIds.delete(conversationId);
  }
}

const deletedResult: DeleteAttemptResult = { kind: "deleted", status: 204 };
const retryableServerResult = {
  kind: "retryable",
  reason: "server",
} satisfies DeleteAttemptResult;
const retryableDeleteTimeoutResult = {
  kind: "retryable",
  reason: "delete-timeout",
  status: 500,
} satisfies DeleteAttemptResult;
const retryableNetworkResult = {
  kind: "retryable",
  reason: "network",
} satisfies DeleteAttemptResult;

function createRunWithRetryDeleteTimeouts(
  retryDeleteTimeouts: boolean,
  input: ConstructorParameters<typeof DeletionRun>[0],
): DeletionRun {
  const originalValue = AppConfig.deletion.retryDeleteTimeouts;
  if (
    !Reflect.set(AppConfig.deletion, "retryDeleteTimeouts", retryDeleteTimeouts)
  ) {
    throw new Error("Could not override retryDeleteTimeouts for test");
  }
  try {
    return new DeletionRun(input);
  } finally {
    Reflect.set(AppConfig.deletion, "retryDeleteTimeouts", originalValue);
  }
}

async function exhaustActiveDeletion(
  clock: FakeClock,
  gateway: DeferredDeleteGateway,
  conversationId: string,
  finalResult: Extract<DeleteAttemptResult, { readonly kind: "retryable" }>,
): Promise<void> {
  for (const retryDelayMs of [1_000, 2_000, 4_000, 8_000]) {
    gateway.resolveNext(conversationId, retryableServerResult);
    await settleAsyncWork();
    await advanceAndSettle(clock, retryDelayMs);
  }
  gateway.resolveNext(conversationId, finalResult);
  await settleAsyncWork();
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
    activeRequestCount: 0,
    maximumConcurrentDeleteRequests: 1,
    failedConversationIds: [],
    slowDeleteResponseDetected: false,
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

  it.each([{ kind: "finished" } as const, { kind: "stopped" } as const])(
    "keeps failed work retryable in the $kind state",
    (terminalState) => {
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
    },
  );

  it("rejects retry eligibility after a fatal safety stop", () => {
    expect(
      canRetryFailedDeletion({
        kind: "fatal",
        reason: "response-anomaly",
        progress: {
          ...progress,
          failed: 1,
          skipped: 0,
          failedConversationIds: ["failed"],
        },
      }),
    ).toBe(false);
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

  it.each([0, 21, 1.5, Number.NaN])(
    "rejects an invalid maximum concurrent DELETE value: %s",
    (maximumConcurrentDeleteRequests) => {
      const clock = new FakeClock();
      expect(
        () =>
          new DeletionRun({
            confirmedPlan: confirmedPlan(["one"]),
            requestsPerMinute: 60,
            maximumConcurrentDeleteRequests,
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

  it.each([2, 3, 4, 20])(
    "reaches concurrency %i, never exceeds it, and fills a released slot",
    async (maximumConcurrentDeleteRequests) => {
      const ids = Array.from(
        { length: maximumConcurrentDeleteRequests + 1 },
        (_, index) => `conversation-${index}`,
      );
      const clock = new FakeClock(0, false);
      const gateway = new DeferredDeleteGateway(clock);
      const run = new DeletionRun({
        confirmedPlan: confirmedPlan(ids),
        requestsPerMinute: 120,
        maximumConcurrentDeleteRequests,
        gateway,
        protectedConversationStore: new FakeProtectedConversationStore(),
        clock,
        destructiveRunLock: new FakeDestructiveRunLock(),
      });

      const completion = run.startDeletion();
      await settleAsyncWork();
      for (let index = 1; index < maximumConcurrentDeleteRequests; index += 1) {
        await advanceAndSettle(clock, 500);
      }
      expect(gateway.activeDeletes).toBe(maximumConcurrentDeleteRequests);
      expect(gateway.maxActiveDeletes).toBe(maximumConcurrentDeleteRequests);

      await advanceAndSettle(clock, 10_000);
      expect(gateway.deleteAttempts).toHaveLength(
        maximumConcurrentDeleteRequests,
      );
      gateway.resolveNext(ids[0] ?? "", deletedResult);
      await settleAsyncWork();
      expect(gateway.deleteAttempts).toHaveLength(
        maximumConcurrentDeleteRequests + 1,
      );
      expect(gateway.sameIdOverlap).toBe(false);

      for (const id of ids.slice(1)) gateway.resolveNext(id, deletedResult);
      await expect(completion).resolves.toMatchObject({ kind: "finished" });
      expect(gateway.maxActiveDeletes).toBe(maximumConcurrentDeleteRequests);
    },
  );

  it("does not catch up with a burst after a full concurrency slot", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["one", "two", "three"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 1,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    await advanceAndSettle(clock, 10_000);
    gateway.resolveNext("one", deletedResult);
    await settleAsyncWork();
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["one", "two"]);
    gateway.resolveNext("two", deletedResult);
    await settleAsyncWork();
    expect(gateway.deleteAttempts).toHaveLength(2);
    await advanceAndSettle(clock, 499);
    expect(gateway.deleteAttempts).toHaveLength(2);
    await advanceAndSettle(clock, 1);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "one",
      "two",
      "three",
    ]);
    gateway.resolveNext("three", deletedResult);
    await expect(completion).resolves.toMatchObject({ kind: "finished" });
  });

  it("shares actual-start limiting across initial attempts and retries without blocking unrelated work", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["retry", "unrelated"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 2,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    gateway.resolveNext("retry", { kind: "retryable", reason: "server" });
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    expect(gateway.deleteAttempts).toEqual([
      { id: "retry", startedAt: 0 },
      { id: "unrelated", startedAt: 500 },
    ]);
    gateway.resolveNext("unrelated", deletedResult);
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    expect(gateway.deleteAttempts.at(-1)).toEqual({
      id: "retry",
      startedAt: 1_000,
    });
    expect(gateway.sameIdOverlap).toBe(false);
    gateway.resolveNext("retry", deletedResult);
    await expect(completion).resolves.toMatchObject({ kind: "finished" });
  });

  it("applies Retry-After as a global cooldown for every new start", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["limited", "other"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 2,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    gateway.resolveNext("limited", {
      kind: "retryable",
      reason: "rate-limit",
      retryAfterMs: 2_000,
      status: 429,
    });
    await settleAsyncWork();
    await advanceAndSettle(clock, 1_999);
    expect(gateway.deleteAttempts).toHaveLength(1);
    await advanceAndSettle(clock, 1);
    expect(gateway.deleteAttempts.at(-1)?.startedAt).toBe(2_000);
    gateway.resolveNext("limited", deletedResult);
    await advanceAndSettle(clock, 500);
    gateway.resolveNext("other", deletedResult);
    await expect(completion).resolves.toMatchObject({ kind: "finished" });
  });

  it("keeps the longest absolute cooldown when overlapping 429 responses settle out of order", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["first", "second", "third"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 2,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    gateway.resolveNext("second", {
      kind: "retryable",
      reason: "rate-limit",
      retryAfterMs: 5_000,
      status: 429,
    });
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    gateway.resolveNext("first", {
      kind: "retryable",
      reason: "rate-limit",
      retryAfterMs: 2_000,
      status: 429,
    });
    await settleAsyncWork();

    await advanceAndSettle(clock, 4_499);
    expect(gateway.deleteAttempts).toHaveLength(2);
    await advanceAndSettle(clock, 1);
    expect(gateway.deleteAttempts.at(-1)).toEqual({
      id: "first",
      startedAt: 5_500,
    });

    gateway.resolveNext("first", deletedResult);
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    gateway.resolveNext("second", deletedResult);
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    gateway.resolveNext("third", deletedResult);
    await expect(completion).resolves.toMatchObject({ kind: "finished" });
  });

  it("does not infer a slow DELETE from gateway duration and ignores a stale signal", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["one"]),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    const staleSlowResponse = gateway.slowResponseCallback("one");
    await advanceAndSettle(clock, 10_000);
    expect(run.getState().progress.slowDeleteResponseDetected).toBe(false);

    gateway.resolveNext("one", deletedResult);
    await expect(completion).resolves.toMatchObject({
      kind: "finished",
      progress: { slowDeleteResponseDetected: false },
    });
    staleSlowResponse();
    expect(run.getState().progress.slowDeleteResponseDetected).toBe(false);
  });

  it("does not latch the notice during scheduler spacing or retry backoff", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["retry", "waiting"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 2,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    gateway.resolveNext("retry", retryableServerResult);
    await settleAsyncWork();
    await advanceAndSettle(clock, 499);
    expect(gateway.deleteAttempts).toHaveLength(1);
    expect(run.getState().progress.slowDeleteResponseDetected).toBe(false);

    await advanceAndSettle(clock, 1);
    expect(gateway.deleteAttempts.at(-1)?.id).toBe("waiting");
    gateway.resolveNext("waiting", deletedResult);
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    expect(gateway.deleteAttempts.at(-1)?.id).toBe("retry");
    expect(run.getState().progress.slowDeleteResponseDetected).toBe(false);

    gateway.resolveNext("retry", deletedResult);
    await expect(completion).resolves.toMatchObject({
      kind: "finished",
      progress: { slowDeleteResponseDetected: false },
    });
  });

  it("latches a slow DELETE through Pause, Resume, and Stop", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["one"]),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    gateway.reportSlowResponse("one");
    expect(run.getState()).toMatchObject({
      kind: "running",
      progress: { slowDeleteResponseDetected: true },
    });

    run.pauseDeletion();
    expect(run.getState()).toMatchObject({
      kind: "pausing",
      progress: { slowDeleteResponseDetected: true },
    });
    gateway.resolveNext("one", retryableServerResult);
    await settleAsyncWork();
    expect(run.getState()).toMatchObject({
      kind: "paused",
      progress: { slowDeleteResponseDetected: true },
    });

    run.resumeDeletion();
    await settleAsyncWork();
    expect(run.getState()).toMatchObject({
      kind: "running",
      progress: { slowDeleteResponseDetected: true },
    });
    run.stopDeletion();
    await expect(completion).resolves.toMatchObject({
      kind: "stopped",
      progress: { slowDeleteResponseDetected: true },
    });
  });

  it("latches a slow DELETE through Fatal", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["fatal"]),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    gateway.reportSlowResponse("fatal");
    gateway.resolveNext("fatal", {
      kind: "fatal",
      reason: "authorization",
      error: createAppError("AuthorizationDenied", {
        operation: "conversation.delete",
      }),
      status: 403,
    });

    await expect(completion).resolves.toMatchObject({
      kind: "fatal",
      progress: { slowDeleteResponseDetected: true },
    });
  });

  it("latches a slow DELETE through completion and Retry Failed, then resets for a new run", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["failed"]),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const initialCompletion = run.startDeletion();
    await settleAsyncWork();
    gateway.reportSlowResponse("failed");
    await exhaustActiveDeletion(
      clock,
      gateway,
      "failed",
      retryableServerResult,
    );
    await expect(initialCompletion).resolves.toMatchObject({
      kind: "finished",
      progress: { failed: 1, slowDeleteResponseDetected: true },
    });

    const retryCompletion = run.retryFailedDeletion();
    await settleAsyncWork();
    expect(run.getState().progress.slowDeleteResponseDetected).toBe(true);
    await advanceAndSettle(clock, 500);
    gateway.resolveNext("failed", deletedResult);
    await expect(retryCompletion).resolves.toMatchObject({
      kind: "finished",
      progress: { slowDeleteResponseDetected: true },
    });

    const nextRun = new DeletionRun({
      confirmedPlan: confirmedPlan(["new"]),
      requestsPerMinute: 120,
      gateway: new DeferredDeleteGateway(clock),
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });
    expect(nextRun.getState()).toMatchObject({
      kind: "ready",
      progress: { slowDeleteResponseDetected: false },
    });
  });

  it("preserves sequential behavior at the default concurrency", async () => {
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

  it("handles success, 404, 410, retries, and shared rate limiting", async () => {
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

  it.each([404, 410] as const)(
    "retries an explicit DELETE timeout, then counts terminal %i once while queued work continues",
    async (terminalStatus) => {
      const clock = new FakeClock(0, false);
      const gateway = new DeferredDeleteGateway(clock);
      const removedIds: string[] = [];
      const run = createRunWithRetryDeleteTimeouts(true, {
        confirmedPlan: confirmedPlan(["timeout", "queued"]),
        requestsPerMinute: 120,
        maximumConcurrentDeleteRequests: 2,
        gateway,
        protectedConversationStore: new FakeProtectedConversationStore(),
        clock,
        destructiveRunLock: new FakeDestructiveRunLock(),
        onConversationRemoved: (id) => removedIds.push(id),
      });

      const completion = run.startDeletion();
      await settleAsyncWork();
      await advanceAndSettle(clock, 500);
      gateway.resolveNext("timeout", retryableDeleteTimeoutResult);
      gateway.resolveNext("queued", deletedResult);
      await settleAsyncWork();

      expect(run.getState()).toMatchObject({
        kind: "running",
        progress: {
          processed: 1,
          deleted: 1,
          skipped: 0,
          failed: 0,
          retries: 1,
          remaining: 1,
        },
      });
      await advanceAndSettle(clock, 999);
      expect(gateway.deleteAttempts).toHaveLength(2);
      await advanceAndSettle(clock, 1);
      gateway.resolveNext("timeout", {
        kind: "skipped",
        status: terminalStatus,
      });

      await expect(completion).resolves.toMatchObject({
        kind: "finished",
        progress: {
          processed: 2,
          deleted: 1,
          skipped: 1,
          failed: 0,
          retries: 1,
          remaining: 0,
        },
      });
      expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
        "timeout",
        "queued",
        "timeout",
      ]);
      expect(removedIds).toEqual(["queued", "timeout"]);
      expect(new Set(removedIds).size).toBe(2);
    },
  );

  it("fails a DELETE timeout without automatic retry when disabled, while other retries and Retry Failed continue", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = createRunWithRetryDeleteTimeouts(false, {
      confirmedPlan: confirmedPlan(["timeout", "server", "network", "queued"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 4,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    await advanceAndSettle(clock, 500);
    await advanceAndSettle(clock, 500);
    gateway.resolveNext("timeout", retryableDeleteTimeoutResult);
    gateway.resolveNext("server", retryableServerResult);
    gateway.resolveNext("network", retryableNetworkResult);
    gateway.resolveNext("queued", deletedResult);
    await settleAsyncWork();

    expect(run.getState()).toMatchObject({
      kind: "running",
      progress: {
        processed: 2,
        deleted: 1,
        failed: 1,
        retries: 2,
        remaining: 2,
        failedConversationIds: ["timeout"],
      },
    });
    await advanceAndSettle(clock, 999);
    expect(gateway.deleteAttempts).toHaveLength(4);
    await advanceAndSettle(clock, 1);
    gateway.resolveNext("server", deletedResult);
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    gateway.resolveNext("network", deletedResult);

    await expect(completion).resolves.toMatchObject({
      kind: "finished",
      progress: {
        processed: 4,
        deleted: 3,
        failed: 1,
        retries: 2,
        remaining: 0,
        failedConversationIds: ["timeout"],
      },
    });
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "timeout",
      "server",
      "network",
      "queued",
      "server",
      "network",
    ]);

    const manualRetry = run.retryFailedDeletion();
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    gateway.resolveNext("timeout", deletedResult);

    await expect(manualRetry).resolves.toMatchObject({
      kind: "finished",
      progress: {
        processed: 1,
        deleted: 1,
        failed: 0,
        remaining: 0,
      },
    });
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "timeout",
      "server",
      "network",
      "queued",
      "server",
      "network",
      "timeout",
    ]);
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

  it("rejects a direct retry after an earlier failure is followed by a fatal stop", async () => {
    const ids = ["failed", "fatal"];
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {
        failed: [500, 500, 500, 500, 500, "success"],
        fatal: [403],
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

    const fatalState = await run.startDeletion();
    const attemptsBeforeRetry = gateway.deleteAttempts.length;

    expect(fatalState).toMatchObject({
      kind: "fatal",
      reason: "authorization",
      progress: { failedConversationIds: [] },
    });
    expect(attemptsBeforeRetry).toBe(3);
    expect(await run.retryFailedDeletion()).toBe(fatalState);
    expect(gateway.deleteAttempts).toHaveLength(attemptsBeforeRetry);
  });

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
    expect(gateway.deleteAttempts.map(({ id }) => id)).toContain("success");
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

  it("logs a recovered retry as DEBUG without WARN or ERROR", async () => {
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
      observability.entries.filter(
        ({ level }) => level === "warn" || level === "error",
      ),
    ).toEqual([]);
    expect(
      observability.entries.some(
        ({ level, event }) =>
          level === "debug" && event === "deletion.attempt.retry",
      ),
    ).toBe(true);
  });

  it("keeps captured scheduling settings for Retry Failed", async () => {
    const clock = new FakeClock();
    const observability = new CapturingObservability();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["failed"], {
        failed: [500, 500, 500, 500, 500, "success"],
      }),
      clock,
    );
    const mutableInput = {
      confirmedPlan: confirmedPlan(["failed"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 1,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      observability,
    };
    const run = new DeletionRun(mutableInput);

    expect((await run.startDeletion()).progress.failed).toBe(1);
    mutableInput.requestsPerMinute = 1;
    mutableInput.maximumConcurrentDeleteRequests = 4;
    const retried = await run.retryFailedDeletion();

    expect(retried).toMatchObject({
      kind: "finished",
      progress: {
        requestsPerMinute: 120,
        maximumConcurrentDeleteRequests: 1,
      },
    });
    expect(
      observability.entries
        .filter(({ event }) => event === "deletion.run.started")
        .map(({ fields }) => fields?.maximumConcurrentDeleteRequests),
    ).toEqual([1, 1]);
  });

  it("preserves the remaining global cooldown across Retry Failed", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["limited"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 1,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const initialCompletion = run.startDeletion();
    await settleAsyncWork();
    await exhaustActiveDeletion(clock, gateway, "limited", {
      kind: "retryable",
      reason: "rate-limit",
      retryAfterMs: 2_000,
      status: 429,
    });
    await expect(initialCompletion).resolves.toMatchObject({
      kind: "finished",
      progress: { failed: 1 },
    });

    const retryCompletion = run.retryFailedDeletion();
    await settleAsyncWork();
    expect(gateway.deleteAttempts).toHaveLength(5);
    await advanceAndSettle(clock, 1_999);
    expect(gateway.deleteAttempts).toHaveLength(5);
    await advanceAndSettle(clock, 1);
    expect(gateway.deleteAttempts.at(-1)).toEqual({
      id: "limited",
      startedAt: 17_000,
    });

    gateway.resolveNext("limited", deletedResult);
    await expect(retryCompletion).resolves.toMatchObject({ kind: "finished" });
  });

  it("preserves only the remaining start interval across Retry Failed", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["failed"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 1,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const initialCompletion = run.startDeletion();
    await settleAsyncWork();
    await exhaustActiveDeletion(
      clock,
      gateway,
      "failed",
      retryableServerResult,
    );
    await expect(initialCompletion).resolves.toMatchObject({
      kind: "finished",
      progress: { failed: 1 },
    });

    const retryCompletion = run.retryFailedDeletion();
    await settleAsyncWork();
    expect(gateway.deleteAttempts).toHaveLength(5);
    await advanceAndSettle(clock, 499);
    expect(gateway.deleteAttempts).toHaveLength(5);
    await advanceAndSettle(clock, 1);
    expect(gateway.deleteAttempts.at(-1)).toEqual({
      id: "failed",
      startedAt: 15_500,
    });

    gateway.resolveNext("failed", deletedResult);
    await expect(retryCompletion).resolves.toMatchObject({ kind: "finished" });
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

  it("keeps captured scheduling settings across Pause and Resume", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const mutableInput = {
      confirmedPlan: confirmedPlan(["one", "two", "three"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 1,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    };
    const run = new DeletionRun(mutableInput);

    const completion = run.startDeletion();
    await settleAsyncWork();
    mutableInput.requestsPerMinute = 1;
    mutableInput.maximumConcurrentDeleteRequests = 4;
    run.pauseDeletion();
    gateway.resolveNext("one", deletedResult);
    await settleAsyncWork();
    expect(run.getState().kind).toBe("paused");
    run.resumeDeletion();
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["one", "two"]);
    await advanceAndSettle(clock, 10_000);
    expect(gateway.deleteAttempts).toHaveLength(2);
    gateway.resolveNext("two", deletedResult);
    await settleAsyncWork();
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "one",
      "two",
      "three",
    ]);
    gateway.resolveNext("three", deletedResult);
    await expect(completion).resolves.toMatchObject({ kind: "finished" });
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

  it("closes Pause immediately, drains concurrent attempts, and leaves retry work pending", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["retry", "active", "not-started"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 2,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    run.pauseDeletion();
    expect(run.getState()).toMatchObject({
      kind: "pausing",
      progress: { activeRequestCount: 2 },
    });
    gateway.resolveNext("retry", { kind: "retryable", reason: "server" });
    await settleAsyncWork();
    expect(run.getState()).toMatchObject({
      kind: "pausing",
      progress: { activeRequestCount: 1, retries: 1 },
    });
    await advanceAndSettle(clock, 10_000);
    expect(gateway.deleteAttempts).toHaveLength(2);
    gateway.resolveNext("active", deletedResult);
    await settleAsyncWork();
    expect(run.getState()).toMatchObject({
      kind: "paused",
      progress: { activeRequestCount: 0 },
    });
    run.stopDeletion();
    await expect(completion).resolves.toMatchObject({ kind: "stopped" });
    expect(gateway.deleteAttempts).toHaveLength(2);
  });

  it("resumes successful, retryable, and not-started work after a concurrent Pause drain without replay", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const removedIds: string[] = [];
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["success", "retry", "not-started"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 2,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      onConversationRemoved: (id) => removedIds.push(id),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    run.pauseDeletion();
    gateway.resolveNext("retry", retryableServerResult);
    gateway.resolveNext("success", deletedResult);
    await settleAsyncWork();

    expect(run.getState()).toMatchObject({
      kind: "paused",
      progress: {
        activeRequestCount: 0,
        deleted: 1,
        retries: 1,
        remaining: 2,
      },
    });
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "success",
      "retry",
    ]);
    expect(removedIds).toEqual(["success"]);

    run.resumeDeletion();
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    expect(gateway.deleteAttempts.at(-1)).toEqual({
      id: "not-started",
      startedAt: 1_000,
    });
    gateway.resolveNext("not-started", deletedResult);
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    expect(gateway.deleteAttempts.at(-1)).toEqual({
      id: "retry",
      startedAt: 1_500,
    });
    gateway.resolveNext("retry", deletedResult);

    await expect(completion).resolves.toMatchObject({
      kind: "finished",
      progress: { deleted: 3, retries: 1, remaining: 0 },
    });
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "success",
      "retry",
      "not-started",
      "retry",
    ]);
    expect(removedIds).toEqual(["success", "not-started", "retry"]);
  });

  it("gives Fatal precedence over Stop and publishes it only after concurrent drain", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["fatal", "active", "not-started"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 2,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    gateway.resolveNext("fatal", {
      kind: "fatal",
      reason: "authorization",
      error: createAppError("AuthorizationDenied", {
        operation: "conversation.delete",
      }),
      status: 403,
    });
    await settleAsyncWork();
    expect(run.getState()).toMatchObject({
      kind: "running",
      progress: { activeRequestCount: 1 },
    });
    await advanceAndSettle(clock, 10_000);
    expect(gateway.deleteAttempts).toHaveLength(2);
    run.stopDeletion();
    expect(gateway.deleteAttempts).toHaveLength(2);
    gateway.resolveNext("active", deletedResult);
    await expect(completion).resolves.toMatchObject({
      kind: "fatal",
      reason: "authorization",
      progress: { activeRequestCount: 0 },
    });
  });

  it("applies out-of-order completions exactly once with correct accounting", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const removedIds: string[] = [];
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["one", "two", "three"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 3,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      onConversationRemoved: (id) => removedIds.push(id),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    await advanceAndSettle(clock, 500);
    gateway.resolveNext("three", deletedResult);
    gateway.resolveNext("one", { kind: "skipped", status: 404 });
    gateway.resolveNext("two", deletedResult);

    await expect(completion).resolves.toMatchObject({
      kind: "finished",
      progress: {
        processed: 3,
        deleted: 2,
        skipped: 1,
        failed: 0,
        remaining: 0,
        activeRequestCount: 0,
      },
    });
    expect(removedIds).toEqual(["three", "one", "two"]);
    expect(new Set(removedIds).size).toBe(3);
  });

  it("reports failed IDs in confirmed order after out-of-order failures", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["one", "two"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 2,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    await exhaustActiveDeletion(clock, gateway, "two", retryableServerResult);
    expect(run.getState().progress.failedConversationIds).toEqual(["two"]);
    await exhaustActiveDeletion(clock, gateway, "one", retryableServerResult);

    await expect(completion).resolves.toMatchObject({
      kind: "finished",
      progress: {
        processed: 2,
        failed: 2,
        remaining: 0,
        activeRequestCount: 0,
        failedConversationIds: ["one", "two"],
      },
    });
  });

  it("routes synchronous and rejected gateway failures through drained fatal completion", async () => {
    const clock = new FakeClock();
    const synchronousGateway = new FakeConversationGateway(
      fixtureForDeletion(["sync"], {}),
      clock,
    );
    synchronousGateway.deleteConversation = () => {
      throw new Error("sync failure");
    };
    const synchronousRun = new DeletionRun({
      confirmedPlan: confirmedPlan(["sync"]),
      requestsPerMinute: 60,
      maximumConcurrentDeleteRequests: 1,
      gateway: synchronousGateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });
    await expect(synchronousRun.startDeletion()).resolves.toMatchObject({
      kind: "fatal",
      reason: "unexpected-run-error",
      progress: { activeRequestCount: 0 },
    });

    const deferredClock = new FakeClock(0, false);
    const rejectedGateway = new DeferredDeleteGateway(deferredClock);
    const rejectedRun = new DeletionRun({
      confirmedPlan: confirmedPlan(["rejected"]),
      requestsPerMinute: 60,
      maximumConcurrentDeleteRequests: 1,
      gateway: rejectedGateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock: deferredClock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });
    const rejectedCompletion = rejectedRun.startDeletion();
    await settleAsyncWork();
    rejectedGateway.rejectNext("rejected", new Error("async failure"));
    await expect(rejectedCompletion).resolves.toMatchObject({
      kind: "fatal",
      reason: "unexpected-run-error",
      progress: { activeRequestCount: 0 },
    });
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

  it("closes Stop immediately and publishes stopped only after concurrent drain", async () => {
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDeleteGateway(clock);
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["one", "two", "three"]),
      requestsPerMinute: 120,
      maximumConcurrentDeleteRequests: 2,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    await advanceAndSettle(clock, 500);
    run.stopDeletion();
    expect(run.getState()).toMatchObject({
      kind: "stopping",
      progress: { activeRequestCount: 2 },
    });
    gateway.resolveNext("two", { kind: "retryable", reason: "server" });
    await settleAsyncWork();
    expect(run.getState()).toMatchObject({
      kind: "stopping",
      progress: { activeRequestCount: 1 },
    });
    expect(gateway.deleteAttempts).toHaveLength(2);
    gateway.resolveNext("one", deletedResult);
    await expect(completion).resolves.toMatchObject({
      kind: "stopped",
      progress: { activeRequestCount: 0, remaining: 2 },
    });
    await advanceAndSettle(clock, 10_000);
    expect(gateway.deleteAttempts).toHaveLength(2);
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
