import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  canRetryFailedDeletion,
  DeletionRun,
  deletionRunOwnsWorkflow,
  isDeletionRunActive,
  type DeletionRunState,
} from "../../../application/deletionRun";
import type { ManagerDependencies } from "../../../composition/types";
import type { Conversation } from "../../../domain/conversation";
import {
  buildDeletionPlan,
  shrinkConfirmedDeletionPlan,
  type ConfirmedDeletionPlan,
  type DeletionPlan,
} from "../../../domain/deletionPlan";
import {
  isSafetyOverrideRevalidatedByCompleteRefresh,
  type SafetyBlockReason,
} from "../../../application/SafetyBlockReason";

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
  readonly onOperationAttempt: () => void;
  readonly onOperationLockConflict: () => void;
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
  onOperationAttempt,
  onOperationLockConflict,
}: UseDeletionWorkflowOptions) {
  const { t } = useTranslation();
  const [previewPlan, setPreviewPlan] = useState<DeletionPlan | null>(null);
  const [currentRun, setCurrentRun] = useState<DeletionRun | null>(null);
  const [runState, setRunState] = useState<DeletionRunState | null>(null);
  const [safetyOverride, setSafetyOverride] =
    useState<SafetyBlockReason | null>(null);
  const executionStartedRef = useRef(false);

  const runActive = isDeletionRunActive(runState);
  const runOwnsWorkflow = deletionRunOwnsWorkflow(runState);
  const deletionAvailable = inventoryReady && safetyOverride === null;
  const retryFailedAvailable =
    deletionAvailable && runState !== null && canRetryFailedDeletion(runState);

  const beginDeletionPreview = () => {
    if (
      dependencies === null ||
      !inventoryReady ||
      selectedConversationIds.size === 0 ||
      runOwnsWorkflow
    ) {
      return;
    }

    const operationId = dependencies.observability?.createOperationId();
    dependencies.observability?.info("deletion.preview.started", {
      ...(operationId === undefined ? {} : { operationId }),
      selectedCount: selectedConversationIds.size,
    });
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
      onNotice(t("deletion.noEligibleSelected"));
      return;
    }
    setPreviewPlan(plan);
  };

  const handleRunStateChange = (nextState: DeletionRunState) => {
    if (nextState.kind === "running") executionStartedRef.current = true;
    if (
      nextState.kind === "blocked" &&
      nextState.reason === "destructive-run-lock"
    ) {
      onOperationLockConflict();
      if (!executionStartedRef.current) setCurrentRun(null);
      return;
    }
    if (nextState.kind === "blocked" && !executionStartedRef.current) {
      setSafetyOverride(nextState.reason);
      setCurrentRun(null);
      return;
    }
    if (nextState.kind === "finished" && !executionStartedRef.current) {
      setCurrentRun(null);
      onNotice(t("deletion.noEligibleConfirmed"));
      return;
    }
    setRunState(nextState);
    if (nextState.kind === "blocked" || nextState.kind === "fatal") {
      setSafetyOverride(nextState.reason);
    }
  };

  const recordUnexpectedRunFailure = (deletionRun: DeletionRun) => {
    setSafetyOverride("unexpected-run-error");
    if (!executionStartedRef.current) {
      setCurrentRun(null);
      return;
    }
    setRunState({
      kind: "fatal",
      reason: "unexpected-run-error",
      progress: deletionRun.getState().progress,
    });
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
      onNotice(t("deletion.noEligibleConfirmed"));
      return;
    }

    onOperationAttempt();
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
      onLockUnavailable: onOperationLockConflict,
    });
    executionStartedRef.current = false;
    setCurrentRun(deletionRun);
    deletionRun
      .startDeletion()
      .catch(() => recordUnexpectedRunFailure(deletionRun));
  };

  const retryFailed = () => {
    if (
      currentRun === null ||
      !deletionAvailable ||
      !canRetryFailedDeletion(currentRun.getState())
    ) {
      return;
    }
    onOperationAttempt();
    currentRun
      .retryFailedDeletion()
      .catch(() => recordUnexpectedRunFailure(currentRun));
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

  const cancelConfirmation = useCallback(() => {
    setPreviewPlan(null);
  }, []);

  const recoverSafetyAfterCompleteRefresh = useCallback(() => {
    setSafetyOverride((currentReason) => {
      if (currentReason === null) return null;
      return isSafetyOverrideRevalidatedByCompleteRefresh(currentReason)
        ? null
        : currentReason;
    });
  }, []);

  return {
    previewPlan,
    runState,
    runActive,
    runOwnsWorkflow,
    retryFailedAvailable,
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
    recoverSafetyAfterCompleteRefresh,
    blockSafety: setSafetyOverride,
  } as const;
}
