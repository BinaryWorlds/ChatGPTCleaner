import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import { Button, theme, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import type { CopyConversationIdFeedback } from "ui/ManagerPage/components/ConversationTable/copyConversationIdFeedback";

interface CopyConversationIdButtonProps {
  readonly conversationId: string;
  readonly feedback: CopyConversationIdFeedback;
  readonly onCopy: (conversationId: string) => void;
}

export default function CopyConversationIdButton({
  conversationId,
  feedback,
  onCopy,
}: CopyConversationIdButtonProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const copyLabel = t("table.copyId", { id: conversationId });
  const feedbackLabel =
    feedback === "copied"
      ? t("table.copySuccess")
      : feedback === "failed"
        ? t("table.copyFailure")
        : copyLabel;

  return (
    <Tooltip title={feedbackLabel}>
      <Button
        type="text"
        aria-label={feedbackLabel}
        icon={
          feedback === "copied" ? (
            <CheckOutlined aria-hidden style={{ color: token.colorSuccess }} />
          ) : (
            <CopyOutlined aria-hidden />
          )
        }
        size="small"
        onClick={() => onCopy(conversationId)}
      />
    </Tooltip>
  );
}
