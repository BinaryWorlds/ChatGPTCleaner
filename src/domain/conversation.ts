export interface Conversation {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number | null;
  readonly updatedAt: number | null;
}

export type ConversationDateField = "createdAt" | "updatedAt";
export type DateComparison = "before" | "after";
export type ConversationSortField = "title" | ConversationDateField;
export type SortDirection = "ascending" | "descending";

export interface LocalCalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface ConversationFilters {
  readonly titleQuery: string;
  readonly dateField: ConversationDateField | null;
  readonly dateComparison: DateComparison | null;
  readonly cutoffLocalDay: LocalCalendarDay | null;
}

export const EMPTY_CONVERSATION_FILTERS: ConversationFilters = {
  titleQuery: "",
  dateField: null,
  dateComparison: null,
  cutoffLocalDay: null,
};

export function startOfLocalDay(localDay: LocalCalendarDay): number {
  return new Date(localDay.year, localDay.month - 1, localDay.day).getTime();
}

export function filterConversations(
  conversations: readonly Conversation[],
  filters: ConversationFilters,
): readonly Conversation[] {
  const normalizedTitleQuery = filters.titleQuery.trim().toLocaleLowerCase();
  const cutoff =
    filters.cutoffLocalDay === null
      ? null
      : startOfLocalDay(filters.cutoffLocalDay);

  return conversations.filter((conversation) => {
    if (
      normalizedTitleQuery !== "" &&
      !conversation.title.toLocaleLowerCase().includes(normalizedTitleQuery)
    ) {
      return false;
    }

    if (
      filters.dateField === null ||
      filters.dateComparison === null ||
      cutoff === null
    ) {
      return true;
    }

    const timestamp = conversation[filters.dateField];
    if (timestamp === null) {
      return false;
    }

    return filters.dateComparison === "before"
      ? timestamp < cutoff
      : timestamp >= cutoff;
  });
}

export function sortConversations(
  conversations: readonly Conversation[],
  field: ConversationSortField,
  direction: SortDirection,
): readonly Conversation[] {
  return [...conversations].sort((left, right) => {
    const leftValue = left[field];
    const rightValue = right[field];

    if (leftValue === null && rightValue === null) {
      return left.id.localeCompare(right.id);
    }
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;

    const comparison =
      typeof leftValue === "string"
        ? leftValue.localeCompare(String(rightValue), undefined, {
            sensitivity: "base",
          })
        : leftValue - Number(rightValue);

    if (comparison === 0) return left.id.localeCompare(right.id);
    return direction === "ascending" ? comparison : -comparison;
  });
}

export function olderThanPreset(
  days: 7 | 30 | 90,
  now: Date,
): LocalCalendarDay {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);

  return {
    year: cutoff.getFullYear(),
    month: cutoff.getMonth() + 1,
    day: cutoff.getDate(),
  };
}

function daysInLocalMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function calendarCutoff(
  now: Date,
  yearsToSubtract: number,
  monthsToSubtract: number,
): LocalCalendarDay {
  const absoluteMonth =
    now.getFullYear() * 12 +
    now.getMonth() -
    yearsToSubtract * 12 -
    monthsToSubtract;
  const year = Math.floor(absoluteMonth / 12);
  const monthIndex = absoluteMonth - year * 12;
  const day = Math.min(now.getDate(), daysInLocalMonth(year, monthIndex));
  return { year, month: monthIndex + 1, day };
}

export function olderThanCalendarPreset(
  period: "six-months" | "one-year",
  now: Date,
): LocalCalendarDay {
  return period === "six-months"
    ? calendarCutoff(now, 0, 6)
    : calendarCutoff(now, 1, 0);
}
