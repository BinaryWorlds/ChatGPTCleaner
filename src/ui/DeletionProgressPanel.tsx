import { Alert, Button, Descriptions, Progress, Space, Tag } from "antd";
import {
  canRetryFailedDeletion,
  type DeletionRunState,
} from "../application/deletionRun";
import { useTranslation } from "react-i18next";
import { safetyBlockReasonLabel } from "./SafetyStatus";

const FAILED_CONVERSATION_PREVIEW_LIMIT = 20;

interface DeletionProgressPanelProps {
  readonly state: DeletionRunState;
  readonly currentConversationLabel: string;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly resumeDisabled: boolean;
  readonly onStop: () => void;
  readonly onRetryFailed: () => void;
}

export function DeletionProgressPanel({
  state,
  currentConversationLabel,
  onPause,
  onResume,
  resumeDisabled,
  onStop,
  onRetryFailed,
}: DeletionProgressPanelProps) {
  const { t } = useTranslation();
  const formatDuration = (milliseconds: number): string => {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes > 0
      ? t("deletion.durationMinutesSeconds", {
          minutes,
          seconds: remainingSeconds,
        })
      : t("deletion.durationSeconds", { seconds });
  };
  const { progress } = state;
  const percent =
    progress.total === 0
      ? 100
      : Math.round((progress.processed / progress.total) * 100);
  const canStop =
    state.kind === "running" ||
    state.kind === "pausing" ||
    state.kind === "paused";
  const canRetry = canRetryFailedDeletion(state);
  const failedConversationPreview = progress.failedConversationIds.slice(
    0,
    FAILED_CONVERSATION_PREVIEW_LIMIT,
  );
  const hiddenFailedConversationCount =
    progress.failedConversationIds.length - failedConversationPreview.length;

  return (
    <div className="deletion-progress-panel">
      <div className="deletion-progress-title">{t("deletion.panelTitle")}</div>
      {state.kind === "fatal" && (
        <Alert
          type="error"
          showIcon
          title={t("deletion.stoppedForSafety")}
          description={t("deletion.reason", {
            reason: safetyBlockReasonLabel(state.reason),
          })}
        />
      )}
      {state.kind === "blocked" && (
        <Alert
          type="error"
          showIcon
          title={t("deletion.blocked")}
          description={t("deletion.reason", {
            reason: safetyBlockReasonLabel(state.reason),
          })}
        />
      )}
      {progress.failedConversationIds.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={t("deletion.failedConversations")}
          description={
            <Space orientation="vertical" size={0}>
              <span>
                {t("deletion.failedCount", {
                  count: progress.failedConversationIds.length,
                })}
              </span>
              <span>{failedConversationPreview.join(", ")}</span>
              {hiddenFailedConversationCount > 0 && (
                <span>
                  {t("deletion.moreFailed", {
                    count: hiddenFailedConversationCount,
                  })}
                </span>
              )}
            </Space>
          }
        />
      )}
      <Progress
        percent={percent}
        {...(state.kind === "fatal" ? { status: "exception" as const } : {})}
      />
      <Descriptions size="small" column={{ xs: 2, md: 4 }}>
        <Descriptions.Item label={t("deletion.state")}>
          <Tag>{t(`deletion.states.${state.kind}`)}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t("deletion.processedTotal")}>
          {progress.processed} / {progress.total}
        </Descriptions.Item>
        <Descriptions.Item label={t("deletion.deleted")}>
          {progress.deleted}
        </Descriptions.Item>
        <Descriptions.Item label={t("deletion.failed")}>
          {progress.failed}
        </Descriptions.Item>
        <Descriptions.Item label={t("deletion.skipped")}>
          {progress.skipped}
        </Descriptions.Item>
        <Descriptions.Item label={t("deletion.remaining")}>
          {progress.remaining}
        </Descriptions.Item>
        <Descriptions.Item label={t("deletion.retries")}>
          {progress.retries}
        </Descriptions.Item>
        <Descriptions.Item label={t("deletion.configuredRate")}>
          {t("deletion.perMinute", { count: progress.requestsPerMinute })}
        </Descriptions.Item>
        <Descriptions.Item label={t("deletion.activeElapsed")}>
          {formatDuration(progress.activeElapsedMs)}
        </Descriptions.Item>
        <Descriptions.Item label={t("deletion.eta")}>
          {state.kind === "paused"
            ? t("deletion.states.paused")
            : progress.etaMs === null
              ? t("deletion.unknown")
              : formatDuration(progress.etaMs)}
        </Descriptions.Item>
        <Descriptions.Item label={t("deletion.currentConversation")} span={2}>
          {currentConversationLabel}
        </Descriptions.Item>
      </Descriptions>
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
    </div>
  );
}
