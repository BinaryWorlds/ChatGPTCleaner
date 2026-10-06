import { Button, Space } from "antd";
import { useTranslation } from "react-i18next";
import {
  canRetryFailedDeletion,
  canStopDeletionRun,
  type DeletionRunState,
} from "../../application/deletionRun";

interface DeletionRunControlsProps {
  readonly state: DeletionRunState;
  readonly resumeDisabled: boolean;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onStop: () => void;
  readonly onRetryFailed: () => void;
}

export default function DeletionRunControls({
  state,
  resumeDisabled,
  onPause,
  onResume,
  onStop,
  onRetryFailed,
}: DeletionRunControlsProps) {
  const { t } = useTranslation();
  const canStop = canStopDeletionRun(state);
  const canRetry = canRetryFailedDeletion(state);

  return (
    <Space wrap>
      {state.kind === "running" && (
        <Button onClick={onPause}>{t("deletion.pause")}</Button>
      )}
      {state.kind === "paused" && (
        <Button type="primary" disabled={resumeDisabled} onClick={onResume}>
          {t("deletion.resume")}
        </Button>
      )}
      {canStop && (
        <Button danger onClick={onStop}>
          {t("deletion.stop")}
        </Button>
      )}
      {canRetry && (
        <Button onClick={onRetryFailed}>{t("deletion.retryFailed")}</Button>
      )}
    </Space>
  );
}
