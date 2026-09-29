import { Button, DatePicker, Flex, Input, Select, Space } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import {
  EMPTY_CONVERSATION_FILTERS,
  olderThanCalendarPreset,
  olderThanPreset,
  type ConversationDateField,
  type ConversationFilters,
  type DateComparison,
  type LocalCalendarDay,
} from "../domain/conversation";

interface ConversationFiltersProps {
  readonly filters: ConversationFilters;
  readonly onChange: (filters: ConversationFilters) => void;
  readonly currentDate?: () => Date;
}

function toDayjs(localDay: LocalCalendarDay | null): Dayjs | null {
  if (localDay === null) return null;
  return dayjs()
    .year(localDay.year)
    .month(localDay.month - 1)
    .date(localDay.day)
    .startOf("day");
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

export function ConversationFiltersBar({
  filters,
  onChange,
  currentDate = () => new Date(),
}: ConversationFiltersProps) {
  const { t } = useTranslation();
  const today = currentDate();
  const activePreset = (cutoff: LocalCalendarDay): boolean =>
    filters.dateField !== null &&
    filters.dateComparison === "before" &&
    sameLocalDay(filters.cutoffLocalDay, cutoff);
  const setPreset = (days: 7 | 30 | 90) => {
    onChange({
      ...filters,
      dateField: filters.dateField ?? "updatedAt",
      dateComparison: "before",
      cutoffLocalDay: olderThanPreset(days, currentDate()),
    });
  };

  const setCalendarPreset = (period: "six-months" | "one-year") => {
    onChange({
      ...filters,
      dateField: filters.dateField ?? "updatedAt",
      dateComparison: "before",
      cutoffLocalDay: olderThanCalendarPreset(period, currentDate()),
    });
  };

  return (
    <Space orientation="vertical" size="small" className="full-width">
      <Flex className="filter-primary-controls" wrap gap="small">
        <Input.Search
          className="filter-title-search"
          aria-label={t("filters.searchTitles")}
          allowClear
          placeholder={t("filters.searchTitles")}
          value={filters.titleQuery}
          onChange={(event) =>
            onChange({ ...filters, titleQuery: event.target.value })
          }
        />
        <Select<ConversationDateField>
          className="filter-date-field"
          aria-label={t("filters.dateField")}
          placeholder={t("filters.dateField")}
          value={filters.dateField}
          options={[
            { value: "createdAt", label: t("filters.created") },
            { value: "updatedAt", label: t("filters.updated") },
          ]}
          onChange={(dateField) => onChange({ ...filters, dateField })}
        />
        <Select<DateComparison>
          className="filter-date-comparison"
          aria-label={t("filters.dateOperator")}
          placeholder={t("filters.beforeAfter")}
          value={filters.dateComparison}
          options={[
            { value: "before", label: t("filters.before") },
            { value: "after", label: t("filters.after") },
          ]}
          onChange={(dateComparison) =>
            onChange({ ...filters, dateComparison })
          }
        />
        <DatePicker
          className="filter-date-picker"
          aria-label={t("filters.cutoffDate")}
          placeholder={t("filters.selectDate")}
          value={toDayjs(filters.cutoffLocalDay)}
          onChange={(date) =>
            onChange({
              ...filters,
              cutoffLocalDay:
                date === null
                  ? null
                  : {
                      year: date.year(),
                      month: date.month() + 1,
                      day: date.date(),
                    },
            })
          }
        />
        <Button onClick={() => onChange(EMPTY_CONVERSATION_FILTERS)}>
          {t("filters.reset")}
        </Button>
      </Flex>
      <Flex className="filter-preset-controls" wrap gap="small">
        <Button
          className="filter-preset"
          type={activePreset(olderThanPreset(7, today)) ? "primary" : "default"}
          ghost={activePreset(olderThanPreset(7, today))}
          onClick={() => setPreset(7)}
        >
          {t("filters.olderThanDays", { count: 7 })}
        </Button>
        <Button
          className="filter-preset"
          type={
            activePreset(olderThanPreset(30, today)) ? "primary" : "default"
          }
          ghost={activePreset(olderThanPreset(30, today))}
          onClick={() => setPreset(30)}
        >
          {t("filters.olderThanDays", { count: 30 })}
        </Button>
        <Button
          className="filter-preset"
          type={
            activePreset(olderThanPreset(90, today)) ? "primary" : "default"
          }
          ghost={activePreset(olderThanPreset(90, today))}
          onClick={() => setPreset(90)}
        >
          {t("filters.olderThanDays", { count: 90 })}
        </Button>
        <Button
          className="filter-preset"
          type={
            activePreset(olderThanCalendarPreset("six-months", today))
              ? "primary"
              : "default"
          }
          ghost={activePreset(olderThanCalendarPreset("six-months", today))}
          onClick={() => setCalendarPreset("six-months")}
        >
          {t("filters.olderThanMonths", { count: 6 })}
        </Button>
        <Button
          className="filter-preset"
          type={
            activePreset(olderThanCalendarPreset("one-year", today))
              ? "primary"
              : "default"
          }
          ghost={activePreset(olderThanCalendarPreset("one-year", today))}
          onClick={() => setCalendarPreset("one-year")}
        >
          {t("filters.olderThanYears", { count: 1 })}
        </Button>
      </Flex>
    </Space>
  );
}
