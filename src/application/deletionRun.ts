import { AppConfig } from "../config";
import type { ConfirmedDeletionPlan } from "../domain/deletionPlan";
import {
  calculateDeletionProgress,
  type DeletionProgress,
} from "../domain/progress";
import { appErrorCode, createAppError, type AppErrorCode } from "./AppError";
import type { Clock } from "./ports/Clock";
import type {
  ConversationGateway,
  DeleteAttemptResult,
} from "./ports/ConversationGateway";
import type {
  DestructiveRunLock,
  LockResult,
} from "./ports/DestructiveRunLock";
import type { ApplicationObservability } from "./ports/Observability";
import type { ProtectedConversationStore } from "./ports/ProtectedConversationStore";
import type { ProtectionMutationLockOwner } from "./protection";
import type { SafetyBlockReason } from "./SafetyBlockReason";
import {
  isValidMaximumConcurrentDeleteRequests,
  isValidRequestsPerMinute,
} from "./settings";

const MILLISECONDS_PER_MINUTE = 60_000;

export interface DeletionRunProgress extends DeletionProgress {
  readonly activeRequestCount: number;
  readonly maximumConcurrentDeleteRequests: number;
  readonly failedConversationIds: readonly string[];
  readonly slowDeleteResponseDetected: boolean;
}

export type DeletionRunState =
  | { readonly kind: "ready"; readonly progress: DeletionRunProgress }
  | { readonly kind: "running"; readonly progress: DeletionRunProgress }
  | { readonly kind: "pausing"; readonly progress: DeletionRunProgress }
  | { readonly kind: "paused"; readonly progress: DeletionRunProgress }
  | { readonly kind: "stopping"; readonly progress: DeletionRunProgress }
  | { readonly kind: "stopped"; readonly progress: DeletionRunProgress }
  | { readonly kind: "finished"; readonly progress: DeletionRunProgress }
  | {
      readonly kind: "blocked";
      readonly reason: SafetyBlockReason;
      readonly progress: DeletionRunProgress;
    }
  | {
      readonly kind: "fatal";
      readonly reason: SafetyBlockReason;
      readonly progress: DeletionRunProgress;
    };

export function canRetryFailedDeletion(state: DeletionRunState): boolean {
  return (
    state.progress.failedConversationIds.length > 0 &&
    (state.kind === "finished" || state.kind === "stopped")
  );
}

export function isDeletionRunActive(state: DeletionRunState | null): boolean {
  return (
    state?.kind === "running" ||
    state?.kind === "pausing" ||
    state?.kind === "paused" ||
    state?.kind === "stopping"
  );
}

export function canStopDeletionRun(state: DeletionRunState): boolean {
  return (
    state.kind === "running" ||
    state.kind === "pausing" ||
    state.kind === "paused"
  );
}

export function deletionRunOwnsWorkflow(
  state: DeletionRunState | null,
): boolean {
  if (state === null) return false;
  if (isDeletionRunActive(state)) return true;
  return canRetryFailedDeletion(state);
}

type ControlCommand = "run" | "pause" | "stop";
type ResumeDecision = "resume" | "stop";
type LocalProtectionResult = "ready" | "empty" | "blocked";

interface MutableRunCounts {
  deleted: number;
  failed: number;
  skipped: number;
  retries: number;
}

interface ScheduledDeletion {
  readonly conversationId: string;
  readonly ordinal: number;
  attempt: number;
  readyAt: number;
  state: "pending" | "active";
}

interface LatchedFatal {
  readonly reason: SafetyBlockReason;
  readonly errorCode: AppErrorCode;
}

export class DeletionRun implements ProtectionMutationLockOwner {
  private state: DeletionRunState;
  private command: ControlCommand = "run";
  private schedulerWaitAbortController: AbortController | null = null;
  private resolveSchedulerWake: (() => void) | null = null;
  private resolveResumeDecision: ((decision: ResumeDecision) => void) | null =
    null;
  private readonly confirmedPlan: ConfirmedDeletionPlan;
  private readonly requestsPerMinute: number;
  private readonly maximumConcurrentDeleteRequests: number;
  private readonly retryDeleteTimeouts: boolean;
  private scheduledDeletions: ScheduledDeletion[];
  private failedConversationIds = new Set<string>();
  private counts: MutableRunCounts = {
    deleted: 0,
    failed: 0,
    skipped: 0,
    retries: 0,
  };
  private activeRequestCount = 0;
  private activeElapsedMs = 0;
  private activeStartedAt: number | null = null;
  private lastAttemptStartedAt: number | null = null;
  private globalCooldownUntil = 0;
  private slowDeleteResponseDetected = false;
  private fatal: LatchedFatal | null = null;
  private operationId: string | null = null;
  private pendingProtectionMutation: Promise<void> | null = null;

