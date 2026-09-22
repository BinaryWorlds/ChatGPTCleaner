import { Card, Descriptions, Tag, Typography } from "antd";

export interface SafetyStatusProps {
  readonly status: "loading" | "ready" | "blocked";
  readonly blockedReason: string | undefined;
}

const blockedReasonLabels: Readonly<Record<string, string>> = {
  authentication: "Authentication unavailable",
  compatibility: "Read API compatibility failed",
  network: "Network unavailable",
  request: "ChatGPT rejected an inventory request",
  "retry-later": "Retry later",
  "contract-unverified":
    "Current ChatGPT read contract has not been verified. Capture the requested DevTools Network evidence before enabling inventory reads.",
  "source-unavailable":
    "Source tab unavailable. Return to a valid ChatGPT tab and relaunch ChatGPTCleaner.",
  pagination: "Inventory pagination incomplete",
  "context-changed": "Session/workspace changed",
  "protected-storage": "Protected-ID storage invalid",
  "destructive-run-lock": "Another destructive run is active",
};

export function SafetyStatus({ status, blockedReason }: SafetyStatusProps) {
  const ready = status === "ready";
  const loading = status === "loading";
  const statusText = loading ? "CHECKING" : ready ? "OK" : "BLOCKED";
  const statusColor = loading ? "processing" : ready ? "success" : "error";

  return (
    <Card title="Safety status" size="small">
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
        <Descriptions.Item label="ChatGPT connection">
          <Tag color={statusColor}>{statusText}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Session/workspace">
          <Tag color={statusColor}>{statusText}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Read API compatibility">
          <Tag color={statusColor}>{statusText}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Project protection">
          <Tag color={statusColor}>{statusText}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Run lock">
          <Tag color={ready ? "success" : statusColor}>
            {ready ? "AVAILABLE" : statusText}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Deletion safety">
          <Tag color={statusColor}>{ready ? "READY" : statusText}</Tag>
        </Descriptions.Item>
      </Descriptions>
      {status === "blocked" && (
        <Typography.Text type="danger" role="alert">
          {blockedReasonLabels[blockedReason ?? ""] ??
            blockedReason ??
            "Safety checks failed."}
        </Typography.Text>
      )}
    </Card>
  );
}
