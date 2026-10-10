import { useTranslation } from "react-i18next";
import type { DeletionRunState } from "../../application/deletionRun";
import { useSafetyAnnouncements } from "./useSafetyAnnouncements";
import type { SafetyStatusState } from "./safetyStatusContract";
import SafetyBlockAlert from "./SafetyBlockAlert";
import UnboundSafetyState from "./UnboundSafetyState";

interface SafetyStatusProps {
  readonly state: SafetyStatusState;
  readonly operationState?: DeletionRunState | null;
  readonly onRetry?: () => void;
}

export default function SafetyStatus({
  state,
  operationState = null,
  onRetry,
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
  if (state.kind === "unbound") {
    return <UnboundSafetyState />;
  }

  if (state.kind === "blocked") {
    return (
      <>
        <SafetyBlockAlert
          reason={state.reason}
          {...(onRetry === undefined ? {} : { onRetry })}
        />
        {operationAnnouncementSurface}
      </>
    );
  }

  if (state.kind !== "ready" || readyAnnouncement === "") {
    return operationAnnouncementSurface;
  }
  return (
    <>
      <div className="visually-hidden" role="status" aria-live="polite">
        {readyAnnouncement}
      </div>
      {operationAnnouncementSurface}
    </>
  );
}
