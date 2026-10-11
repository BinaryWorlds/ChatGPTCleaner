import { Button, Flex } from "antd";
import { useTranslation } from "react-i18next";
import {
  EMPTY_CONVERSATION_FILTERS,
  type ConversationFilters,
} from "domain/conversation";
import AppliedDateFilterTag from "./components/AppliedDateFilterTag";
import ConversationTitleSearch from "./components/ConversationTitleSearch";
import DateFilterPopover from "./components/DateFilterPopover";
import {
  describeAppliedDateFilter,
  type ConversationDateFilter,
  withoutDateFilter,
} from "./helpers";

interface ConversationFiltersBarProps {
  readonly filters: ConversationFilters;
  readonly onChange: (filters: ConversationFilters) => void;
  readonly currentDate?: () => Date;
}

function ConversationFiltersBar({
  filters,
  onChange,
  currentDate = () => new Date(),
}: ConversationFiltersBarProps) {
  const { t, i18n } = useTranslation();
  const filtersAlreadyClear =
    filters.titleQuery === EMPTY_CONVERSATION_FILTERS.titleQuery &&
    filters.dateField === EMPTY_CONVERSATION_FILTERS.dateField &&
    filters.dateComparison === EMPTY_CONVERSATION_FILTERS.dateComparison &&
    filters.cutoffLocalDay === EMPTY_CONVERSATION_FILTERS.cutoffLocalDay;
  const appliedDateDescription = describeAppliedDateFilter({
    filters,
    translate: t,
    language: i18n.resolvedLanguage,
    currentDate,
  });

  return (
    <Flex className="filter-toolbar" wrap gap="small">
      <ConversationTitleSearch
        value={filters.titleQuery}
        onChange={(titleQuery) => onChange({ ...filters, titleQuery })}
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
        <AppliedDateFilterTag
          description={appliedDateDescription}
          onRemove={() => onChange(withoutDateFilter(filters))}
        />
      )}
    </Flex>
  );
}

export default ConversationFiltersBar;
