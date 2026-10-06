import { Button } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  canRetryFailedDeletion,
  canStopDeletionRun,
  isDeletionRunActive,
  type DeletionRunState,
} from "../../application/deletionRun";
import { safetyBlockReasonLabel } from "./safetyStatusPresentation";
import { useSafetyAnnouncements } from "./useSafetyAnnouncements";
import OperationStatusStrip from "./OperationStatusStrip";
import type { SafetyStatusState } from "./safetyStatusContract";
import SafetyBlockAlert from "./SafetyBlockAlert";
import UnboundSafetyState from "./UnboundSafetyState";

interface SafetyStatusProps {
  readonly state: SafetyStatusState;
  readonly operationState?: DeletionRunState | null;
  readonly onRetry?: () => void;
  readonly onRetryFailed?: () => void;
  readonly onStop?: () => void;
}

export default function SafetyStatus({
  state,
  operationState = null,
  onRetry,
  onRetryFailed,
  onStop,
}: SafetyStatusProps) {
  const { t } = useTranslation();
  const operationKind = operationState?.kind ?? null;
  const operationReason =
    operationState?.kind === "blocked" || operationState?.kind === "fatal"
      ? operationState.reason
      : null;
  const { operationAnnouncementRef, readyAnnouncement } =
    useSafetyAnnouncements({
      stateKind: state.kind,
      operationKind,
      operationReason,
      t,
    });

  const operationAnnouncementSurface =
    operationState === null ? null : (
      <div
        ref={operationAnnouncementRef}
        className="visually-hidden"
        data-testid="operation-transition-announcement"
        aria-live="polite"
        aria-atomic="true"
      ></div>
    );
  const withOperationAnnouncement = (surface: ReactNode) => (
    <>
      {surface}
      {operationAnnouncementSurface}
    </>
  );

  if (state.kind === "unbound") {
    return <UnboundSafetyState />;
  }

  const establishedFailure =
    operationState?.kind === "blocked" || operationState?.kind === "fatal"
      ? operationState
      : null;
  const establishedFailureNeedsAttention =
    establishedFailure !== null &&
    (state.kind === "blocked" || canRetryFailedDeletion(establishedFailure));
  if (establishedFailureNeedsAttention) {
    const retryFailed =
      canRetryFailedDeletion(establishedFailure) && onRetryFailed !== undefined;
    return withOperationAnnouncement(
      <OperationStatusStrip
        tone="error"
        message={t(`deletion.currentState.${establishedFailure.kind}`, {
          processed: establishedFailure.progress.processed,
          total: establishedFailure.progress.total,
          reason: safetyBlockReasonLabel(establishedFailure.reason),
        })}
        action={
          retryFailed ? (
            <Button size="small" onClick={onRetryFailed}>
              {t("deletion.retryFailed")}
            </Button>
          ) : undefined
        }
      />,
    );
  }

  if (state.kind === "blocked") {
    return withOperationAnnouncement(
      <SafetyBlockAlert
        reason={state.reason}
        {...(onRetry === undefined ? {} : { onRetry })}
      />,
    );
  }

  if (operationState !== null && isDeletionRunActive(operationState)) {
    const stop = canStopDeletionRun(operationState) && onStop !== undefined;
    return withOperationAnnouncement(
      <OperationStatusStrip
        tone={operationState.kind === "paused" ? "warning" : "info"}
        message={t(`deletion.currentState.${operationState.kind}`, {
          processed: operationState.progress.processed,
          total: operationState.progress.total,
        })}
        action={
          stop ? (
            <Button danger size="small" onClick={onStop}>
              {t("deletion.stop")}
            </Button>
          ) : undefined
        }
      />,
    );
  }

  const actionableStoppedOperation =
    operationState?.kind === "stopped" &&
    canRetryFailedDeletion(operationState) &&
    onRetryFailed !== undefined
      ? operationState
      : null;
  if (actionableStoppedOperation !== null) {
    return withOperationAnnouncement(
      <OperationStatusStrip
        tone="warning"
        message={t("deletion.currentState.stopped", {
          processed: actionableStoppedOperation.progress.processed,
          total: actionableStoppedOperation.progress.total,
        })}
        action={
          <Button size="small" onClick={onRetryFailed}>
            {t("deletion.retryFailed")}
          </Button>
        }
      />,
    );
  }

  if (state.kind !== "ready" || readyAnnouncement === "") {
    return operationAnnouncementSurface;
  }
  return withOperationAnnouncement(
    <div className="visually-hidden" role="status" aria-live="polite">
      {readyAnnouncement}
    </div>,
  );
}
