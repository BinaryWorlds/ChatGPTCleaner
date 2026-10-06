import { DatePicker, Radio } from "antd";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { isDateComparison } from "../helpers/dateFilterGuards";
import type { ExactDateFilterValue } from "../helpers/dateFilterDraft";
import { toDayjs, toLocalCalendarDay } from "../helpers/localDayDayjs";

interface ExactDateFilterControlsProps {
  readonly value: ExactDateFilterValue;
  readonly onChange: (value: ExactDateFilterValue) => void;
  readonly currentDate: () => Date;
}

function ExactDateFilterControls({
  value,
  onChange,
  currentDate,
}: ExactDateFilterControlsProps) {
  const { t } = useTranslation();

  return (
    <div className="date-filter-exact-controls">
      <Radio.Group
        aria-label={t("filters.exactCondition")}
        value={value.dateComparison}
        onChange={(event) => {
          const dateComparison: unknown = event.target.value;
          if (!isDateComparison(dateComparison)) return;
          onChange({ ...value, dateComparison });
        }}
      >
        <Radio value="before">{t("filters.beforeDate")}</Radio>
        <Radio value="after">{t("filters.afterDate")}</Radio>
      </Radio.Group>
      <DatePicker
        className="filter-date-picker"
        aria-label={t("filters.cutoffDate")}
        placeholder={t("filters.selectDate")}
        value={toDayjs(value.cutoffLocalDay)}
        defaultPickerValue={dayjs(currentDate())}
        getPopupContainer={(triggerNode) =>
          triggerNode.parentElement ?? triggerNode
        }
        onChange={(date) =>
          onChange({ ...value, cutoffLocalDay: toLocalCalendarDay(date) })
        }
      />
    </div>
  );
}

export default ExactDateFilterControls;
