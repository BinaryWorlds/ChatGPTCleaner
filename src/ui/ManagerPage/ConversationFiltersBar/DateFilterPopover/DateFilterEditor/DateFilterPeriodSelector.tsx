import { Radio, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { isDatePeriod, type DatePeriod } from "../../helpers/dateFilterPeriods";

interface DateFilterPeriodSelectorProps {
  readonly labelId: string;
  readonly value: DatePeriod | null;
  readonly onChange: (period: DatePeriod) => void;
}

function DateFilterPeriodSelector({
  labelId,
  value,
  onChange,
}: DateFilterPeriodSelectorProps) {
  const { t } = useTranslation();

  return (
    <div>
      <Typography.Text id={labelId} strong>
        {t("filters.periodCondition")}
      </Typography.Text>
      <Radio.Group
        aria-labelledby={labelId}
        className="date-filter-radio-group"
        value={value}
        onChange={(event) => {
          const period: unknown = event.target.value;
          if (!isDatePeriod(period)) return;
          onChange(period);
        }}
      >
        <Radio value="older-than-7-days">
          {t("filters.older-than-7-days")}
        </Radio>
        <Radio value="older-than-30-days">
          {t("filters.older-than-30-days")}
        </Radio>
        <Radio value="older-than-90-days">
          {t("filters.older-than-90-days")}
        </Radio>
        <Radio value="older-than-6-months">
          {t("filters.older-than-6-months")}
        </Radio>
        <Radio value="older-than-1-year">
          {t("filters.older-than-1-year")}
        </Radio>
        <Radio value="exact">{t("filters.exactDate")}</Radio>
      </Radio.Group>
    </div>
  );
}

export default DateFilterPeriodSelector;
