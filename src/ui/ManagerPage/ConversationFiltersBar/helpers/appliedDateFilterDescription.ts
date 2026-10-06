import type { TFunction } from "i18next";
import type { ConversationFilters } from "../../../../domain/conversation";
import { hasAppliedDateFilter } from "./conversationDateFilter";
import { matchingDateFilterPeriod } from "./dateFilterPeriods";

interface AppliedDateFilterDescriptionOptions {
  readonly filters: ConversationFilters;
  readonly translate: TFunction;
  readonly language: string | undefined;
  readonly currentDate: () => Date;
}

export function describeAppliedDateFilter({
  filters,
  translate,
  language,
  currentDate,
}: AppliedDateFilterDescriptionOptions): string | null {
  if (!hasAppliedDateFilter(filters)) return null;

  const dateFieldLabel =
    filters.dateField === "createdAt"
      ? translate("filters.creationDate")
      : translate("filters.lastUpdate");
  const preset =
    filters.dateComparison === "before"
      ? matchingDateFilterPeriod(filters.cutoffLocalDay, currentDate())
      : null;
  const condition =
    preset === null
      ? translate(`filters.${filters.dateComparison}DateValue`, {
          date: new Intl.DateTimeFormat(language, {
            dateStyle: "medium",
          }).format(
            new Date(
              filters.cutoffLocalDay.year,
              filters.cutoffLocalDay.month - 1,
              filters.cutoffLocalDay.day,
            ),
          ),
        })
      : translate(`filters.${preset}`);

  return translate("filters.appliedDate", {
    field: dateFieldLabel,
    condition,
  });
}
