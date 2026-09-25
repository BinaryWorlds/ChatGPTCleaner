import { z } from "zod";
import {
  isSafetyCriticalIdentifier,
  MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH,
} from "../../domain/identifier";

export const MAX_PAGINATION_CURSOR_LENGTH = 2_048;

const boundedIdentifierSchema = z
  .string()
  .min(1)
  .max(MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH)
  .refine(isSafetyCriticalIdentifier);
export const paginationCursorSchema = z
  .string()
  .min(1)
  .max(MAX_PAGINATION_CURSOR_LENGTH)
  .nullable();

export function parseSafetyCriticalIdentifier(value: unknown): string | null {
  const parsed = boundedIdentifierSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parsePaginationCursor(value: unknown): string | null | false {
  const parsed = paginationCursorSchema.safeParse(value);
  return parsed.success ? parsed.data : false;
}

export function normalizeDisplayTitle(value: unknown): string {
  return typeof value === "string" && value.trim() !== ""
    ? value
    : "(Untitled)";
}