  public constructor(
    private readonly input: {
      readonly confirmedPlan: ConfirmedDeletionPlan;
      readonly requestsPerMinute: number;
      readonly maximumConcurrentDeleteRequests?: number;
      readonly gateway: ConversationGateway;
      readonly protectedConversationStore: ProtectedConversationStore;
      readonly clock: Clock;
      readonly destructiveRunLock: DestructiveRunLock;
      readonly observability?: ApplicationObservability;
      readonly onStateChange?: (state: DeletionRunState) => void;
      readonly onConversationRemoved?: (conversationId: string) => void;
      readonly onLockUnavailable?: () => void;
    },
  ) {
    if (!isValidRequestsPerMinute(input.requestsPerMinute)) {
      throw new RangeError(
        `requestsPerMinute must be an integer from ${AppConfig.deletion.requestsPerMinute.min} to ${AppConfig.deletion.requestsPerMinute.max}`,
      );
    }
    const maximumConcurrentDeleteRequests =
      input.maximumConcurrentDeleteRequests ??
      AppConfig.deletion.maximumConcurrentDeleteRequests.default;
    if (
      !isValidMaximumConcurrentDeleteRequests(maximumConcurrentDeleteRequests)
    ) {
      throw new RangeError(
        `maximumConcurrentDeleteRequests must be an integer from ${AppConfig.deletion.maximumConcurrentDeleteRequests.min} to ${AppConfig.deletion.maximumConcurrentDeleteRequests.max}`,
      );
    }
    this.confirmedPlan = input.confirmedPlan;
    this.requestsPerMinute = input.requestsPerMinute;
    this.maximumConcurrentDeleteRequests = maximumConcurrentDeleteRequests;
    this.retryDeleteTimeouts = AppConfig.deletion.retryDeleteTimeouts;
    this.scheduledDeletions = this.createScheduledDeletions(
      input.confirmedPlan.confirmedConversationIds,
    );
    this.state = { kind: "ready", progress: this.progress(false) };
  }

  public getState(): DeletionRunState {
    return this.state;
  }

  public async startDeletion(): Promise<DeletionRunState> {
    if (this.state.kind !== "ready") return this.state;
    return this.runWithLock();
  }

  public pauseDeletion(): void {
    if (this.state.kind !== "running") return;
    this.command = "pause";
    this.publish("pausing");
    this.wakeScheduler();
  }

  public resumeDeletion(): void {
    if (this.state.kind !== "paused" || this.pendingProtectionMutation !== null)
      return;
    this.resolveResumeDecision?.("resume");
  }

  public async runProtectionMutation<T>(work: () => Promise<T>): Promise<T> {
    if (
      this.state.kind !== "paused" ||
      this.command !== "pause" ||
      this.pendingProtectionMutation !== null
    ) {
      throw createAppError("StorageFailure", {
        operation: "protectedStore.mutate",
      });
    }
    const mutation = Promise.resolve().then(work);
    const barrier = mutation.then(
      () => undefined,
      () => this.blockForPendingProtectionFailure(),
    );
    this.pendingProtectionMutation = barrier;
    try {
      return await mutation;
    } finally {
      await barrier;
      if (this.pendingProtectionMutation === barrier)
        this.pendingProtectionMutation = null;
    }
  }

  public stopDeletion(): void {
    if (!canStopDeletionRun(this.state)) return;
    this.command = "stop";
    this.publish("stopping");
    this.wakeScheduler();
    this.resolveResumeDecision?.("stop");
  }

  public async retryFailedDeletion(): Promise<DeletionRunState> {
    if (!canRetryFailedDeletion(this.state)) return this.state;
    return this.runWithLock({
      prepareAfterLockAcquired: () => {
        const failedIds = new Set(this.failedConversationIds);
        const retryIds = this.confirmedPlan.confirmedConversationIds.filter(
          (id) => failedIds.has(id),
        );
        this.resetCurrentRun(retryIds);
      },
      preserveRetryabilityOnContention: true,
    });
  }

