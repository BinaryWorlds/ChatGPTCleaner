import { useState } from "react";
import { DeletionRun, type DeletionRunState } from "../application/deletionRun";
import type { ManagerDependencies } from "../composition/types";
import type { Conversation } from "../domain/conversation";
import {
  buildDeletionPlan,
  shrinkConfirmedDeletionPlan,
  type ConfirmedDeletionPlan,
  type DeletionPlan,
} from "../domain/deletionPlan";
import type { SafetyBlockReason } from "../application/SafetyBlockReason";

interface UseDeletionWorkflowOptions {
  readonly dependencies: ManagerDependencies | null;
  readonly inventoryReady: boolean;
  readonly standaloneConversations: readonly Conversation[];
  readonly projectConversationIds: ReadonlySet<string>;
  readonly protectedConversationIds: ReadonlySet<string>;
  readonly selectedConversationIds: ReadonlySet<string>;
  readonly requestsPerMinute: number;
  readonly isProtectionMutationPending: () => boolean;
  readonly onConversationRemoved: (conversationId: string) => void;
  readonly onNotice: (message: string) => void;
}

function isRunActive(state: DeletionRunState | null): boolean {
  return (
    state?.kind === "running" ||
    state?.kind === "pausing" ||
    state?.kind === "paused" ||
    state?.kind === "stopping"
  );
}

function isProtectionLocked(state: DeletionRunState | null): boolean {
  return (
    state?.kind === "running" ||
    state?.kind === "pausing" ||
    state?.kind === "stopping"
  );
}

export function useDeletionWorkflow({
  dependencies,
  inventoryReady,
  standaloneConversations,
  projectConversationIds,
  protectedConversationIds,
  selectedConversationIds,
  requestsPerMinute,
  isProtectionMutationPending,
  onConversationRemoved,
  onNotice,
}: UseDeletionWorkflowOptions) {
  const [previewPlan, setPreviewPlan] = useState<DeletionPlan | null>(null);
  const [currentRun, setCurrentRun] = useState<DeletionRun | null>(null);
  const [runState, setRunState] = useState<DeletionRunState | null>(null);
  const [safetyOverride, setSafetyOverride] =
    useState<SafetyBlockReason | null>(null);

  const runActive = isRunActive(runState);
  const protectionLocked = isProtectionLocked(runState);

  const beginDeletionPreview = () => {
    if (
      dependencies === null ||
      !inventoryReady ||
      selectedConversationIds.size === 0 ||
      runActive
    ) {
      return;
    }

    const operationId = dependencies.observability?.createOperationId();
    dependencies.observability?.info("deletion.preview.started", {
      ...(operationId === undefined ? {} : { operationId }),
      selectedCount: selectedConversationIds.size,
    });
    setSafetyOverride(null);
    const plan = buildDeletionPlan({
      selectedConversationIds: [...selectedConversationIds],
      standaloneConversations,
      projectConversationIds,
      protectedConversationIds,
    });
    dependencies.observability?.info("deletion.preview.completed", {
      ...(operationId === undefined ? {} : { operationId }),
      selectedCount: plan.originallySelectedCount,
      eligibleCount: plan.eligibleConversationIds.length,
      excludedProjectCount: plan.excludedProjectIds.length,
      excludedProtectedCount: plan.excludedProtectedIds.length,
      missingCount:
        plan.missingConversationIds.length + plan.invalidSelectionCount,
    });
    if (plan.eligibleConversationIds.length === 0) {
      onNotice("No selected conversations remain eligible for deletion.");
      return;
    }
    setPreviewPlan(plan);
  };

  const handleRunStateChange = (nextState: DeletionRunState) => {
    setRunState(nextState);
    if (nextState.kind === "blocked" || nextState.kind === "fatal") {
      setSafetyOverride(nextState.reason);
    }
  };

  const confirmAndStartDeletion = (confirmedPlan: ConfirmedDeletionPlan) => {
    if (dependencies === null || previewPlan === null) return;

    const snapshotConfirmedPlan = shrinkConfirmedDeletionPlan(confirmedPlan, {
      projectConversationIds,
      protectedConversationIds,
      standaloneConversationIds: new Set(
        standaloneConversations.map(({ id }) => id),
      ),
    });
    setPreviewPlan(null);
    if (snapshotConfirmedPlan.confirmedConversationIds.length === 0) {
      onNotice("No confirmed conversations remain eligible for deletion.");
      return;
    }

    const deletionRun = new DeletionRun({
      confirmedPlan: snapshotConfirmedPlan,
      requestsPerMinute,
      gateway: dependencies.gateway,
      protectedConversationStore: dependencies.protectedConversationStore,
      clock: dependencies.clock,
      destructiveRunLock: dependencies.destructiveRunLock,
      ...(dependencies.observability === undefined
        ? {}
        : { observability: dependencies.observability }),
      onStateChange: handleRunStateChange,
      onConversationRemoved,
    });
    setCurrentRun(deletionRun);
    deletionRun
      .startDeletion()
      .catch(() => setSafetyOverride("unexpected-run-error"));
  };

  const retryFailed = () => {
    currentRun
      ?.retryFailedDeletion()
      .catch(() => setSafetyOverride("unexpected-run-error"));
  };

  const resumeRun = () => {
    if (
      dependencies === null ||
      currentRun === null ||
      isProtectionMutationPending()
    ) {
      return;
    }
    currentRun.resumeDeletion();
  };

  const cancelConfirmation = () => {
    setPreviewPlan(null);
  };

  return {
    previewPlan,
    runState,
    runActive,
    protectionLocked,
    protectionMutationLockOwner:
      runState?.kind === "paused" ? currentRun : null,
    safetyOverride,
    currentConversationId: runState?.progress.currentConversationId ?? null,
    beginDeletionPreview,
    confirmAndStartDeletion,
    retryFailed,
    resumeRun,
    pauseRun: () => currentRun?.pauseDeletion(),
    stopRun: () => currentRun?.stopDeletion(),
    cancelConfirmation,
    blockSafety: setSafetyOverride,
  } as const;
}
