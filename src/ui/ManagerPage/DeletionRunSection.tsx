import { DeleteOutlined } from "@ant-design/icons";
import { Alert, Flex, Space, Spin, Tag, theme, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { DeletionRunState } from "../../application/deletionRun";
import DeletionProgressPanel from "../DeletionProgressPanel";
import SectionHeading from "./SectionHeading";

interface DeletionRunSectionProps {
  readonly state: DeletionRunState | null;
  readonly preflightKind: "new-run" | "resume" | "retry-failed" | null;
  readonly retryingFailedRun: boolean;
  readonly resumeDisabled: boolean;
  readonly retryFailedDisabled: boolean;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onStop: () => void;
  readonly onRetryFailed: () => void;
}

export default function DeletionRunSection({
  state,
  preflightKind,
  retryingFailedRun,
  resumeDisabled,
  retryFailedDisabled,
  onPause,
  onResume,
  onStop,
  onRetryFailed,
}: DeletionRunSectionProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const status = (() => {
    if (preflightKind !== null) {
      return t(`deletion.preflightStatus.${preflightKind}`);
    }
    if (state === null) return "";
    if (state.progress.total === 0) return t("deletion.nothingEligible");
    if (state.kind === "finished" && state.progress.failed > 0) {
      return t("deletion.completedWithFailures");
    }
    if (state.kind === "finished") return t("deletion.completed");
    if (retryingFailedRun && state.kind === "running") {
      return t("deletion.retryingFailed");
    }
    return t(`deletion.states.${state.kind}`);
  })();
  const statusColor = (() => {
    if (preflightKind !== null) return "processing";
    if (state?.progress.total === 0) return "default";
    if (state?.kind === "finished" && state.progress.failed === 0) {
      return "success";
    }
    if (state?.kind === "finished" && state.progress.failed > 0) {
      return "warning";
    }
    if (state?.kind === "fatal" || state?.kind === "blocked") return "error";
    if (state?.kind === "paused" || state?.kind === "stopped") return "warning";
    return "processing";
  })();

  return (
    <section
      className="deletion-operation"
      aria-labelledby="deletion-operation-heading"
    >
      <Space
        orientation="vertical"
        size={token.marginSM}
        className="full-width"
      >
        <SectionHeading
          id="deletion-operation-heading"
          icon={
            <DeleteOutlined aria-hidden style={{ color: token.colorPrimary }} />
          }
        >
          <Flex align="center" gap="small" wrap>
            <span>{t("deletion.operationTitle")}</span>
            <Tag color={statusColor} style={{ color: token.colorText }}>
              {status}
            </Tag>
          </Flex>
        </SectionHeading>
        {state === null ? (
          <Flex align="center" gap="small" role="status">
            <Spin size="small" />
            <Typography.Text>
              {t("deletion.preflightFeedback.new-run")}
            </Typography.Text>
          </Flex>
        ) : state.progress.total === 0 ? (
          <Alert
            type="info"
            showIcon
            title={t("deletion.noEligibleConfirmed")}
          />
        ) : (
          <DeletionProgressPanel
            state={state}
            onPause={onPause}
            onResume={onResume}
            resumeDisabled={resumeDisabled}
            retryFailedDisabled={retryFailedDisabled}
            actionPending={preflightKind !== null}
            onStop={onStop}
            onRetryFailed={onRetryFailed}
          />
        )}
      </Space>
    </section>
  );
}
