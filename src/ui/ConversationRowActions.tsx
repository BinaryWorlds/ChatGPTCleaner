import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import { Button, Space, theme, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

export type CopyConversationIdFeedback = "copied" | "failed" | null;

type ConversationProtectionAction =
  | {
      readonly kind: "protect";
      readonly disabled: boolean;
      readonly onInvoke: (conversationId: string) => void;
    }
  | {
      readonly kind: "unprotect";
      readonly disabled: boolean;
      readonly onInvoke: (conversationId: string) => void;
    };

interface ConversationRowActionsProps {
  readonly conversationId: string;
  readonly copyFeedback: CopyConversationIdFeedback;
  readonly protectionAction: ConversationProtectionAction | null;
  readonly onCopy: (conversationId: string) => void;
  readonly onOpen: (conversationId: string) => void;
}

export function ConversationRowActions({
  conversationId,
  copyFeedback,
  protectionAction,
  onCopy,
  onOpen,
}: ConversationRowActionsProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const copyLabel = t("table.copyId", { id: conversationId });
  const copyFeedbackLabel =
    copyFeedback === "copied"
      ? t("table.copySuccess")
      : copyFeedback === "failed"
        ? t("table.copyFailure")
        : copyLabel;

  return (
    <Space size="small">
      <Tooltip title={copyFeedbackLabel}>
        <Button
          type="text"
          aria-label={copyFeedbackLabel}
          icon={
            copyFeedback === "copied" ? (
              <CheckOutlined
                aria-hidden
                style={{ color: token.colorSuccess }}
              />
            ) : (
              <CopyOutlined aria-hidden />
            )
          }
          size="small"
          onClick={() => onCopy(conversationId)}
        />
      </Tooltip>
      <Button type="text" size="small" onClick={() => onOpen(conversationId)}>
        {t("table.open")}
      </Button>
      {protectionAction !== null && (
        <Button
          type="text"
          size="small"
          disabled={protectionAction.disabled}
          onClick={() => protectionAction.onInvoke(conversationId)}
        >
          {protectionAction.kind === "unprotect"
            ? t("table.unprotect")
            : t("table.protect")}
        </Button>
      )}
    </Space>
  );
}
