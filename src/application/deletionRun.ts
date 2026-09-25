import {
  shrinkConfirmedDeletionPlan,
  type ConfirmedDeletionPlan,
} from "../domain/deletionPlan";
import {
  calculateDeletionProgress,
  type DeletionProgress,
} from "../domain/progress";
import { AppConfig } from "../config";
import type { Clock } from "./ports/Clock";
import type {
  ConversationGateway,
  DeleteAttemptResult,
} from "./ports/ConversationGateway";
import { ChatGptOperation } from "./ports/ConversationGateway";
import { appErrorCode, type AppErrorCode } from "./AppError";
import type { DestructiveRunLock } from "./ports/DestructiveRunLock";
import type { ProtectedConversationStore } from "./ports/ProtectedConversationStore";
import type { ApplicationObservability } from "./ports/Observability";
import { ApiRequestLifecycleEvent } from "./ports/Observability";
import { runPreflight } from "./preflight";
import { isValidRequestsPerMinute } from "./settings";
import type { SafetyBlockReason } from "./SafetyBlockReason";

const MILLISECONDS_PER_MINUTE = 60_000;

export interface DeletionRunProgress extends DeletionProgress {
  readonly currentConversationId: string | null;
  readonly failedConversationIds: readonly string[];
  readonly removedConversationIds: readonly string[];
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

type ControlCommand = "run" | "pause" | "stop";
type ResumeDecision = "resume" | "stop";
type RemainingRevalidationResult =
  | { readonly kind: "ready" | "empty" }
  | { readonly kind: "blocked"; readonly reason: SafetyBlockReason };

interface MutableRunCounts {
  deleted: number;
  failed: number;
  skipped: number;
  retries: number;
}

export class DeletionRun {
  private state: DeletionRunState;
  private command: ControlCommand = "run";
  private waitAbortController: AbortController | null = null;
  private resolveResumeDecision: ((decision: ResumeDecision) => void) | null =
    null;
  private readonly confirmedPlan: ConfirmedDeletionPlan;
  private remainingConversationIds: string[];
  private failedConversationIds: string[] = [];
  private removedConversationIds: string[] = [];
  private counts: MutableRunCounts = {
    deleted: 0,
    failed: 0,
    skipped: 0,
    retries: 0,
  };
  private activeElapsedMs = 0;
  private activeStartedAt: number | null = null;
  private lastAttemptStartedAt: number | null = null;
  private operationId: string | null = null;

  public constructor(
    private readonly input: {
      readonly confirmedPlan: ConfirmedDeletionPlan;
      readonly requestsPerMinute: number;
      readonly gateway: ConversationGateway;
      readonly protectedConversationStore: ProtectedConversationStore;
      readonly clock: Clock;
      readonly destructiveRunLock: DestructiveRunLock;
      readonly observability?: ApplicationObservability;
      readonly onStateChange?: (state: DeletionRunState) => void;
    },
  ) {
    if (!isValidRequestsPerMinute(input.requestsPerMinute)) {
      throw new RangeError(
        `requestsPerMinute must be an integer from ${AppConfig.deletion.requestsPerMinute.min} to ${AppConfig.deletion.requestsPerMinute.max}`,
      );
    }
    this.confirmedPlan = input.confirmedPlan;
    this.remainingConversationIds = [
      ...input.confirmedPlan.confirmedConversationIds,
    ];
    this.state = { kind: "ready", progress: this.progress(null, false) };
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
    this.logInfo("deletion.run.pausing");
    this.publish("pausing", null);
    this.waitAbortController?.abort();
  }

  public resumeDeletion(): void {
    if (this.state.kind !== "paused") return;
    this.logInfo("deletion.run.resumeRequested");
    this.resolveResumeDecision?.("resume");
  }

  public stopDeletion(): void {
    if (
      this.state.kind !== "running" &&
      this.state.kind !== "pausing" &&
      this.state.kind !== "paused"
    ) {
      return;
    }

    this.command = "stop";
    this.logInfo("deletion.run.stopping");
    this.publish("stopping", null);
    this.waitAbortController?.abort();
    this.resolveResumeDecision?.("stop");
  }

