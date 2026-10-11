import { Card, Empty, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";

export default function UnboundSafetyState() {
  const { t } = useTranslation();

  return (
    <Card size="small" aria-live="polite">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Space orientation="vertical" size="small">
            <Typography.Title level={4} style={{ margin: 0 }}>
              {t("safety.unbound.title")}
            </Typography.Title>
            <Typography.Text type="secondary">
              {t("safety.unbound.description")}
            </Typography.Text>
          </Space>
        }
      />
    </Card>
  );
}
