import {
  Button,
  DatePicker,
  Flex,
  Grid,
  Popover,
  Radio,
  Space,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  olderThanCalendarPreset,
  olderThanPreset,
  type ConversationDateField,
  type ConversationFilters,
  type DateComparison,
  type LocalCalendarDay,
} from "../domain/conversation";

export type ConversationDateFilter = Pick<
  ConversationFilters,
  "dateField" | "dateComparison" | "cutoffLocalDay"
>;

export type DatePeriod =
  | "older-than-7-days"
  | "older-than-30-days"
  | "older-than-90-days"
  | "older-than-6-months"
  | "older-than-1-year"
  | "exact";

export interface DateFilterDraft {
  readonly dateField: ConversationDateField;
  readonly period: DatePeriod | null;
  readonly dateComparison: DateComparison;
  readonly cutoffLocalDay: LocalCalendarDay | null;
}

interface DateFilterPopoverProps {
  readonly dateFilter: ConversationDateFilter;
  readonly onChange: (dateFilter: ConversationDateFilter) => void;
  readonly currentDate: () => Date;
}

type ExactDateFilterValue = Pick<
  DateFilterDraft,
  "dateComparison" | "cutoffLocalDay"
>;

interface ExactDateFilterControlsProps {
  readonly value: ExactDateFilterValue;
  readonly onChange: (value: ExactDateFilterValue) => void;
  readonly currentDate: () => Date;
}

const EMPTY_DATE_FILTER_DRAFT: DateFilterDraft = {
  dateField: "updatedAt",
  period: null,
  dateComparison: "before",
  cutoffLocalDay: null,
};

function isConversationDateField(
  value: unknown,
): value is ConversationDateField {
  return value === "createdAt" || value === "updatedAt";
}

function isDatePeriod(value: unknown): value is DatePeriod {
  return (
    value === "older-than-7-days" ||
    value === "older-than-30-days" ||
    value === "older-than-90-days" ||
    value === "older-than-6-months" ||
    value === "older-than-1-year" ||
    value === "exact"
  );
}

function isDateComparison(value: unknown): value is DateComparison {
  return value === "before" || value === "after";
}

function toDayjs(localDay: LocalCalendarDay | null): Dayjs | null {
  if (localDay === null) return null;
  return dayjs()
    .year(localDay.year)
    .month(localDay.month - 1)
    .date(localDay.day)
    .startOf("day");
}

function toLocalCalendarDay(date: Dayjs | null): LocalCalendarDay | null {
  if (date === null) return null;
  return {
    year: date.year(),
    month: date.month() + 1,
    day: date.date(),
  };
}

function sameLocalDay(
  first: LocalCalendarDay | null,
  second: LocalCalendarDay,
): boolean {
  return (
    first?.year === second.year &&
    first.month === second.month &&
    first.day === second.day
  );
}

function hasAppliedDateFilter(dateFilter: ConversationDateFilter): boolean {
  return (
    dateFilter.dateField !== null &&
    dateFilter.dateComparison !== null &&
    dateFilter.cutoffLocalDay !== null
  );
}

function cutoffForPeriod(
  period: Exclude<DatePeriod, "exact">,
  now: Date,
): LocalCalendarDay {
  if (period === "older-than-7-days") return olderThanPreset(7, now);
  if (period === "older-than-30-days") return olderThanPreset(30, now);
  if (period === "older-than-90-days") return olderThanPreset(90, now);
  if (period === "older-than-6-months") {
    return olderThanCalendarPreset("six-months", now);
  }
  return olderThanCalendarPreset("one-year", now);
}

export function matchingDateFilterPeriod(
  cutoffLocalDay: LocalCalendarDay,
  now: Date,
): Exclude<DatePeriod, "exact"> | null {
  const periods: readonly Exclude<DatePeriod, "exact">[] = [
    "older-than-7-days",
    "older-than-30-days",
    "older-than-90-days",
    "older-than-6-months",
    "older-than-1-year",
  ];
  return (
    periods.find((period) =>
      sameLocalDay(cutoffLocalDay, cutoffForPeriod(period, now)),
    ) ?? null
  );
}

