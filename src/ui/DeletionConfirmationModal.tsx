import { Descriptions, Input, Modal, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  confirmDeletionPlan,
  type ConfirmedDeletionPlan,
  type DeletionPlan,
} from "../domain/deletionPlan";

interface DeletionConfirmationModalProps {
  readonly plan: DeletionPlan;
  readonly disabled?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (plan: ConfirmedDeletionPlan) => void;
}

export function DeletionConfirmationModal({
  plan,
  disabled = false,
  onCancel,
  onConfirm,
}: DeletionConfirmationModalProps) {
  const { t } = useTranslation();
  const [confirmationText, setConfirmationText] = useState("");
  const expectedText = `DELETE ${plan.eligibleConversationIds.length}`;
  const confirmation = confirmDeletionPlan(plan, confirmationText);

  return (
    <Modal
      title={t("confirmation.title")}
      open
      okText={t("confirmation.deleteCount", {
        count: plan.eligibleConversationIds.length,
      })}
      okButtonProps={{
        danger: true,
        disabled:
          disabled ||
          plan.eligibleConversationIds.length === 0 ||
          confirmationText !== expectedText,
      }}
      onCancel={onCancel}
      onOk={() => {
        if (confirmation.kind === "confirmed") {
          onConfirm(confirmation.plan);
        }
      }}
    >
      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label={t("confirmation.originallySelected")}>
          {plan.originallySelectedCount}
        </Descriptions.Item>
        <Descriptions.Item label={t("confirmation.stillEligible")}>
          {plan.eligibleConversationIds.length}
        </Descriptions.Item>
        <Descriptions.Item label={t("confirmation.excludedProject")}>
          {plan.excludedProjectIds.length}
        </Descriptions.Item>
        <Descriptions.Item label={t("confirmation.excludedProtected")}>
          {plan.excludedProtectedIds.length}
        </Descriptions.Item>
        <Descriptions.Item label={t("confirmation.missing")}>
          {plan.missingConversationIds.length + plan.invalidSelectionCount}
        </Descriptions.Item>
        <Descriptions.Item label={t("confirmation.finalCount")}>
          {plan.eligibleConversationIds.length}
        </Descriptions.Item>
      </Descriptions>
      <Typography.Paragraph className="confirmation-instruction">
        {t("confirmation.instruction", { token: expectedText })}
      </Typography.Paragraph>
      <Input
        aria-label={t("confirmation.ariaLabel")}
        autoComplete="off"
        disabled={disabled}
        value={confirmationText}
        onChange={(event) => setConfirmationText(event.target.value)}
      />
    </Modal>
  );
}
