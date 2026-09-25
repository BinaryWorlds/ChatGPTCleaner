import { useRef, useState } from "react";
import { appErrorCode } from "../application/AppError";
import { DeletionRun, type DeletionRunState } from "../application/deletionRun";
import { runPreflight } from "../application/preflight";
import type { ManagerDependencies } from "../composition/types";
import { confirmDeletionPlan, type DeletionPlan } from "../domain/deletionPlan";
import type { SafetyBlockReason } from "../application/SafetyBlockReason";

interface UseDeletionWorkflowOptions {
  readonly dependencies: ManagerDependencies | null;
  readonly inventoryReady: boolean;
  readonly selectedConversationIds: ReadonlySet<string>;
  readonly requestsPerMinute: number;
  readonly isProtectionMutationPending: () => boolean;
  readonly onConversationIdsRemoved: (
    conversationIds: ReadonlySet<string>,
  ) => void;
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

export function findUnappliedRemovedConversationIds(
  previouslyAppliedCount: number,
  removedConversationIds: readonly string[],
): { readonly ids: readonly string[]; readonly appliedCount: number } {
  const startIndex =
    removedConversationIds.length < previouslyAppliedCount
      ? 0
      : previouslyAppliedCount;
  return {
    ids: removedConversationIds.slice(startIndex),
    appliedCount: removedConversationIds.length,
  };
}

export function useDeletionWorkflow({
  dependencies,
  inventoryReady,
  selectedConversationIds,
  requestsPerMinute,
  isProtectionMutationPending,
  onConversationIdsRemoved,
  onNotice,
}: UseDeletionWorkflowOptions) {
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [preflightPlan, setPreflightPlan] = useState<DeletionPlan | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [currentRun, setCurrentRun] = useState<DeletionRun | null>(null);
  const [runState, setRunState] = useState<DeletionRunState | null>(null);
  const [safetyOverride, setSafetyOverride] =
    useState<SafetyBlockReason | null>(null);
  const appliedRemovedConversationCount = useRef(0);

  const runActive = isRunActive(runState);
  const protectionLocked = isProtectionLocked(runState);

  const beginPreflight = () => {
    if (
      dependencies === null ||
      !inventoryReady ||
      selectedConversationIds.size === 0 ||
      runActive
    ) {
      return;
    }

    const operationId = dependencies.observability?.createOperationId();
    dependencies.observability?.info("preflight.started", {
      ...(operationId === undefined ? {} : { operationId }),
      selectedCount: selectedConversationIds.size,
    });
    setPreflightRunning(true);
    setSafetyOverride(null);
    runPreflight({
      selectedConversationIds: [...selectedConversationIds],
      gateway: dependencies.gateway,
      protectedConversationStore: dependencies.protectedConversationStore,
    })
      .then((result) => {
        setPreflightRunning(false);
        if (result.kind === "blocked") {
          dependencies.observability?.warn("preflight.blocked", {
            ...(operationId === undefined ? {} : { operationId }),
            reason: result.reason,
          });
          setSafetyOverride(result.reason);
          return;
        }
        dependencies.observability?.info("preflight.completed", {
          ...(operationId === undefined ? {} : { operationId }),
          selectedCount: result.plan.originallySelectedCount,
          eligibleCount: result.plan.eligibleConversationIds.length,
          excludedProjectCount: result.plan.excludedProjectIds.length,
          excludedProtectedCount: result.plan.excludedProtectedIds.length,
          missingCount:
            result.plan.missingConversationIds.length +
            result.plan.invalidSelectionCount,
        });
        if (result.plan.eligibleConversationIds.length === 0) {
          onNotice("No selected conversations remain eligible for deletion.");
          return;
        }
        setConfirmationText("");
        setPreflightPlan(result.plan);
      })
      .catch(() => {
        dependencies.observability?.error(
          "application.operation.failed",
          appErrorCode("UnexpectedFailure"),
          {
            ...(operationId === undefined ? {} : { operationId }),
            operation: "preflight",
          },
        );
        setPreflightRunning(false);
        setSafetyOverride("network");
      });
  };

  const handleRunStateChange = (nextState: DeletionRunState) => {
    setRunState(nextState);
    if (nextState.kind === "blocked" || nextState.kind === "fatal") {
      setSafetyOverride(nextState.reason);
    }
    const unapplied = findUnappliedRemovedConversationIds(
      appliedRemovedConversationCount.current,
      nextState.progress.removedConversationIds,
    );
    appliedRemovedConversationCount.current = unapplied.appliedCount;
    if (unapplied.ids.length === 0) return;

    onConversationIdsRemoved(new Set(unapplied.ids));
  };

  const confirmAndStartDeletion = () => {
    if (dependencies === null || preflightPlan === null) return;
    const confirmation = confirmDeletionPlan(preflightPlan, confirmationText);
    if (confirmation.kind !== "confirmed") return;

    const deletionRun = new DeletionRun({
      confirmedPlan: confirmation.plan,
      requestsPerMinute,
      gateway: dependencies.gateway,
      protectedConversationStore: dependencies.protectedConversationStore,
      clock: dependencies.clock,
      destructiveRunLock: dependencies.destructiveRunLock,
      ...(dependencies.observability === undefined
        ? {}
        : { observability: dependencies.observability }),
      onStateChange: handleRunStateChange,
    });
    appliedRemovedConversationCount.current = 0;
    setCurrentRun(deletionRun);
    setPreflightPlan(null);
    setConfirmationText("");
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

  const resetWorkflow = () => {
    setPreflightRunning(false);
    setPreflightPlan(null);
    setConfirmationText("");
    setCurrentRun(null);
    setRunState(null);
    setSafetyOverride(null);
    appliedRemovedConversationCount.current = 0;
  };

  const cancelConfirmation = () => {
    setPreflightPlan(null);
    setConfirmationText("");
  };

  return {
    preflightRunning,
    preflightPlan,
    confirmationText,
    runState,
    runActive,
    protectionLocked,
    safetyOverride,
    currentConversationId: runState?.progress.currentConversationId ?? null,
    setConfirmationText,
    beginPreflight,
    confirmAndStartDeletion,
    retryFailed,
    resumeRun,
    pauseRun: () => currentRun?.pauseDeletion(),
    stopRun: () => currentRun?.stopDeletion(),
    cancelConfirmation,
    resetWorkflow,
    blockSafety: setSafetyOverride,
  } as const;
}