  public async retryFailedDeletion(): Promise<DeletionRunState> {
    if (
      this.state.kind !== "finished" &&
      this.state.kind !== "stopped" &&
      this.state.kind !== "fatal"
    ) {
      return this.state;
    }
    if (this.failedConversationIds.length === 0) return this.state;

    const preflightResult = await runPreflight({
      selectedConversationIds: this.failedConversationIds,
      gateway: this.input.gateway,
      protectedConversationStore: this.input.protectedConversationStore,
    });
    if (preflightResult.kind === "blocked") {
      this.publish("blocked", null, preflightResult.reason);
      return this.state;
    }

    const retryPlan = shrinkConfirmedDeletionPlan(
      this.confirmedPlan,
      preflightResult.plan,
    );
    const failedIds = new Set(this.failedConversationIds);
    this.remainingConversationIds = retryPlan.confirmedConversationIds.filter(
      (conversationId) => failedIds.has(conversationId),
    );
    this.resetCurrentRun();
    if (this.remainingConversationIds.length === 0) {
      this.publish("finished", null);
      return this.state;
    }

    return this.runWithLock();
  }

  private async runWithLock(): Promise<DeletionRunState> {
    const lockResult = await this.input.destructiveRunLock.runExclusive(
      async () => {
        this.beginExecution();
        const revalidation = await this.revalidateRemainingConfirmedIds();
        if (revalidation.kind === "blocked") {
          this.finishActivePeriod();
          this.logWarn("deletion.run.revalidationBlocked", {
            reason: revalidation.reason,
          });
          this.publish("blocked", null, revalidation.reason);
          return;
        }
        if (revalidation.kind === "empty") {
          this.finishActivePeriod();
          this.completeRun();
          return;
        }
        await this.executeRemainingConversations();
      },
    );
    if (lockResult.kind === "unavailable") {
      this.logWarn("deletion.run.blocked", { lockReason: "unavailable" });
      this.publish("blocked", null, "destructive-run-lock");
    }
    return this.state;
  }

  private beginExecution(): void {
    this.operationId =
      this.input.observability?.createOperationId() ?? this.operationId;
    this.command = "run";
    this.activeStartedAt = this.input.clock.now();
    this.publish("running", null);
    this.logInfo("deletion.run.started", {
      total: this.remainingConversationIds.length,
      requestsPerMinute: this.input.requestsPerMinute,
    });
    this.logInfo("deletion.run.revalidationStarted", {
      remainingCount: this.remainingConversationIds.length,
    });
  }

  private async revalidateRemainingConfirmedIds(): Promise<RemainingRevalidationResult> {
    const preflightResult = await runPreflight({
      selectedConversationIds: this.remainingConversationIds,
      gateway: this.input.gateway,
      protectedConversationStore: this.input.protectedConversationStore,
    });
    if (preflightResult.kind === "blocked") {
      return { kind: "blocked", reason: preflightResult.reason };
    }

    const revalidatedPlan = shrinkConfirmedDeletionPlan(
      this.confirmedPlan,
      preflightResult.plan,
    );
    const remainingIds = new Set(this.remainingConversationIds);
    this.remainingConversationIds =
      revalidatedPlan.confirmedConversationIds.filter((conversationId) =>
        remainingIds.has(conversationId),
      );
    return {
      kind: this.remainingConversationIds.length === 0 ? "empty" : "ready",
    };
  }

  private async executeRemainingConversations(): Promise<void> {
    while (this.remainingConversationIds.length > 0) {
      const mayContinue = await this.waitForRunnableState();
      if (!mayContinue) break;

      const conversationId = this.remainingConversationIds[0];
      if (conversationId === undefined) break;

      const outcome = await this.deleteWithRetries(conversationId);
      if (outcome === "stopped") break;
      if (outcome === "excluded") continue;
      if (outcome.kind === "fatal") {
        this.finishActivePeriod();
        this.publish("fatal", conversationId, outcome.reason);
        this.input.observability?.error(
          "deletion.run.failed",
          outcome.errorCode,
          this.logFields({
            processedCount: this.progress(null, false).processed,
            remainingCount: this.remainingConversationIds.length,
          }),
        );
        return;
      }

      this.remainingConversationIds.shift();
      if (outcome.kind === "deleted") {
        this.counts.deleted += 1;
        this.removedConversationIds.push(conversationId);
      }
      if (outcome.kind === "skipped") {
        this.counts.skipped += 1;
        this.removedConversationIds.push(conversationId);
      }
      if (outcome.kind === "failed") {
        this.counts.failed += 1;
        this.failedConversationIds.push(conversationId);
      }
      this.publish("running", conversationId);
    }

    this.finishActivePeriod();
    if (this.state.kind === "blocked") return;
    if (this.isStopRequested()) {
      this.publish("stopped", null);
      this.logInfo("deletion.run.stopped", {
        processedCount: this.progress(null, false).processed,
        remainingCount: this.remainingConversationIds.length,
      });
      return;
    }
    this.completeRun();
  }

