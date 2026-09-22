import { Button, DatePicker, Input, Select, Space } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import {
  EMPTY_CONVERSATION_FILTERS,
  olderThanPreset,
  type ConversationDateField,
  type ConversationFilters,
  type DateComparison,
  type LocalCalendarDay,
} from "../domain/conversation";

export interface ConversationFiltersProps {
  readonly filters: ConversationFilters;
  readonly onChange: (filters: ConversationFilters) => void;
}

function toDayjs(localDay: LocalCalendarDay | null): Dayjs | null {
  if (localDay === null) return null;
  return dayjs()
    .year(localDay.year)
    .month(localDay.month - 1)
    .date(localDay.day)
    .startOf("day");
}

export function ConversationFiltersBar({
  filters,
  onChange,
}: ConversationFiltersProps) {
  const setPreset = (days: 7 | 30 | 90) => {
    onChange({
      ...filters,
      dateField: filters.dateField ?? "updatedAt",
      dateComparison: "before",
      cutoffLocalDay: olderThanPreset(days, new Date()),
    });
  };

  return (
    <Space orientation="vertical" size="small" className="full-width">
      <Space wrap>
        <Input.Search
          aria-label="Search titles"
          allowClear
          placeholder="Search titles"
          value={filters.titleQuery}
          onChange={(event) =>
            onChange({ ...filters, titleQuery: event.target.value })
          }
        />
        <Select<ConversationDateField>
          aria-label="Date field"
          placeholder="Date field"
          value={filters.dateField}
          options={[
            { value: "createdAt", label: "Created" },
            { value: "updatedAt", label: "Updated" },
          ]}
          onChange={(dateField) => onChange({ ...filters, dateField })}
        />
        <Select<DateComparison>
          aria-label="Date operator"
          placeholder="Before / After"
          value={filters.dateComparison}
          options={[
            { value: "before", label: "Before" },
            { value: "after", label: "After" },
          ]}
          onChange={(dateComparison) =>
            onChange({ ...filters, dateComparison })
          }
        />
        <DatePicker
          aria-label="Cutoff date"
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
          Reset filters
        </Button>
      </Space>
      <Space wrap>
        <Button onClick={() => setPreset(7)}>Older than 7 days</Button>
        <Button onClick={() => setPreset(30)}>Older than 30 days</Button>
        <Button onClick={() => setPreset(90)}>Older than 90 days</Button>
      </Space>
    </Space>
  );
}
