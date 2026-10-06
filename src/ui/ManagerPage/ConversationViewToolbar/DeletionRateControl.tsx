import { InfoCircleOutlined } from "@ant-design/icons";
import { Flex, InputNumber, Space, theme, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { AppConfig } from "../../../config";

interface DeletionRateControlProps {
  readonly requestsPerMinute: number;
  readonly disabled: boolean;
  readonly onChange: (value: number | null) => void;
}

export default function DeletionRateControl({
  requestsPerMinute,
  disabled,
  onChange,
}: DeletionRateControlProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  return (
    <Flex className="delete-rate-group" align="center" gap="small">
      <Space size={token.marginXXS}>
        <Typography.Text>{t("rate.label")}</Typography.Text>
        <Tooltip title={t("rate.tooltip")} trigger={["hover", "focus"]}>
          <span
            aria-label={t("rate.ariaHelp")}
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
        aria-label={t("rate.label")}
        min={AppConfig.deletion.requestsPerMinute.min}
        max={AppConfig.deletion.requestsPerMinute.max}
        precision={0}
        style={{ width: 128 }}
        suffix={t("rate.unit")}
        value={requestsPerMinute}
        disabled={disabled}
        onChange={onChange}
      />
    </Flex>
  );
}
