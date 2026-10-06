import type {
  ConversationDateField,
  DateComparison,
} from "../../../../../domain/conversation";

export function isConversationDateField(
  value: unknown,
): value is ConversationDateField {
  return value === "createdAt" || value === "updatedAt";
}

export function isDateComparison(value: unknown): value is DateComparison {
  return value === "before" || value === "after";
}
