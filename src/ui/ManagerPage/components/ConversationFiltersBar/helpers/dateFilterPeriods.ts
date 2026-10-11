import {
  olderThanCalendarPreset,
  olderThanPreset,
  type LocalCalendarDay,
} from "domain/conversation";

const DATE_FILTER_PERIODS = [
  "older-than-7-days",
  "older-than-30-days",
  "older-than-90-days",
  "older-than-6-months",
  "older-than-1-year",
  "exact",
] as const;

export type DatePeriod = (typeof DATE_FILTER_PERIODS)[number];
type DateFilterPreset = Exclude<DatePeriod, "exact">;

export function isDatePeriod(value: unknown): value is DatePeriod {
  return DATE_FILTER_PERIODS.some((period) => period === value);
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

export function cutoffForDatePeriod(
  period: DateFilterPreset,
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
): DateFilterPreset | null {
  for (const period of DATE_FILTER_PERIODS) {
    if (period === "exact") continue;
    if (sameLocalDay(cutoffLocalDay, cutoffForDatePeriod(period, now))) {
      return period;
    }
  }

  return null;
}