export function buildDateFilterDraft(
  dateFilter: ConversationDateFilter,
  now: Date,
): DateFilterDraft {
  if (!hasAppliedDateFilter(dateFilter)) return EMPTY_DATE_FILTER_DRAFT;

  const dateField = dateFilter.dateField ?? "updatedAt";
  const dateComparison = dateFilter.dateComparison ?? "before";
  const cutoffLocalDay = dateFilter.cutoffLocalDay;
  if (cutoffLocalDay === null) return EMPTY_DATE_FILTER_DRAFT;

  const matchingPreset =
    dateComparison === "before"
      ? matchingDateFilterPeriod(cutoffLocalDay, now)
      : null;
  return {
    dateField,
    period: matchingPreset ?? "exact",
    dateComparison,
    cutoffLocalDay,
  };
}

export function applyDateFilterDraft(
  draft: DateFilterDraft,
  now: Date,
): ConversationDateFilter | null {
  if (draft.period === null) return null;

  const cutoffLocalDay =
    draft.period === "exact"
      ? draft.cutoffLocalDay
      : cutoffForPeriod(draft.period, now);
  if (cutoffLocalDay === null) return null;

  return {
    dateField: draft.dateField,
    dateComparison: draft.period === "exact" ? draft.dateComparison : "before",
    cutoffLocalDay,
  };
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

export function DateFilterPopover({
  dateFilter,
  onChange,
  currentDate,
}: DateFilterPopoverProps) {
  const { t } = useTranslation();
  const screens = Grid.useBreakpoint();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [draft, setDraft] = useState<DateFilterDraft>(EMPTY_DATE_FILTER_DRAFT);
  const dateTriggerRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const panelId = useId();
  const appliesToId = useId();
  const periodId = useId();

  const closePopover = () => {
    setPopoverOpen(false);
    dateTriggerRef.current?.focus({ preventScroll: true });
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setDraft(buildDateFilterDraft(dateFilter, currentDate()));
      setPopoverOpen(true);
      return;
    }
    closePopover();
  };

  const applyDraft = () => {
    const nextDateFilter = applyDateFilterDraft(draft, currentDate());
    if (nextDateFilter === null) return;

    onChange(nextDateFilter);
    closePopover();
  };

  const datePopover = (
    <div
      id={panelId}
      className="date-filter-popover-content"
      role="dialog"
      aria-label={t("filters.date")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        closePopover();
      }}
    >
      <Typography.Title level={5} className="date-filter-popover-title">
        {t("filters.date")}
      </Typography.Title>
      <Space orientation="vertical" size="middle" className="full-width">
        <div>
          <Typography.Text id={appliesToId} strong>
            {t("filters.appliesTo")}
          </Typography.Text>
          <Radio.Group
            aria-labelledby={appliesToId}
            className="date-filter-radio-group"
            value={draft.dateField}
            onChange={(event) => {
              const dateField: unknown = event.target.value;
              if (!isConversationDateField(dateField)) return;
              setDraft({ ...draft, dateField });
            }}
          >
            <Radio value="updatedAt">{t("filters.lastUpdate")}</Radio>
            <Radio value="createdAt">{t("filters.creationDate")}</Radio>
          </Radio.Group>
        </div>
        <div>
          <Typography.Text id={periodId} strong>
            {t("filters.periodCondition")}
          </Typography.Text>
          <Radio.Group
            aria-labelledby={periodId}
            className="date-filter-radio-group"
            value={draft.period}
            onChange={(event) => {
              const period: unknown = event.target.value;
              if (!isDatePeriod(period)) return;
              setDraft({ ...draft, period });
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
        {draft.period === "exact" && (
          <ExactDateFilterControls
            value={{
              dateComparison: draft.dateComparison,
              cutoffLocalDay: draft.cutoffLocalDay,
            }}
            currentDate={currentDate}
            onChange={(exactDateFilter) =>
              setDraft({ ...draft, ...exactDateFilter })
            }
          />
        )}
        <Flex justify="end" wrap gap="small">
          <Button onClick={closePopover}>{t("common.cancel")}</Button>
          <Button
            type="primary"
            disabled={
              draft.period === null ||
              (draft.period === "exact" && draft.cutoffLocalDay === null)
            }
            onClick={applyDraft}
          >
            {t("filters.apply")}
          </Button>
        </Flex>
      </Space>
    </div>
  );

  return (
    <Popover
      content={datePopover}
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
          closePopover();
        }}
      >
        {t("filters.date")}
      </Button>
    </Popover>
  );
}