  private completeRun(): void {
    this.publish("finished", null);
    const finalProgress = this.progress(null, false);
    this.logInfo("deletion.run.completed", {
      total: finalProgress.total,
      deletedCount: finalProgress.deleted,
      failedCount: finalProgress.failed,
      skippedCount: finalProgress.skipped,
      retryCount: finalProgress.retries,
    });
  }

  private async deleteWithRetries(conversationId: string): Promise<
    | { readonly kind: "deleted" | "skipped" | "failed" }
    | {
        readonly kind: "fatal";
        readonly reason: Extract<
          DeleteAttemptResult,
          { readonly kind: "fatal" }
        >["reason"];
        readonly errorCode: AppErrorCode;
      }
    | "excluded"
    | "stopped"
  > {
    for (
      let attempt = 1;
      attempt <= AppConfig.deletion.maxAttemptsPerConversation;
      attempt += 1
    ) {
      if (!(await this.waitForRunnableState())) return "stopped";
      if (!this.remainingConversationIds.includes(conversationId)) {
        return "excluded";
      }
      if (!(await this.waitForAttemptSpacing())) {
        if (this.command === "stop") return "stopped";
        attempt -= 1;
        continue;
      }
      if (!(await this.waitForRunnableState())) return "stopped";
      if (!this.remainingConversationIds.includes(conversationId)) {
        return "excluded";
      }

      this.lastAttemptStartedAt = this.input.clock.now();
      this.publish("running", conversationId);
      const progressBeforeAttempt = this.progress(conversationId, false);
      const ordinal = progressBeforeAttempt.processed + 1;
      const attemptStartedAt = this.input.clock.now();
      this.logDebug("deletion.attempt.started", {
        ordinal,
        total: progressBeforeAttempt.total,
        attempt,
      });
      this.logDebug(ApiRequestLifecycleEvent.Started, {
        operation: ChatGptOperation.ConversationDelete,
        ordinal,
        attempt,
      });
      const result =
        await this.input.gateway.deleteConversation(conversationId);
      const requestDurationMs = this.input.clock.now() - attemptStartedAt;
      if (result.status !== undefined) {
        this.logDebug(ApiRequestLifecycleEvent.Succeeded, {
          operation: ChatGptOperation.ConversationDelete,
          status: result.status,
          durationMs: requestDurationMs,
          ordinal,
          attempt,
        });
      }

      if (result.kind === "deleted") {
        this.logDebug("deletion.attempt.succeeded", {
          ordinal,
          total: progressBeforeAttempt.total,
          attempt,
          durationMs: requestDurationMs,
        });
        return result;
      }
      if (result.kind === "skipped") {
        this.logInfo("deletion.attempt.skipped", {
          ordinal,
          total: progressBeforeAttempt.total,
          attempt,
          status: result.status,
        });
        return result;
      }
      if (result.kind === "fatal") {
        this.logWarn("deletion.attempt.failed", {
          ordinal,
          total: progressBeforeAttempt.total,
          attempt,
          errorCode: result.error.code,
        });
        return {
          ...result,
          errorCode: result.error.code,
        };
      }
      if (attempt === AppConfig.deletion.maxAttemptsPerConversation) {
        this.logWarn("deletion.attempt.failed", {
          ordinal,
          total: progressBeforeAttempt.total,
          attempt,
          errorCode: exhaustedRetryErrorCode(result.reason),
        });
        return { kind: "failed" };
      }

      this.counts.retries += 1;
      const retryDelay = this.retryDelay(result, attempt);
      this.logWarn("deletion.attempt.retry", {
        ordinal,
        total: progressBeforeAttempt.total,
        attempt,
        reason: result.reason,
        delayMs: retryDelay,
      });
      if (!(await this.sleep(retryDelay))) {
        if (this.command === "stop") return "stopped";
      }
    }

    return { kind: "failed" };
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

  private async waitForAttemptSpacing(): Promise<boolean> {
    if (this.lastAttemptStartedAt === null) return true;

    const interval = MILLISECONDS_PER_MINUTE / this.input.requestsPerMinute;
    const remaining =
      this.lastAttemptStartedAt + interval - this.input.clock.now();
    if (remaining <= 0) return true;
    return this.sleep(remaining);
  }

  private async sleep(milliseconds: number): Promise<boolean> {
    this.waitAbortController = new AbortController();
    const result = await this.input.clock.sleep(
      milliseconds,
      this.waitAbortController.signal,
    );
    this.waitAbortController = null;
    return result === "completed";
  }

  private async waitForRunnableState(): Promise<boolean> {
    if (this.command === "stop") return false;
    if (this.command === "run") return true;

    this.finishActivePeriod();
    this.publish("paused", null);
    this.logInfo("deletion.run.paused", {
      remainingCount: this.remainingConversationIds.length,
    });
    const decision = await new Promise<ResumeDecision>((resolve) => {
      this.resolveResumeDecision = resolve;
    });
    this.resolveResumeDecision = null;
    if (decision === "stop") return false;

    const resumeOperationId = this.input.observability?.createOperationId();
    this.input.observability?.info("deletion.run.revalidationStarted", {
      ...(resumeOperationId === undefined
        ? {}
        : { operationId: resumeOperationId }),
      remainingCount: this.remainingConversationIds.length,
    });

    const revalidation = await this.revalidateRemainingConfirmedIds();
    if (revalidation.kind === "blocked") {
      this.command = "stop";
      this.input.observability?.warn("deletion.run.revalidationBlocked", {
        ...(resumeOperationId === undefined
          ? {}
          : { operationId: resumeOperationId }),
        reason: revalidation.reason,
      });
      this.publish("blocked", null, revalidation.reason);
      return false;
    }
    this.command = "run";
    this.activeStartedAt = this.input.clock.now();
    this.publish("running", null);
    this.logInfo("deletion.run.resumed", {
      remainingCount: this.remainingConversationIds.length,
    });
    return true;
  }

  private finishActivePeriod(): void {
    if (this.activeStartedAt === null) return;
    this.activeElapsedMs += this.input.clock.now() - this.activeStartedAt;
    this.activeStartedAt = null;
  }

  private isStopRequested(): boolean {
    return this.command === "stop";
  }

  private resetCurrentRun(): void {
    this.command = "run";
    this.failedConversationIds = [];
    this.removedConversationIds = [];
    this.counts = { deleted: 0, failed: 0, skipped: 0, retries: 0 };
    this.activeElapsedMs = 0;
    this.activeStartedAt = null;
    this.lastAttemptStartedAt = null;
  }

  private progress(
    currentConversationId: string | null,
    paused: boolean,
  ): DeletionRunProgress {
    const activeElapsedMs =
      this.activeStartedAt === null
        ? this.activeElapsedMs
        : this.activeElapsedMs +
          (this.input.clock.now() - this.activeStartedAt);
    const progress = calculateDeletionProgress({
      total:
        this.counts.deleted +
        this.counts.failed +
        this.counts.skipped +
        this.remainingConversationIds.length,
      ...this.counts,
      requestsPerMinute: this.input.requestsPerMinute,
      activeElapsedMs,
      paused,
    });

    return {
      ...progress,
      currentConversationId,
      failedConversationIds: [...this.failedConversationIds],
      removedConversationIds: [...this.removedConversationIds],
    };
  }

  private publish(
    kind: DeletionRunState["kind"],
    currentConversationId: string | null,
    reason?: SafetyBlockReason,
  ): void {
    const progress = this.progress(currentConversationId, kind === "paused");
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

  private logDebug(
    event: string,
    fields?: Readonly<Record<string, string | number | boolean | null>>,
  ): void {
    this.input.observability?.debug(event, this.logFields(fields));
  }

  private logInfo(
    event: string,
    fields?: Readonly<Record<string, string | number | boolean | null>>,
  ): void {
    this.input.observability?.info(event, this.logFields(fields));
  }

  private logWarn(
    event: string,
    fields?: Readonly<Record<string, string | number | boolean | null>>,
  ): void {
    this.input.observability?.warn(event, this.logFields(fields));
  }
}

function exhaustedRetryErrorCode(
  reason: Extract<
    DeleteAttemptResult,
    { readonly kind: "retryable" }
  >["reason"],
): AppErrorCode {
  if (reason === "rate-limit") return appErrorCode("RateLimited");
  if (reason === "server") return appErrorCode("ServerFailure");
  return appErrorCode("NetworkFailure");
}
