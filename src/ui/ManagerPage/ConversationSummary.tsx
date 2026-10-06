import {
  CheckSquareOutlined,
  FolderOpenOutlined,
  MessageOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Col, Row, Space, Statistic, theme } from "antd";
import { useTranslation } from "react-i18next";

interface ConversationSummaryProps {
  readonly standaloneCount: number;
  readonly projectCount: number;
  readonly protectedCount: number;
  readonly selectedCount: number;
}

export default function ConversationSummary({
  standaloneCount,
  projectCount,
  protectedCount,
  selectedCount,
}: ConversationSummaryProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  return (
    <Row className="summary-metrics" gutter={[token.marginLG, token.marginSM]}>
      <Col className="summary-metric" xs={12} md={6}>
        <Statistic
          data-testid="standalone-summary"
          title={
            <Space size={token.marginXS}>
              <MessageOutlined aria-hidden />
              <span>{t("summary.standalone")}</span>
            </Space>
          }
          value={standaloneCount}
        />
      </Col>
      <Col className="summary-metric" xs={12} md={6}>
        <Statistic
          data-testid="project-summary"
          title={
            <Space size={token.marginXS}>
              <FolderOpenOutlined aria-hidden />
              <span>{t("summary.projectProtected")}</span>
            </Space>
          }
          value={projectCount}
        />
      </Col>
      <Col className="summary-metric" xs={12} md={6}>
        <Statistic
          data-testid="protected-summary"
          title={
            <Space size={token.marginXS}>
              <SafetyCertificateOutlined aria-hidden />
              <span>{t("summary.userProtected")}</span>
            </Space>
          }
          value={protectedCount}
        />
      </Col>
      <Col
        className={`summary-metric${selectedCount > 0 ? " summary-metric-selected" : ""}`}
        xs={12}
        md={6}
      >
        <Statistic
          data-testid="selected-count"
          title={
            <Space size={token.marginXS}>
              <CheckSquareOutlined aria-hidden />
              <span>{t("summary.selected")}</span>
            </Space>
          }
          value={selectedCount}
        />
      </Col>
    </Row>
  );
}
