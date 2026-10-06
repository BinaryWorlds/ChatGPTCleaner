import {
  DeleteOutlined,
  LockOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { Button, Flex } from "antd";
import { useTranslation } from "react-i18next";

interface ConversationBulkActionsProps {
  readonly protectableCount: number;
  readonly unprotectableCount: number;
  readonly protectDisabled: boolean;
  readonly unprotectDisabled: boolean;
  readonly deleteDisabled: boolean;
  readonly onProtect: () => void;
  readonly onUnprotect: () => void;
  readonly onDelete: () => void;
}

export default function ConversationBulkActions({
  protectableCount,
  unprotectableCount,
  protectDisabled,
  unprotectDisabled,
  deleteDisabled,
  onProtect,
  onUnprotect,
  onDelete,
}: ConversationBulkActionsProps) {
  const { t } = useTranslation();

  return (
    <Flex className="selection-primary-actions" wrap gap="small">
      <Button
        icon={<LockOutlined aria-hidden />}
        disabled={protectDisabled}
        onClick={onProtect}
      >
        {t("selection.protectSelected", { count: protectableCount })}
      </Button>
      <Button
        icon={<UnlockOutlined aria-hidden />}
        disabled={unprotectDisabled}
        onClick={onUnprotect}
      >
        {t("selection.unprotectSelected", { count: unprotectableCount })}
      </Button>
      <Button
        danger
        type="primary"
        icon={<DeleteOutlined aria-hidden />}
        disabled={deleteDisabled}
        onClick={onDelete}
      >
        {t("selection.deleteSelected", { count: protectableCount })}
      </Button>
    </Flex>
  );
}
