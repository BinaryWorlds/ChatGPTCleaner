import {
  type ConversationDateField,
  type DateComparison,
  type LocalCalendarDay,
} from "domain/conversation";
import {
  hasAppliedDateFilter,
  type ConversationDateFilter,
} from "ui/ManagerPage/components/ConversationFiltersBar/helpers";
import {
  cutoffForDatePeriod,
  matchingDateFilterPeriod,
  type DatePeriod,
} from "ui/ManagerPage/components/ConversationFiltersBar/helpers";

export interface DateFilterDraft {
  readonly dateField: ConversationDateField;
  readonly period: DatePeriod | null;
  readonly dateComparison: DateComparison;
  readonly cutoffLocalDay: LocalCalendarDay | null;
}

export type ExactDateFilterValue = Pick<
  DateFilterDraft,
  "dateComparison" | "cutoffLocalDay"
>;

export const EMPTY_DATE_FILTER_DRAFT: DateFilterDraft = {
  dateField: "updatedAt",
  period: null,
  dateComparison: "before",
  cutoffLocalDay: null,
};

export function buildDateFilterDraft(
  dateFilter: ConversationDateFilter,
  now: Date,
): DateFilterDraft {
  if (!hasAppliedDateFilter(dateFilter)) return EMPTY_DATE_FILTER_DRAFT;

  const matchingPreset =
    dateFilter.dateComparison === "before"
      ? matchingDateFilterPeriod(dateFilter.cutoffLocalDay, now)
      : null;

  return {
    dateField: dateFilter.dateField,
    period: matchingPreset ?? "exact",
    dateComparison: dateFilter.dateComparison,
    cutoffLocalDay: dateFilter.cutoffLocalDay,
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
      : cutoffForDatePeriod(draft.period, now);
  if (cutoffLocalDay === null) return null;

  return {
    dateField: draft.dateField,
    dateComparison: draft.period === "exact" ? draft.dateComparison : "before",
    cutoffLocalDay,
  };
}

export function canApplyDateFilterDraft(draft: DateFilterDraft): boolean {
  return !(
    draft.period === null ||
    (draft.period === "exact" && draft.cutoffLocalDay === null)
  );
}