  private async runWithLock(options?: {
    readonly prepareAfterLockAcquired: () => void;
    readonly preserveRetryabilityOnContention: boolean;
  }): Promise<DeletionRunState> {
    const lockResult: LockResult<void> =
      await this.input.destructiveRunLock.runExclusive(async () => {
        try {
          options?.prepareAfterLockAcquired();
          const protectionResult =
            await this.removeCurrentlyProtectedPendingIds();
          if (protectionResult === "blocked") return;
          if (protectionResult === "empty") {
            this.completeRun();
            return;
          }
          this.beginExecution();
          await this.runScheduler();
        } finally {
          await this.waitForPendingProtectionMutation();
        }
      });
    if (lockResult.kind === "unavailable") {
      this.logWarn("deletion.run.blocked", { lockReason: "unavailable" });
      if (options?.preserveRetryabilityOnContention === true) {
        this.input.onLockUnavailable?.();
        return this.state;
      }
      this.publish("blocked", "destructive-run-lock");
    }
    return this.state;
  }

  private beginExecution(): void {
    this.operationId =
      this.input.observability?.createOperationId() ?? this.operationId;
    this.command = "run";
    this.activeStartedAt = this.input.clock.now();
    this.publish("running");
    this.logInfo("deletion.run.started", {
      total: this.scheduledDeletions.length,
      requestsPerMinute: this.requestsPerMinute,
      maximumConcurrentDeleteRequests: this.maximumConcurrentDeleteRequests,
    });
  }

  private async runScheduler(): Promise<void> {
    while (true) {
      if (!this.launchGateOpen()) {
        if (this.activeRequestCount > 0) {
          await this.waitForSchedulerWake();
          continue;
        }
        if (this.fatal !== null) {
          this.publishFatal();
          return;
        }
        if (this.command === "stop") {
          await this.publishStoppedAfterPendingProtection();
          return;
        }
        if (!(await this.waitForResume())) return;
        continue;
      }

      if (this.scheduledDeletions.length === 0) {
        this.completeRun();
        return;
      }

      const now = this.input.clock.now();
      const eligible = this.findEligibleDeletion(now);
      const hasCapacity =
        this.activeRequestCount < this.maximumConcurrentDeleteRequests;
      const nextStartAt = Math.max(
        this.nextRateLimitedStartAt(),
        this.globalCooldownUntil,
      );
      if (hasCapacity && eligible !== undefined && now >= nextStartAt) {
        this.startDeleteAttempt(eligible);
        continue;
      }
      if (!hasCapacity || this.noPendingDeletions()) {
        await this.waitForSchedulerWake();
        continue;
      }
      const wakeAt = Math.max(nextStartAt, this.earliestPendingReadyAt());
      await this.waitForSchedulerWake(Math.max(0, wakeAt - now));
    }
  }

  private startDeleteAttempt(deletion: ScheduledDeletion): void {
    deletion.state = "active";
    deletion.attempt += 1;
    this.activeRequestCount += 1;
    this.lastAttemptStartedAt = this.input.clock.now();
    this.publish("running");

    let attempt: Promise<DeleteAttemptResult>;
    try {
      attempt = this.input.gateway.deleteConversation(deletion.conversationId, {
        onResponseSlow: () => this.reportSlowDeleteResponse(deletion),
      });
    } catch (cause) {
      this.applyRejectedAttempt(deletion, cause);
      return;
    }
    attempt.then(
      (result) => this.applyAttemptResult(deletion, result),
      (cause: unknown) => this.applyRejectedAttempt(deletion, cause),
    );
  }

