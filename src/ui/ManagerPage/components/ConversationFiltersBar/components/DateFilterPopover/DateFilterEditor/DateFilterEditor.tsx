import { Button, Flex, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { ConversationDateField } from "domain/conversation";
import type {
  DateFilterDraft,
  ExactDateFilterValue,
} from "ui/ManagerPage/components/ConversationFiltersBar/components/DateFilterPopover/helpers";
import type { DatePeriod } from "ui/ManagerPage/components/ConversationFiltersBar/helpers";
import DateFilterFieldSelector from "./components/DateFilterFieldSelector";
import DateFilterPeriodSelector from "./components/DateFilterPeriodSelector";
import ExactDateFilterControls from "./components/ExactDateFilterControls";

interface DateFilterEditorProps {
  readonly panelId: string;
  readonly appliesToId: string;
  readonly periodId: string;
  readonly draft: DateFilterDraft;
  readonly canApply: boolean;
  readonly currentDate: () => Date;
  readonly onDateFieldChange: (dateField: ConversationDateField) => void;
  readonly onPeriodChange: (period: DatePeriod) => void;
  readonly onExactDateFilterChange: (value: ExactDateFilterValue) => void;
  readonly onCancel: () => void;
  readonly onApply: () => void;
}

function DateFilterEditor({
  panelId,
  appliesToId,
  periodId,
  draft,
  canApply,
  currentDate,
  onDateFieldChange,
  onPeriodChange,
  onExactDateFilterChange,
  onCancel,
  onApply,
}: DateFilterEditorProps) {
  const { t } = useTranslation();

  return (
    <div
      id={panelId}
      className="date-filter-popover-content"
      role="dialog"
      aria-label={t("filters.date")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onCancel();
      }}
    >
      <Typography.Title level={5} className="date-filter-popover-title">
        {t("filters.date")}
      </Typography.Title>
      <Space orientation="vertical" size="middle" className="full-width">
        <DateFilterFieldSelector
          labelId={appliesToId}
          value={draft.dateField}
          onChange={onDateFieldChange}
        />
        <DateFilterPeriodSelector
          labelId={periodId}
          value={draft.period}
          onChange={onPeriodChange}
        />
        {draft.period === "exact" && (
          <ExactDateFilterControls
            value={{
              dateComparison: draft.dateComparison,
              cutoffLocalDay: draft.cutoffLocalDay,
            }}
            currentDate={currentDate}
            onChange={onExactDateFilterChange}
          />
        )}
        <Flex justify="end" wrap gap="small">
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button type="primary" disabled={!canApply} onClick={onApply}>
            {t("filters.apply")}
          </Button>
        </Flex>
      </Space>
    </div>
  );
}

export default DateFilterEditor;
