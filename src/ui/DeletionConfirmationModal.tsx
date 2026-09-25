import { Descriptions, Input, Modal, Typography } from "antd";
import type { DeletionPlan } from "../domain/deletionPlan";

interface DeletionConfirmationModalProps {
  readonly plan: DeletionPlan | null;
  readonly confirmationText: string;
  readonly onConfirmationTextChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function DeletionConfirmationModal({
  plan,
  confirmationText,
  onConfirmationTextChange,
  onCancel,
  onConfirm,
}: DeletionConfirmationModalProps) {
  if (plan === null) return null;
  const expectedText = `DELETE ${plan.eligibleConversationIds.length}`;

  return (
    <Modal
      title="Confirm deletion"
      open
      okText={`Delete ${plan.eligibleConversationIds.length}`}
      okButtonProps={{
        danger: true,
        disabled:
          plan.eligibleConversationIds.length === 0 ||
          confirmationText !== expectedText,
      }}
      onCancel={onCancel}
      onOk={onConfirm}
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
        value={confirmationText}
        onChange={(event) => onConfirmationTextChange(event.target.value)}
      />
    </Modal>
  );
}
