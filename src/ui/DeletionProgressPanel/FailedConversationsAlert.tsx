import { Alert, Space } from "antd";
import { useTranslation } from "react-i18next";
import { failedConversationPreview } from "./deletionProgressPresentation";

interface FailedConversationsAlertProps {
  readonly failedConversationIds: readonly string[];
}

export default function FailedConversationsAlert({
  failedConversationIds,
}: FailedConversationsAlertProps) {
  const { t } = useTranslation();
  if (failedConversationIds.length === 0) return null;

  const { conversationIds, hiddenCount } = failedConversationPreview(
    failedConversationIds,
  );

  return (
    <Alert
      type="warning"
      showIcon
      title={t("deletion.failedConversations")}
      description={
        <Space orientation="vertical" size={0}>
          <span>
            {t("deletion.failedCount", {
              count: failedConversationIds.length,
            })}
          </span>
          <span>{conversationIds.join(", ")}</span>
          {hiddenCount > 0 && (
            <span>{t("deletion.moreFailed", { count: hiddenCount })}</span>
          )}
        </Space>
      }
    />
  );
}
