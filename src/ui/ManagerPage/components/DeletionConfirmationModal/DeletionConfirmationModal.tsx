import { Modal, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  confirmDeletionPlan,
  type ConfirmedDeletionPlan,
  type DeletionPlan,
} from "domain/deletionPlan";

interface DeletionConfirmationModalProps {
  readonly plan: DeletionPlan;
  readonly disabled?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (plan: ConfirmedDeletionPlan) => void;
}

export default function DeletionConfirmationModal({
  plan,
  disabled = false,
  onCancel,
  onConfirm,
}: DeletionConfirmationModalProps) {
  const { t } = useTranslation();
  const eligibleCount = plan.eligibleConversationIds.length;
  const confirmation = confirmDeletionPlan(plan);
  const excludedProtectedCount = plan.excludedProtectedIds.length;

  return (
    <Modal
      title={t("confirmation.title", { count: eligibleCount })}
      open
      okText={t("confirmation.deleteCount", {
        count: eligibleCount,
      })}
      cancelText={t("common.cancel")}
      okButtonProps={{
        danger: true,
        disabled: disabled || eligibleCount === 0,
      }}
      onCancel={onCancel}
      onOk={() => {
        if (confirmation.kind === "confirmed") {
          onConfirm(confirmation.plan);
        }
      }}
    >
      <Typography.Paragraph>
        {excludedProtectedCount > 0
          ? t("confirmation.protectedSkipped", {
              selectedCount: plan.originallySelectedCount,
              count: excludedProtectedCount,
            })
          : t("confirmation.irreversible")}
      </Typography.Paragraph>
    </Modal>
  );
}