  private applyAttemptResult(
    deletion: ScheduledDeletion,
    result: DeleteAttemptResult,
  ): void {
    if (!this.releaseActiveReservation(deletion)) return;
    if (result.kind === "deleted" || result.kind === "skipped") {
      this.applyTerminalSuccess(deletion, result.kind);
      this.wakeScheduler();
      return;
    }
    if (result.kind === "fatal") {
      this.logWarn("deletion.attempt.failed", {
        ordinal: deletion.ordinal,
        total: this.currentTotal(),
        attempt: deletion.attempt,
        errorCode: result.error.code,
      });
      this.latchFatal(result.reason, result.error.code);
      this.publishTransientProgress();
      this.wakeScheduler();
      return;
    }

    const observedAt = this.input.clock.now();
    if (result.reason === "rate-limit" && result.retryAfterMs !== undefined) {
      this.globalCooldownUntil = Math.max(
        this.globalCooldownUntil,
        observedAt + result.retryAfterMs,
      );
    }
    const retryDisabled =
      result.reason === "delete-timeout" && !this.retryDeleteTimeouts;
    if (
      retryDisabled ||
      deletion.attempt >= AppConfig.deletion.maxAttemptsPerConversation
    ) {
      this.logWarn("deletion.attempt.failed", {
        ordinal: deletion.ordinal,
        total: this.currentTotal(),
        attempt: deletion.attempt,
        errorCode: retryableFailureErrorCode(result.reason),
      });
      this.counts.failed += 1;
      this.failedConversationIds.add(deletion.conversationId);
      this.removeScheduledDeletion(deletion);
      this.publishTransientProgress();
      this.wakeScheduler();
      return;
    }

    this.counts.retries += 1;
    const retryDelay = this.retryDelay(result, deletion.attempt);
    deletion.readyAt = observedAt + retryDelay;
    this.logDebug("deletion.attempt.retry", {
      ordinal: deletion.ordinal,
      total: this.currentTotal(),
      attempt: deletion.attempt,
      reason: result.reason,
      delayMs: retryDelay,
    });
    this.publishTransientProgress();
    this.wakeScheduler();
  }

  private applyRejectedAttempt(
    deletion: ScheduledDeletion,
    cause: unknown,
  ): void {
    if (!this.releaseActiveReservation(deletion)) return;
    const error = createAppError("UnexpectedFailure", {
      operation: "conversation.delete",
      cause,
    });
    this.logWarn("deletion.attempt.failed", {
      ordinal: deletion.ordinal,
      total: this.currentTotal(),
      attempt: deletion.attempt,
      errorCode: error.code,
    });
    this.latchFatal("unexpected-run-error", error.code);
    this.publishTransientProgress();
    this.wakeScheduler();
  }

  private releaseActiveReservation(deletion: ScheduledDeletion): boolean {
    if (deletion.state !== "active") return false;
    deletion.state = "pending";
    this.activeRequestCount -= 1;
    return true;
  }

  private reportSlowDeleteResponse(deletion: ScheduledDeletion): void {
    if (deletion.state !== "active" || this.slowDeleteResponseDetected) return;
    this.slowDeleteResponseDetected = true;
    this.publishTransientProgress();
  }

  private applyTerminalSuccess(
    deletion: ScheduledDeletion,
    kind: "deleted" | "skipped",
  ): void {
    if (kind === "deleted") this.counts.deleted += 1;
    if (kind === "skipped") this.counts.skipped += 1;
    this.removeScheduledDeletion(deletion);
    this.input.onConversationRemoved?.(deletion.conversationId);
    this.publishTransientProgress();
  }

  private latchFatal(reason: SafetyBlockReason, errorCode: AppErrorCode): void {
    if (this.fatal !== null) return;
    this.fatal = { reason, errorCode };
    this.wakeScheduler();
  }

  private publishFatal(): void {
    const fatal = this.fatal;
    if (fatal === null) return;
    this.finishActivePeriod();
    this.publish("fatal", fatal.reason);
    this.input.observability?.error(
      "deletion.run.failed",
      fatal.errorCode,
      this.logFields({
        processedCount: this.progress(false).processed,
        remainingCount: this.scheduledDeletions.length,
      }),
    );
  }

  private async waitForResume(): Promise<boolean> {
    this.finishActivePeriod();
    this.publish("paused");
    const decision = await new Promise<ResumeDecision>((resolve) => {
      this.resolveResumeDecision = resolve;
    });
    this.resolveResumeDecision = null;
    if (decision === "stop") {
      await this.publishStoppedAfterPendingProtection();
      return false;
    }
    const protectionResult = await this.removeCurrentlyProtectedPendingIds();
    if (protectionResult === "blocked") {
      this.command = "stop";
      return false;
    }
    if (protectionResult === "empty") {
      this.command = "run";
      this.completeRun();
      return false;
    }
    this.command = "run";
    this.activeStartedAt = this.input.clock.now();
    this.publish("running");
    return true;
  }

