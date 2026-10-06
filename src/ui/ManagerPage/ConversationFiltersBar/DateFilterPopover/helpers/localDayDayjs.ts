import dayjs, { type Dayjs } from "dayjs";
import type { LocalCalendarDay } from "../../../../../domain/conversation";

export function toDayjs(localDay: LocalCalendarDay | null): Dayjs | null {
  if (localDay === null) return null;

  return dayjs()
    .year(localDay.year)
    .month(localDay.month - 1)
    .date(localDay.day)
    .startOf("day");
}

export function toLocalCalendarDay(
  date: Dayjs | null,
): LocalCalendarDay | null {
  if (date === null) return null;

  return {
    year: date.year(),
    month: date.month() + 1,
    day: date.date(),
  };
}
