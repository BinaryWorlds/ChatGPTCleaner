import { Alert, Progress, Typography } from "antd";
import type { DeletionRunState } from "../../application/deletionRun";
import { useTranslation } from "react-i18next";
import { safetyBlockReasonLabel } from "../SafetyStatus/safetyStatusPresentation";
import DeletionProgressDetails from "./DeletionProgressDetails";
import DeletionRunControls from "./DeletionRunControls";
import FailedConversationsAlert from "./FailedConversationsAlert";
import { deletionProgressPercent } from "./deletionProgressPresentation";

interface DeletionProgressPanelProps {
  readonly state: DeletionRunState;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly resumeDisabled: boolean;
  readonly retryFailedDisabled?: boolean;
  readonly actionPending?: boolean;
  readonly onStop: () => void;
  readonly onRetryFailed: () => void;
}

export default function DeletionProgressPanel({
  state,
  onPause,
  onResume,
  resumeDisabled,
  retryFailedDisabled = false,
  actionPending = false,
  onStop,
  onRetryFailed,
}: DeletionProgressPanelProps) {
  const { t } = useTranslation();
  const activeSlowNotice = ["running", "pausing", "stopping"].includes(
    state.kind,
  );
  const failurePresentation =
    state.kind === "fatal" || state.progress.failed > 0;

  return (
    <div className="deletion-progress-panel">
      <Typography.Text strong className="deletion-completed-summary">
        {t("deletion.completedCount", {
          processed: state.progress.processed,
          total: state.progress.total,
        })}
      </Typography.Text>
      <Progress
        percent={deletionProgressPercent(state.progress)}
        {...(failurePresentation ? { status: "exception" as const } : {})}
      />
      <DeletionProgressDetails state={state} />
      <FailedConversationsAlert
        failedConversationIds={state.progress.failedConversationIds}
      />
      {state.progress.slowDeleteResponseDetected && (
        <Alert
          className="deletion-slow-notice"
          type="info"
          showIcon
          title={t(
            activeSlowNotice
              ? "deletion.slowResponseNotice"
              : "deletion.slowResponseNoticePast",
          )}
        />
      )}
      {(state.kind === "blocked" || state.kind === "fatal") && (
        <Alert
          type="error"
          showIcon
          title={t("deletion.reason", {
            reason: safetyBlockReasonLabel(state.reason),
          })}
        />
      )}
      <DeletionRunControls
        state={state}
        resumeDisabled={resumeDisabled}
        retryFailedDisabled={retryFailedDisabled}
        actionPending={actionPending}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
        onRetryFailed={onRetryFailed}
      />
    </div>
  );
}