  private async publishStoppedAfterPendingProtection(): Promise<void> {
    this.finishActivePeriod();
    await this.waitForPendingProtectionMutation();
    if (this.state.kind === "blocked") return;
    if (this.fatal !== null) {
      this.publishFatal();
      return;
    }
    this.publish("stopped");
    this.logInfo("deletion.run.stopped", {
      processedCount: this.progress(false).processed,
      remainingCount: this.scheduledDeletions.length,
    });
  }

  private async removeCurrentlyProtectedPendingIds(): Promise<LocalProtectionResult> {
    let protectedIdsResult;
    try {
      protectedIdsResult =
        await this.input.protectedConversationStore.loadProtectedConversationIds();
    } catch {
      return this.blockForProtectedStorage();
    }
    if (protectedIdsResult.kind === "invalid")
      return this.blockForProtectedStorage();
    this.scheduledDeletions = this.scheduledDeletions.filter(
      ({ conversationId, state }) =>
        state === "active" ||
        !protectedIdsResult.protectedConversationIds.has(conversationId),
    );
    return this.scheduledDeletions.length > 0 ? "ready" : "empty";
  }

  private blockForProtectedStorage(): LocalProtectionResult {
    this.logWarn("deletion.run.protectedStateBlocked");
    this.publish("blocked", "protected-storage");
    return "blocked";
  }

  private blockForPendingProtectionFailure(): void {
    this.command = "stop";
    this.finishActivePeriod();
    this.logWarn("deletion.run.protectedStateBlocked");
    this.publish("blocked", "protected-storage");
    this.wakeScheduler();
    this.resolveResumeDecision?.("stop");
  }

  private async waitForPendingProtectionMutation(): Promise<void> {
    await this.pendingProtectionMutation;
  }

  private completeRun(): void {
    this.finishActivePeriod();
    this.publish("finished");
    const finalProgress = this.progress(false);
    this.logInfo("deletion.run.completed", {
      total: finalProgress.total,
      deletedCount: finalProgress.deleted,
      failedCount: finalProgress.failed,
      skippedCount: finalProgress.skipped,
      retryCount: finalProgress.retries,
    });
  }

  private retryDelay(
    result: Extract<DeleteAttemptResult, { readonly kind: "retryable" }>,
    attempt: number,
  ): number {
    const fallbackDelay = Math.min(
      AppConfig.deletion.retryBaseDelayMs * 2 ** (attempt - 1),
      AppConfig.deletion.retryMaxDelayMs,
    );
    return result.retryAfterMs ?? fallbackDelay;
  }

  private launchGateOpen(): boolean {
    return this.command === "run" && this.fatal === null;
  }

  private findEligibleDeletion(now: number): ScheduledDeletion | undefined {
    return this.scheduledDeletions.find(
      ({ state, readyAt }) => state === "pending" && readyAt <= now,
    );
  }

  private noPendingDeletions(): boolean {
    return this.scheduledDeletions.every(({ state }) => state === "active");
  }

  private earliestPendingReadyAt(): number {
    let earliest = Number.POSITIVE_INFINITY;
    for (const deletion of this.scheduledDeletions) {
      if (deletion.state === "pending")
        earliest = Math.min(earliest, deletion.readyAt);
    }
    return earliest;
  }

  private nextRateLimitedStartAt(): number {
    if (this.lastAttemptStartedAt === null) return 0;
    return (
      this.lastAttemptStartedAt +
      MILLISECONDS_PER_MINUTE / this.requestsPerMinute
    );
  }

  private async waitForSchedulerWake(delayMs?: number): Promise<void> {
    const controller = new AbortController();
    this.schedulerWaitAbortController = controller;
    const wake = new Promise<void>((resolve) => {
      this.resolveSchedulerWake = resolve;
    });
    if (delayMs === undefined) {
      await wake;
    } else {
      await Promise.race([
        this.input.clock.sleep(delayMs, controller.signal),
        wake,
      ]);
    }
    if (this.schedulerWaitAbortController === controller) {
      this.schedulerWaitAbortController = null;
      this.resolveSchedulerWake = null;
    }
  }

