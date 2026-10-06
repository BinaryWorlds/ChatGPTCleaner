import { DeleteOutlined } from "@ant-design/icons";
import { Space, theme } from "antd";
import { useTranslation } from "react-i18next";
import type { DeletionRunState } from "../../application/deletionRun";
import DeletionProgressPanel from "../DeletionProgressPanel";
import SectionHeading from "./SectionHeading";

interface DeletionRunSectionProps {
  readonly state: DeletionRunState;
  readonly currentConversationLabel: string;
  readonly resumeDisabled: boolean;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onStop: () => void;
  readonly onRetryFailed: () => void;
}

export default function DeletionRunSection({
  state,
  currentConversationLabel,
  resumeDisabled,
  onPause,
  onResume,
  onStop,
  onRetryFailed,
}: DeletionRunSectionProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

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
          {t("deletion.operationTitle")}
        </SectionHeading>
        <DeletionProgressPanel
          state={state}
          currentConversationLabel={currentConversationLabel}
          onPause={onPause}
          onResume={onResume}
          resumeDisabled={resumeDisabled}
          onStop={onStop}
          onRetryFailed={onRetryFailed}
        />
      </Space>
    </section>
  );
}
