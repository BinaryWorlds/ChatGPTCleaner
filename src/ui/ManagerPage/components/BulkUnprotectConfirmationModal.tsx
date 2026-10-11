import { Modal, Typography } from "antd";
import { useTranslation } from "react-i18next";

interface BulkUnprotectConfirmationModalProps {
  readonly conversationIds: ReadonlySet<string>;
  readonly confirmDisabled: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (conversationIds: ReadonlySet<string>) => void;
}

export default function BulkUnprotectConfirmationModal({
  conversationIds,
  confirmDisabled,
  onCancel,
  onConfirm,
}: BulkUnprotectConfirmationModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open
      title={t("unprotectConfirmation.title", {
        count: conversationIds.size,
      })}
      okText={t("unprotectConfirmation.confirm", {
        count: conversationIds.size,
      })}
      cancelText={t("common.cancel")}
      okButtonProps={{ disabled: confirmDisabled }}
      onCancel={onCancel}
      onOk={() => onConfirm(conversationIds)}
    >
      <Typography.Paragraph>
        {t("unprotectConfirmation.description")}
      </Typography.Paragraph>
    </Modal>
  );
}
