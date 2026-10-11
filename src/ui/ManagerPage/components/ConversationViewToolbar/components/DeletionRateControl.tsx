import { InfoCircleOutlined } from "@ant-design/icons";
import { Flex, InputNumber, Space, theme, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { AppConfig } from "config";

interface DeletionRateControlProps {
  readonly requestsPerMinute: number;
  readonly maximumConcurrentDeleteRequests: number;
  readonly disabled: boolean;
  readonly onRateChange: (value: number | null) => void;
  readonly onConcurrencyChange: (value: number | null) => void;
}

export default function DeletionRateControl({
  requestsPerMinute,
  maximumConcurrentDeleteRequests,
  disabled,
  onRateChange,
  onConcurrencyChange,
}: DeletionRateControlProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  return (
    <Flex className="delete-rate-group" align="center" gap="middle" wrap>
      <Flex align="center" gap="small">
        <Space size={token.marginXXS}>
          <Typography.Text>{t("scheduling.rateLabel")}</Typography.Text>
          <Tooltip
            title={t("scheduling.rateTooltip")}
            trigger={["hover", "focus"]}
          >
            <span
              aria-label={t("scheduling.rateHelp")}
              tabIndex={0}
              style={{
                color: token.colorTextTertiary,
                display: "inline-flex",
                fontSize: token.fontSizeSM,
              }}
            >
              <InfoCircleOutlined aria-hidden />
            </span>
          </Tooltip>
        </Space>
        <InputNumber
          key={`${disabled ? "owned" : "editable"}-${requestsPerMinute}`}
          aria-label={t("scheduling.rateLabel")}
          min={AppConfig.deletion.requestsPerMinute.min}
          max={AppConfig.deletion.requestsPerMinute.max}
          precision={0}
          style={{ width: 96 }}
          value={requestsPerMinute}
          disabled={disabled}
          onChange={onRateChange}
        />
        <Typography.Text type="secondary">
          {t("scheduling.rateUnit")}
        </Typography.Text>
      </Flex>
      <Flex align="center" gap="small">
        <Space size={token.marginXXS}>
          <Typography.Text>{t("scheduling.concurrencyLabel")}</Typography.Text>
          <Tooltip
            title={t("scheduling.concurrencyTooltip")}
            trigger={["hover", "focus"]}
          >
            <span
              aria-label={t("scheduling.concurrencyHelp")}
              tabIndex={0}
              style={{
                color: token.colorTextTertiary,
                display: "inline-flex",
                fontSize: token.fontSizeSM,
              }}
            >
              <InfoCircleOutlined aria-hidden />
            </span>
          </Tooltip>
        </Space>
        <InputNumber
          key={`${disabled ? "owned" : "editable"}-${maximumConcurrentDeleteRequests}`}
          aria-label={t("scheduling.concurrencyLabel")}
          min={AppConfig.deletion.maximumConcurrentDeleteRequests.min}
          max={AppConfig.deletion.maximumConcurrentDeleteRequests.max}
          precision={0}
          style={{ width: 72 }}
          value={maximumConcurrentDeleteRequests}
          disabled={disabled}
          onChange={onConcurrencyChange}
        />
      </Flex>
    </Flex>
  );
}
