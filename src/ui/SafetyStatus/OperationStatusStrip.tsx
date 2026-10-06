import {
  CloseCircleOutlined,
  InfoCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

type OperationStripTone = "error" | "info" | "warning";

interface OperationStatusStripProps {
  readonly tone: OperationStripTone;
  readonly message: ReactNode;
  readonly action?: ReactNode;
}

export default function OperationStatusStrip({
  tone,
  message,
  action,
}: OperationStatusStripProps) {
  const icon =
    tone === "error" ? (
      <CloseCircleOutlined aria-hidden />
    ) : tone === "warning" ? (
      <WarningOutlined aria-hidden />
    ) : (
      <InfoCircleOutlined aria-hidden />
    );

  return (
    <div
      className={`current-state-strip current-operation-strip current-operation-strip-${tone}`}
      data-testid="current-state-strip"
    >
      <span className="current-operation-strip-icon">{icon}</span>
      <div className="current-operation-strip-message">{message}</div>
      {action !== undefined && (
        <div className="current-operation-strip-action">{action}</div>
      )}
    </div>
  );
}
