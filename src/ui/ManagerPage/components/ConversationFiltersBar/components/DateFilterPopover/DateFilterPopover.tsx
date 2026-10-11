import { Button, Grid, Popover } from "antd";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  hasAppliedDateFilter,
  type ConversationDateFilter,
} from "ui/ManagerPage/components/ConversationFiltersBar/helpers";
import DateFilterEditor from "./DateFilterEditor";
import { useDateFilterDraft } from "./useDateFilterDraft";

interface DateFilterPopoverProps {
  readonly dateFilter: ConversationDateFilter;
  readonly onChange: (dateFilter: ConversationDateFilter) => void;
  readonly currentDate: () => Date;
}

function DateFilterPopover({
  dateFilter,
  onChange,
  currentDate,
}: DateFilterPopoverProps) {
  const { t } = useTranslation();
  const screens = Grid.useBreakpoint();
  const panelId = useId();
  const appliesToId = useId();
  const periodId = useId();
  const {
    popoverOpen,
    draft,
    dateTriggerRef,
    canApplyDraft,
    handleOpenChange,
    cancelDraft,
    applyDraft,
    updateDateField,
    updatePeriod,
    updateExactDateFilter,
  } = useDateFilterDraft({ dateFilter, onChange, currentDate });

  return (
    <Popover
      content={
        <DateFilterEditor
          panelId={panelId}
          appliesToId={appliesToId}
          periodId={periodId}
          draft={draft}
          canApply={canApplyDraft}
          currentDate={currentDate}
          onDateFieldChange={updateDateField}
          onPeriodChange={updatePeriod}
          onExactDateFilterChange={updateExactDateFilter}
          onCancel={cancelDraft}
          onApply={applyDraft}
        />
      }
      trigger="click"
      placement={screens.lg ? "bottomRight" : "bottom"}
      open={popoverOpen}
      destroyOnHidden
      onOpenChange={handleOpenChange}
    >
      <Button
        ref={dateTriggerRef}
        type={hasAppliedDateFilter(dateFilter) ? "primary" : "default"}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-controls={popoverOpen ? panelId : undefined}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !popoverOpen) return;
          event.stopPropagation();
          cancelDraft();
        }}
      >
        {t("filters.date")}
      </Button>
    </Popover>
  );
}

export default DateFilterPopover;
