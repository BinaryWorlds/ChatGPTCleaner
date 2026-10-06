import { Descriptions, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { DeletionRunState } from "../../application/deletionRun";
import { formatDeletionDuration } from "./deletionProgressPresentation";

interface DeletionProgressDetailsProps {
  readonly state: DeletionRunState;
  readonly currentConversationLabel: string;
}

export default function DeletionProgressDetails({
  state,
  currentConversationLabel,
}: DeletionProgressDetailsProps) {
  const { t } = useTranslation();
  const { progress } = state;

  return (
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
        {formatDeletionDuration(progress.activeElapsedMs, t)}
      </Descriptions.Item>
      <Descriptions.Item label={t("deletion.eta")}>
        {state.kind === "paused"
          ? t("deletion.states.paused")
          : progress.etaMs === null
            ? t("deletion.unknown")
            : formatDeletionDuration(progress.etaMs, t)}
      </Descriptions.Item>
      <Descriptions.Item label={t("deletion.currentConversation")} span={2}>
        {currentConversationLabel}
      </Descriptions.Item>
    </Descriptions>
  );
}
