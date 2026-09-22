import { z } from "zod";

const boundedIdentifierSchema = z.string().min(1).max(512);
const paginationCursorSchema = z.string().min(1).max(2_048).nullable();

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

export function normalizeDisplayTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
