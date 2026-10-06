import type {
  ConversationDateField,
  ConversationFilters,
  DateComparison,
  LocalCalendarDay,
} from "../../../../domain/conversation";

export type ConversationDateFilter = Pick<
  ConversationFilters,
  "dateField" | "dateComparison" | "cutoffLocalDay"
>;

type AppliedConversationDateFilter = ConversationDateFilter & {
  readonly dateField: ConversationDateField;
  readonly dateComparison: DateComparison;
  readonly cutoffLocalDay: LocalCalendarDay;
};

export function hasAppliedDateFilter(
  dateFilter: ConversationDateFilter,
): dateFilter is AppliedConversationDateFilter {
  return (
    dateFilter.dateField !== null &&
    dateFilter.dateComparison !== null &&
    dateFilter.cutoffLocalDay !== null
  );
}

export function withoutDateFilter(
  filters: ConversationFilters,
): ConversationFilters {
  return {
    ...filters,
    dateField: null,
    dateComparison: null,
    cutoffLocalDay: null,
  };
}
