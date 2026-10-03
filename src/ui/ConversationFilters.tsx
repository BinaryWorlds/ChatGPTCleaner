import { CloseOutlined } from "@ant-design/icons";
import { Button, Flex, Input, Tag } from "antd";
import { useTranslation } from "react-i18next";
import {
  EMPTY_CONVERSATION_FILTERS,
  type ConversationFilters,
} from "../domain/conversation";
import {
  DateFilterPopover,
  matchingDateFilterPeriod,
  type ConversationDateFilter,
} from "./DateFilterPopover";

interface ConversationFiltersProps {
  readonly filters: ConversationFilters;
  readonly onChange: (filters: ConversationFilters) => void;
  readonly currentDate?: () => Date;
}

function hasAppliedDateFilter(filters: ConversationFilters): boolean {
  return (
    filters.dateField !== null &&
    filters.dateComparison !== null &&
    filters.cutoffLocalDay !== null
  );
}

function withoutDateFilter(filters: ConversationFilters): ConversationFilters {
  return {
    ...filters,
    dateField: null,
    dateComparison: null,
    cutoffLocalDay: null,
  };
}

export function ConversationFiltersBar({
  filters,
  onChange,
  currentDate = () => new Date(),
}: ConversationFiltersProps) {
  const { t, i18n } = useTranslation();
  const dateFilterApplied = hasAppliedDateFilter(filters);
  const filtersAlreadyClear =
    filters.titleQuery === EMPTY_CONVERSATION_FILTERS.titleQuery &&
    filters.dateField === EMPTY_CONVERSATION_FILTERS.dateField &&
    filters.dateComparison === EMPTY_CONVERSATION_FILTERS.dateComparison &&
    filters.cutoffLocalDay === EMPTY_CONVERSATION_FILTERS.cutoffLocalDay;

  const dateFieldLabel =
    filters.dateField === "createdAt"
      ? t("filters.creationDate")
      : t("filters.lastUpdate");
  let appliedDateDescription: string | null = null;
  if (
    dateFilterApplied &&
    filters.cutoffLocalDay !== null &&
    filters.dateComparison !== null
  ) {
    const preset =
      filters.dateComparison === "before"
        ? matchingDateFilterPeriod(filters.cutoffLocalDay, currentDate())
        : null;
    const condition =
      preset === null
        ? t(`filters.${filters.dateComparison}DateValue`, {
            date: new Intl.DateTimeFormat(i18n.resolvedLanguage, {
              dateStyle: "medium",
            }).format(
              new Date(
                filters.cutoffLocalDay.year,
                filters.cutoffLocalDay.month - 1,
                filters.cutoffLocalDay.day,
              ),
            ),
          })
        : t(`filters.${preset}`);
    appliedDateDescription = t("filters.appliedDate", {
      field: dateFieldLabel,
      condition,
    });
  }

  return (
    <Flex className="filter-toolbar" wrap gap="small">
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
      <DateFilterPopover
        dateFilter={{
          dateField: filters.dateField,
          dateComparison: filters.dateComparison,
          cutoffLocalDay: filters.cutoffLocalDay,
        }}
        currentDate={currentDate}
        onChange={(dateFilter: ConversationDateFilter) =>
          onChange({ ...filters, ...dateFilter })
        }
      />
      <Button
        disabled={filtersAlreadyClear}
        onClick={() => onChange(EMPTY_CONVERSATION_FILTERS)}
      >
        {t("filters.clear")}
      </Button>
      {appliedDateDescription !== null && (
        <Tag className="applied-date-filter">
          <span>{appliedDateDescription}</span>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined aria-hidden />}
            aria-label={t("filters.removeDate")}
            onClick={() => onChange(withoutDateFilter(filters))}
          />
        </Tag>
      )}
    </Flex>
  );
}
