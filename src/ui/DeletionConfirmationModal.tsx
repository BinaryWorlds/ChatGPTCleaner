import { Descriptions, Input, Modal, Typography } from "antd";
import { useState } from "react";
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
  const [confirmationText, setConfirmationText] = useState("");
  const expectedText = `DELETE ${plan.eligibleConversationIds.length}`;
  const confirmation = confirmDeletionPlan(plan, confirmationText);

  return (
    <Modal
      title="Confirm deletion"
      open
      okText={`Delete ${plan.eligibleConversationIds.length}`}
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
        <Descriptions.Item label="Originally selected">
          {plan.originallySelectedCount}
        </Descriptions.Item>
        <Descriptions.Item label="Still eligible">
          {plan.eligibleConversationIds.length}
        </Descriptions.Item>
        <Descriptions.Item label="Excluded as Project">
          {plan.excludedProjectIds.length}
        </Descriptions.Item>
        <Descriptions.Item label="Excluded as user-protected">
          {plan.excludedProtectedIds.length}
        </Descriptions.Item>
        <Descriptions.Item label="Missing/already gone">
          {plan.missingConversationIds.length + plan.invalidSelectionCount}
        </Descriptions.Item>
        <Descriptions.Item label="Final delete count">
          {plan.eligibleConversationIds.length}
        </Descriptions.Item>
      </Descriptions>
      <Typography.Paragraph className="confirmation-instruction">
        Type <Typography.Text code>{expectedText}</Typography.Text> to continue.
      </Typography.Paragraph>
      <Input
        aria-label="Deletion confirmation"
        autoComplete="off"
        disabled={disabled}
        value={confirmationText}
        onChange={(event) => setConfirmationText(event.target.value)}
      />
    </Modal>
  );
}
