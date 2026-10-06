import { Radio, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { ConversationDateField } from "../../../../../domain/conversation";
import { isConversationDateField } from "../helpers/dateFilterGuards";

interface DateFilterFieldSelectorProps {
  readonly labelId: string;
  readonly value: ConversationDateField;
  readonly onChange: (dateField: ConversationDateField) => void;
}

function DateFilterFieldSelector({
  labelId,
  value,
  onChange,
}: DateFilterFieldSelectorProps) {
  const { t } = useTranslation();

  return (
    <div>
      <Typography.Text id={labelId} strong>
        {t("filters.appliesTo")}
      </Typography.Text>
      <Radio.Group
        aria-labelledby={labelId}
        className="date-filter-radio-group"
        value={value}
        onChange={(event) => {
          const dateField: unknown = event.target.value;
          if (!isConversationDateField(dateField)) return;
          onChange(dateField);
        }}
      >
        <Radio value="updatedAt">{t("filters.lastUpdate")}</Radio>
        <Radio value="createdAt">{t("filters.creationDate")}</Radio>
      </Radio.Group>
    </div>
  );
}

export default DateFilterFieldSelector;
