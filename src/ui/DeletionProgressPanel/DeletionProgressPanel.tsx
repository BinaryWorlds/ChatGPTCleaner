import { Progress } from "antd";
import type { DeletionRunState } from "../../application/deletionRun";
import { useTranslation } from "react-i18next";
import DeletionProgressDetails from "./DeletionProgressDetails";
import DeletionRunControls from "./DeletionRunControls";
import FailedConversationsAlert from "./FailedConversationsAlert";
import { deletionProgressPercent } from "./deletionProgressPresentation";

interface DeletionProgressPanelProps {
  readonly state: DeletionRunState;
  readonly currentConversationLabel: string;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly resumeDisabled: boolean;
  readonly onStop: () => void;
  readonly onRetryFailed: () => void;
}

export default function DeletionProgressPanel({
  state,
  currentConversationLabel,
  onPause,
  onResume,
  resumeDisabled,
  onStop,
  onRetryFailed,
}: DeletionProgressPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="deletion-progress-panel">
      <div className="deletion-progress-title">{t("deletion.panelTitle")}</div>
      <FailedConversationsAlert
        failedConversationIds={state.progress.failedConversationIds}
      />
      <Progress
        percent={deletionProgressPercent(state.progress)}
        {...(state.kind === "fatal" ? { status: "exception" as const } : {})}
      />
      <DeletionProgressDetails
        state={state}
        currentConversationLabel={currentConversationLabel}
      />
      <DeletionRunControls
        state={state}
        resumeDisabled={resumeDisabled}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
        onRetryFailed={onRetryFailed}
      />
    </div>
  );
}