  private wakeScheduler(): void {
    this.schedulerWaitAbortController?.abort();
    this.resolveSchedulerWake?.();
  }

  private removeScheduledDeletion(deletion: ScheduledDeletion): void {
    const index = this.scheduledDeletions.indexOf(deletion);
    if (index >= 0) this.scheduledDeletions.splice(index, 1);
  }

  private createScheduledDeletions(
    conversationIds: readonly string[],
  ): ScheduledDeletion[] {
    return conversationIds.map((conversationId, index) => ({
      conversationId,
      ordinal: index + 1,
      attempt: 0,
      readyAt: 0,
      state: "pending",
    }));
  }

  private finishActivePeriod(): void {
    if (this.activeStartedAt === null) return;
    this.activeElapsedMs += this.input.clock.now() - this.activeStartedAt;
    this.activeStartedAt = null;
  }

  private resetCurrentRun(conversationIds: readonly string[]): void {
    this.command = "run";
    this.scheduledDeletions = this.createScheduledDeletions(conversationIds);
    this.failedConversationIds = new Set<string>();
    this.counts = { deleted: 0, failed: 0, skipped: 0, retries: 0 };
    this.activeRequestCount = 0;
    this.activeElapsedMs = 0;
    this.activeStartedAt = null;
    this.fatal = null;
  }

  private currentTotal(): number {
    return (
      this.counts.deleted +
      this.counts.failed +
      this.counts.skipped +
      this.scheduledDeletions.length
    );
  }

  private progress(paused: boolean): DeletionRunProgress {
    const activeElapsedMs =
      this.activeStartedAt === null
        ? this.activeElapsedMs
        : this.activeElapsedMs +
          (this.input.clock.now() - this.activeStartedAt);
    const progress = calculateDeletionProgress({
      total: this.currentTotal(),
      ...this.counts,
      requestsPerMinute: this.requestsPerMinute,
      activeElapsedMs,
      paused,
    });
    return {
      ...progress,
      activeRequestCount: this.activeRequestCount,
      maximumConcurrentDeleteRequests: this.maximumConcurrentDeleteRequests,
      failedConversationIds: this.confirmedPlan.confirmedConversationIds.filter(
        (conversationId) => this.failedConversationIds.has(conversationId),
      ),
      slowDeleteResponseDetected: this.slowDeleteResponseDetected,
    };
  }

  private publishTransientProgress(): void {
    if (this.command === "pause") {
      this.publish("pausing");
      return;
    }
    if (this.command === "stop") {
      this.publish("stopping");
      return;
    }
    this.publish("running");
  }

  private publish(
    kind: DeletionRunState["kind"],
    reason?: SafetyBlockReason,
  ): void {
    const progress = this.progress(kind === "paused");
    this.state =
      kind === "blocked" || kind === "fatal"
        ? { kind, reason: reason ?? "unexpected-run-error", progress }
        : { kind, progress };
    this.input.onStateChange?.(this.state);
  }

  private logFields(
    fields: Readonly<Record<string, string | number | boolean | null>> = {},
  ): Readonly<Record<string, string | number | boolean | null>> {
    return {
      ...(this.operationId === null ? {} : { operationId: this.operationId }),
      ...fields,
    };
  }

  private logInfo(
    event: string,
    fields?: Readonly<Record<string, string | number | boolean | null>>,
  ): void {
    this.input.observability?.info(event, this.logFields(fields));
  }

  private logDebug(
    event: string,
    fields?: Readonly<Record<string, string | number | boolean | null>>,
  ): void {
    this.input.observability?.debug(event, this.logFields(fields));
  }

  private logWarn(
    event: string,
    fields?: Readonly<Record<string, string | number | boolean | null>>,
  ): void {
    this.input.observability?.warn(event, this.logFields(fields));
  }
}

function retryableFailureErrorCode(
  reason: Extract<
    DeleteAttemptResult,
    { readonly kind: "retryable" }
  >["reason"],
): AppErrorCode {
  if (reason === "rate-limit") return appErrorCode("RateLimited");
  if (reason === "server" || reason === "delete-timeout")
    return appErrorCode("ServerFailure");
  return appErrorCode("NetworkFailure");
}
