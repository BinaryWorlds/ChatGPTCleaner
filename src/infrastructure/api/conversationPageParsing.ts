import { z } from "zod";
import type { Conversation } from "domain/conversation";
import {
  isSafetyCriticalIdentifier,
  MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH,
} from "domain/identifier";
import {
  normalizeDisplayTitle,
  paginationCursorSchema,
} from "./readValidation";

const identifierSchema = z
  .string()
  .max(MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH)
  .refine(isSafetyCriticalIdentifier);
const rawConversationSchema = z.object({
  id: identifierSchema,
  title: z.unknown().optional(),
  create_time: z.unknown().optional(),
  update_time: z.unknown().optional(),
});
const standalonePageSchema = z.object({
  items: z.array(rawConversationSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
const projectItemSchema = z.object({
  gizmo: z.object({
    gizmo: z.object({ id: identifierSchema }),
  }),
});
const projectsPageSchema = z.object({
  items: z.array(projectItemSchema),
  cursor: paginationCursorSchema,
});
const projectConversationPageSchema = z.object({
  items: z.array(rawConversationSchema),
  cursor: paginationCursorSchema,
});

export type StandalonePage = z.infer<typeof standalonePageSchema>;

export function parseStandalonePage(body: unknown) {
  return standalonePageSchema.safeParse(body);
}

export function parseProjectsPage(body: unknown) {
  return projectsPageSchema.safeParse(body);
}

export function parseProjectConversationPage(body: unknown) {
  return projectConversationPageSchema.safeParse(body);
}

function displayTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function normalizeConversation(
  rawConversation: z.infer<typeof rawConversationSchema>,
): Conversation {
  return {
    id: rawConversation.id,
    title: normalizeDisplayTitle(rawConversation.title),
    createdAt: displayTimestamp(rawConversation.create_time),
    updatedAt: displayTimestamp(rawConversation.update_time),
  };
}
