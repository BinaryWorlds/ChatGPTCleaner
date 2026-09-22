import { Alert, Button, Card, Descriptions, Progress, Space, Tag } from "antd";
import type { DeletionRunState } from "../application/deletionRun";

export interface DeletionProgressPanelProps {
  readonly state: DeletionRunState;
  readonly currentConversationLabel: string;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onStop: () => void;
  readonly onRetryFailed: () => void;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`;
}

export function DeletionProgressPanel({
  state,
  currentConversationLabel,
  onPause,
  onResume,
  onStop,
  onRetryFailed,
}: DeletionProgressPanelProps) {
  const { progress } = state;
  const percent =
    progress.total === 0
      ? 100
      : Math.round((progress.processed / progress.total) * 100);
  const canStop =
    state.kind === "running" ||
    state.kind === "pausing" ||
    state.kind === "paused";
  const canRetry =
    progress.failedConversationIds.length > 0 &&
    (state.kind === "finished" ||
      state.kind === "stopped" ||
      state.kind === "fatal");

  return (
    <Card title="Current deletion run" size="small">
      {state.kind === "fatal" && (
        <Alert
          type="error"
          showIcon
          title="Deletion stopped for safety"
          description={state.reason}
        />
      )}
      {state.kind === "blocked" && (
        <Alert
          type="error"
          showIcon
          title="Deletion blocked"
          description={state.reason}
        />
      )}
      {progress.failedConversationIds.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title="Failed conversations"
          description={progress.failedConversationIds.join(", ")}
        />
      )}
      <Progress
        percent={percent}
        {...(state.kind === "fatal" ? { status: "exception" as const } : {})}
      />
      <Descriptions size="small" column={{ xs: 2, md: 4 }}>
        <Descriptions.Item label="State">
          <Tag>{state.kind.toUpperCase()}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Processed / total">
          {progress.processed} / {progress.total}
        </Descriptions.Item>
        <Descriptions.Item label="Deleted">
          {progress.deleted}
        </Descriptions.Item>
        <Descriptions.Item label="Failed">{progress.failed}</Descriptions.Item>
        <Descriptions.Item label="Skipped">
          {progress.skipped}
        </Descriptions.Item>
        <Descriptions.Item label="Remaining">
          {progress.remaining}
        </Descriptions.Item>
        <Descriptions.Item label="Retries">
          {progress.retries}
        </Descriptions.Item>
        <Descriptions.Item label="Configured rate">
          {progress.requestsPerMinute}/minute
        </Descriptions.Item>
        <Descriptions.Item label="Active elapsed">
          {formatDuration(progress.activeElapsedMs)}
        </Descriptions.Item>
        <Descriptions.Item label="ETA">
          {state.kind === "paused"
            ? "Paused"
            : progress.etaMs === null
              ? "Unknown"
              : formatDuration(progress.etaMs)}
        </Descriptions.Item>
        <Descriptions.Item label="Current conversation" span={2}>
          {currentConversationLabel}
        </Descriptions.Item>
      </Descriptions>
      <Space wrap>
        {state.kind === "running" && <Button onClick={onPause}>Pause</Button>}
        {state.kind === "paused" && (
          <Button type="primary" onClick={onResume}>
            Resume
          </Button>
        )}
        {canStop && (
          <Button danger onClick={onStop}>
            Stop
          </Button>
        )}
        {canRetry && <Button onClick={onRetryFailed}>Retry Failed</Button>}
      </Space>
    </Card>
  );
}
