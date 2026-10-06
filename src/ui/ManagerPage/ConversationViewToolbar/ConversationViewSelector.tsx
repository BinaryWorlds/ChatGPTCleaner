import { Flex, Segmented, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { ConversationView } from "../ConversationTable/conversationTableContract";

interface ConversationViewSelectorProps {
  readonly value: ConversationView;
  readonly onChange: (view: ConversationView) => void;
}

export default function ConversationViewSelector({
  value,
  onChange,
}: ConversationViewSelectorProps) {
  const { t } = useTranslation();

  return (
    <Flex className="view-control-group" align="center" wrap gap="small">
      <Typography.Text>{t("view.label")}</Typography.Text>
      <Segmented
        className="view-segmented"
        aria-label={t("view.ariaLabel")}
        value={value}
        options={[
          { label: t("view.standalone"), value: "standalone" },
          { label: t("view.projects"), value: "projects" },
        ]}
        onChange={(nextValue) => {
          if (nextValue === "standalone" || nextValue === "projects") {
            onChange(nextValue);
          }
        }}
      />
    </Flex>
  );
}
