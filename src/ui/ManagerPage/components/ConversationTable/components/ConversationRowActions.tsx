import { Button, Space } from "antd";
import { useTranslation } from "react-i18next";
import type { CopyConversationIdFeedback } from "ui/ManagerPage/components/ConversationTable/copyConversationIdFeedback";
import CopyConversationIdButton from "./CopyConversationIdButton";

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

export default function ConversationRowActions({
  conversationId,
  copyFeedback,
  protectionAction,
  onCopy,
  onOpen,
}: ConversationRowActionsProps) {
  const { t } = useTranslation();

  return (
    <Space size="small">
      <CopyConversationIdButton
        conversationId={conversationId}
        feedback={copyFeedback}
        onCopy={onCopy}
      />
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
