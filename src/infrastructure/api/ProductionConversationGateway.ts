import { z } from "zod";
import {
  INVENTORY_MAX_PAGES,
  INVENTORY_MAX_RECORDS,
} from "../../application/paginationLimits";
import type {
  ConversationGateway,
  ConversationPage,
  DeleteAttemptResult,
  ProjectConversationPage,
  ProjectReference,
  ReadResult,
} from "../../application/ports/ConversationGateway";
import type { Conversation } from "../../domain/conversation";
import type { SourceTabValidationResult } from "../browser/SourceTab";
import type { PageContextReadTransport } from "./PageContextReadTransport";
import {
  normalizeDisplayTitle,
  parseSafetyCriticalIdentifier,
} from "./readValidation";

const identifierSchema = z
  .string()
  .max(512)
  .refine((value) => value.trim().length > 0);
const cursorSchema = z.string().min(1).max(2_048).nullable();
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
  cursor: cursorSchema,
});
const projectConversationPageSchema = z.object({
  items: z.array(z.object({ id: identifierSchema })),
  cursor: cursorSchema,
});

export interface SourceTabValidator {
  validate(): Promise<SourceTabValidationResult>;
}

function displayTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeConversation(
  rawConversation: z.infer<typeof rawConversationSchema>,
): Conversation {
  return {
    id: rawConversation.id,
    title: normalizeDisplayTitle(rawConversation.title),
    createdAt: displayTimestamp(rawConversation.create_time),
    updatedAt: displayTimestamp(rawConversation.update_time),
  };
}

function parseOffset(cursor: string | null): number | null {
  if (cursor === null) return 0;
  if (!/^\d+$/.test(cursor)) return null;
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) ? offset : null;
}

export class ProductionConversationGateway implements ConversationGateway {
  public constructor(private readonly transport: PageContextReadTransport) {}

  public async fetchStandaloneConversationPage(
    cursor: string | null,
  ): Promise<ReadResult<ConversationPage>> {
    const requestedOffset = parseOffset(cursor);
    if (requestedOffset === null) {
      return { kind: "failure", reason: "compatibility" };
    }
    const result = await this.transport.readStandalonePage(requestedOffset);
    if (result.kind === "failure") return result;

    const parsed = standalonePageSchema.safeParse(result.value);
    if (!parsed.success || parsed.data.offset !== requestedOffset) {
      return { kind: "failure", reason: "compatibility" };
    }
    if (parsed.data.items.length > parsed.data.limit) {
      return { kind: "failure", reason: "compatibility" };
    }

    const observedEnd = requestedOffset + parsed.data.items.length;
    if (
      parsed.data.items.length < parsed.data.limit &&
      observedEnd < parsed.data.total
    ) {
      return { kind: "failure", reason: "compatibility" };
    }

    const complete =
      parsed.data.items.length === 0 ||
      parsed.data.items.length < parsed.data.limit;
    return {
      kind: "success",
      value: {
        conversations: parsed.data.items.map(normalizeConversation),
        nextCursor: complete ? null : String(observedEnd),
      },
    };
  }

  public async fetchProjects(): Promise<
    ReadResult<readonly ProjectReference[]>
  > {
    const projectsById = new Map<string, ProjectReference>();
    const visitedCursors = new Set<string>();
    let cursor: string | null = null;

    for (let page = 0; page < INVENTORY_MAX_PAGES; page += 1) {
      const result = await this.transport.readProjectsPage(cursor);
      if (result.kind === "failure") return result;
      const parsed = projectsPageSchema.safeParse(result.value);
      if (!parsed.success) {
        return { kind: "failure", reason: "compatibility" };
      }
      for (const item of parsed.data.items) {
        const id = item.gizmo.gizmo.id;
        projectsById.set(id, { id });
        if (projectsById.size > INVENTORY_MAX_RECORDS) {
          return { kind: "failure", reason: "compatibility" };
        }
      }

      const nextCursor = parsed.data.cursor;
      if (nextCursor === null) {
        return { kind: "success", value: [...projectsById.values()] };
      }
      if (nextCursor === cursor || visitedCursors.has(nextCursor)) {
        return { kind: "failure", reason: "compatibility" };
      }
      visitedCursors.add(nextCursor);
      cursor = nextCursor;
    }

    return { kind: "failure", reason: "compatibility" };
  }

  public async fetchProjectConversationPage(
    projectId: string,
    cursor: string | null,
  ): Promise<ReadResult<ProjectConversationPage>> {
    if (parseSafetyCriticalIdentifier(projectId) === null) {
      return { kind: "failure", reason: "compatibility" };
    }
    const result = await this.transport.readProjectConversationPage(
      projectId,
      cursor,
    );
    if (result.kind === "failure") return result;
    const parsed = projectConversationPageSchema.safeParse(result.value);
    if (!parsed.success) {
      return { kind: "failure", reason: "compatibility" };
    }
    return {
      kind: "success",
      value: {
        conversationIds: parsed.data.items.map(({ id }) => id),
        nextCursor: parsed.data.cursor,
      },
    };
  }

  public deleteConversation(
    conversationId: string,
  ): Promise<DeleteAttemptResult> {
    void conversationId;
    return Promise.resolve({ kind: "fatal", reason: "response-anomaly" });
  }
}
