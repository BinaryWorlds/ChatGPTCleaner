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
import {
  logReadEvent,
  logSchemaValidationFailure,
} from "../observability/readLogging";
import { createOperationId, logger } from "../observability/logger";
import type {
  PageContextReadTransport,
  ReadPageTiming,
  ReadTransportPayload,
} from "./PageContextReadTransport";
import type { PageContextDeleteTransport } from "./PageContextDeleteTransport";
import { STANDALONE_PAGE_LIMIT } from "./readLimits";
import {
  createReadDiagnostic,
  createSchemaDiagnostic,
} from "./readDiagnostics";
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
  items: z.array(rawConversationSchema),
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

interface StandalonePagePerformance extends ReadPageTiming {
  readonly offset: number;
  readonly validationMs: number;
  readonly paginationMs: number;
  readonly totalPageMs: number;
  readonly gapSincePreviousPageMs: number;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

export class ProductionConversationGateway implements ConversationGateway {
  private inventoryOperationId = createOperationId();
  private lastStandalonePageFinishedAt: number | null = null;
  private standalonePerformance: StandalonePagePerformance[] = [];
  private standaloneCrawlStartedAt: number | null = null;
  private activeStandaloneReads = 0;
  private maxObservedStandaloneReadConcurrency = 0;

  public constructor(
    private readonly transport: PageContextReadTransport,
    private readonly deleteTransport?: Pick<
      PageContextDeleteTransport,
      "deleteConversation"
    >,
  ) {}

  public beginSafetyInventoryRead(): Promise<ReadResult<null>> {
    this.inventoryOperationId = createOperationId();
    this.lastStandalonePageFinishedAt = null;
    this.standalonePerformance = [];
    this.standaloneCrawlStartedAt = performance.now();
    this.activeStandaloneReads = 0;
    this.maxObservedStandaloneReadConcurrency = 0;
    logger.info("inventory.standalone.started", {
      operationId: this.inventoryOperationId,
      limit: STANDALONE_PAGE_LIMIT,
    });
    return this.transport.beginSafetyInventoryRead();
  }

  public completeStandaloneInventoryRead(committedPageCount: number): void {
    const terminalOffsetExclusive = committedPageCount * STANDALONE_PAGE_LIMIT;
    const committedSamples = this.standalonePerformance.filter(
      (sample) => sample.offset < terminalOffsetExclusive,
    );
    const totalWallClockMs =
      this.standaloneCrawlStartedAt === null
        ? 0
        : performance.now() - this.standaloneCrawlStartedAt;
    logger.info("inventory.standalone.completed", {
      operationId: this.inventoryOperationId,
      pageCount: committedPageCount,
      maxObservedConcurrency: this.maxObservedStandaloneReadConcurrency,
      durationMs: rounded(totalWallClockMs),
      averagePageDurationMs: rounded(
        average(committedSamples.map((sample) => sample.backendFetchMs)),
      ),
    });
  }

  private async readStandalonePage(
    requestedOffset: number,
  ): Promise<ReadResult<ReadTransportPayload>> {
    this.activeStandaloneReads += 1;
    this.maxObservedStandaloneReadConcurrency = Math.max(
      this.maxObservedStandaloneReadConcurrency,
      this.activeStandaloneReads,
    );
    try {
      return await this.transport.readStandalonePage(requestedOffset);
    } finally {
      this.activeStandaloneReads -= 1;
    }
  }

  public async fetchStandaloneConversationPage(
    cursor: string | null,
  ): Promise<ReadResult<ConversationPage>> {
    const pageStartedAt = performance.now();
    const gapSincePreviousPageMs =
      this.lastStandalonePageFinishedAt === null
        ? 0
        : pageStartedAt - this.lastStandalonePageFinishedAt;
    const requestedOffset = parseOffset(cursor);
    if (requestedOffset === null) {
      return {
        kind: "failure",
        reason: "compatibility",
        diagnostic: createReadDiagnostic({
          operation: "standalone",
          paginationStep: 1,
          category: "pagination-contract",
          fieldPath: "offset",
          expectedType: "non-negative integer offset",
          actualType: "string",
        }),
      };
    }
    const result = await this.readStandalonePage(requestedOffset);
    if (result.kind === "failure") return result;

    const paginationStep =
      Math.floor(requestedOffset / STANDALONE_PAGE_LIMIT) + 1;
    logReadEvent({
      operation: "standalone",
      page: paginationStep,
      endpoint: "/backend-api/conversations",
      stage: "SCHEMA_VALIDATION_START",
      status: result.value.httpStatus,
      jsonParsed: true,
    });
    const validationStartedAt = performance.now();
    const parsed = standalonePageSchema.safeParse(result.value.body);
    const validationMs = performance.now() - validationStartedAt;
    if (!parsed.success) {
      logSchemaValidationFailure(
        "standalone",
        paginationStep,
        parsed.error.issues,
      );
      return {
        kind: "failure",
        reason: "compatibility",
        diagnostic: createSchemaDiagnostic({
          operation: "standalone",
          paginationStep,
          httpStatus: result.value.httpStatus,
          body: result.value.body,
          error: parsed.error,
        }),
      };
    }
    logReadEvent({
      operation: "standalone",
      page: paginationStep,
      endpoint: "/backend-api/conversations",
      stage: "SCHEMA_VALIDATION_OK",
    });
    if (parsed.data.offset !== requestedOffset) {
      logReadEvent({
        operation: "standalone",
        page: paginationStep,
        stage: "PAGINATION_STATE",
        itemCount: parsed.data.items.length,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
        total: parsed.data.total,
        paginationDecision: "BLOCKED",
        reason: "response offset differs from requested offset",
      });
      return {
        kind: "failure",
        reason: "compatibility",
        diagnostic: createReadDiagnostic({
          operation: "standalone",
          paginationStep,
          category: "pagination-contract",
          httpStatus: result.value.httpStatus,
          jsonParsed: true,
          fieldPath: "offset",
          expectedType: "requested offset",
          actualType: "number",
        }),
      };
    }
    const effectivePageLimit = Math.min(
      STANDALONE_PAGE_LIMIT,
      parsed.data.limit,
    );
    if (parsed.data.items.length > effectivePageLimit) {
      logReadEvent({
        operation: "standalone",
        page: paginationStep,
        stage: "PAGINATION_STATE",
        itemCount: parsed.data.items.length,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
        total: parsed.data.total,
        paginationDecision: "BLOCKED",
        reason: "returned item count exceeds requested limit",
      });
      return {
        kind: "failure",
        reason: "compatibility",
        diagnostic: createReadDiagnostic({
          operation: "standalone",
          paginationStep,
          category: "pagination-contract",
          httpStatus: result.value.httpStatus,
          jsonParsed: true,
          fieldPath: "items",
          expectedType: "item count within effective response limit",
          actualType: "array",
        }),
      };
    }

    const paginationStartedAt = performance.now();
    const observedEnd = requestedOffset + parsed.data.items.length;
    const pageIsFull = parsed.data.items.length === effectivePageLimit;
    const totalIndicatesMore =
      parsed.data.items.length > 0 && observedEnd < parsed.data.total;
    const complete = !pageIsFull && !totalIndicatesMore;
    const paginationMs = performance.now() - paginationStartedAt;
    logReadEvent({
      operation: "standalone",
      page: paginationStep,
      stage: "PAGINATION_STATE",
      itemCount: parsed.data.items.length,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
      total: parsed.data.total,
      calculatedNextOffset: observedEnd,
      paginationDecision: complete ? "COMPLETE" : "CONTINUE",
      reason: complete
        ? "returned page is short and total does not indicate more"
        : pageIsFull
          ? "returned page is full at the effective response limit"
          : "informational total indicates more records",
    });
    const finishedAt = performance.now();
    const performanceSample: StandalonePagePerformance = {
      ...result.value.timing,
      offset: requestedOffset,
      validationMs,
      paginationMs,
      totalPageMs: finishedAt - pageStartedAt,
      gapSincePreviousPageMs,
    };
    this.standalonePerformance.push(performanceSample);
    this.lastStandalonePageFinishedAt = finishedAt;
    logger.debug("inventory.standalone.page.succeeded", {
      operationId: this.inventoryOperationId,
      page: paginationStep,
      sourceTabMs: rounded(performanceSample.sourceTabMs),
      executeScriptMs: rounded(performanceSample.executeScriptMs),
      backendFetchMs: rounded(performanceSample.backendFetchMs),
      jsonParseMs: rounded(performanceSample.jsonParseMs),
      validationMs: rounded(performanceSample.validationMs),
      paginationMs: rounded(performanceSample.paginationMs),
      gapSincePreviousPageMs: rounded(performanceSample.gapSincePreviousPageMs),
      totalPageMs: rounded(performanceSample.totalPageMs),
      itemCount: parsed.data.items.length,
      responseLimit: parsed.data.limit,
      effectivePageLimit,
      total: parsed.data.total,
      nextOffset: complete ? null : observedEnd,
      paginationDecision: complete ? "COMPLETE" : "CONTINUE",
    });
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
    const startedAt = performance.now();
    logger.info("inventory.projects.discovery.started", {
      operationId: this.inventoryOperationId,
    });
    const projectsById = new Map<string, ProjectReference>();
    const visitedCursors = new Set<string>();
    let cursor: string | null = null;

    for (let page = 0; page < INVENTORY_MAX_PAGES; page += 1) {
      const paginationStep = page + 1;
      const result = await this.transport.readProjectsPage(
        cursor,
        paginationStep,
      );
      if (result.kind === "failure") return result;
      logReadEvent({
        operation: "projects",
        page: paginationStep,
        endpoint: "/backend-api/gizmos/snorlax/sidebar",
        stage: "SCHEMA_VALIDATION_START",
        status: result.value.httpStatus,
        jsonParsed: true,
      });
      const parsed = projectsPageSchema.safeParse(result.value.body);
      if (!parsed.success) {
        logSchemaValidationFailure(
          "projects",
          paginationStep,
          parsed.error.issues,
        );
        return {
          kind: "failure",
          reason: "compatibility",
          diagnostic: createSchemaDiagnostic({
            operation: "projects",
            paginationStep,
            httpStatus: result.value.httpStatus,
            body: result.value.body,
            error: parsed.error,
          }),
        };
      }
      logReadEvent({
        operation: "projects",
        page: paginationStep,
        endpoint: "/backend-api/gizmos/snorlax/sidebar",
        stage: "SCHEMA_VALIDATION_OK",
      });
      for (const item of parsed.data.items) {
        const id = item.gizmo.gizmo.id;
        projectsById.set(id, { id });
        if (projectsById.size > INVENTORY_MAX_RECORDS) {
          return {
            kind: "failure",
            reason: "compatibility",
            diagnostic: createReadDiagnostic({
              operation: "projects",
              paginationStep,
              category: "pagination-contract",
              httpStatus: result.value.httpStatus,
              jsonParsed: true,
              fieldPath: "items",
              expectedType: "bounded Project collection",
              actualType: "array",
            }),
          };
        }
      }

      const nextCursor = parsed.data.cursor;
      if (nextCursor === null) {
        logReadEvent({
          operation: "projects",
          page: paginationStep,
          stage: "PAGINATION_STATE",
          itemCount: parsed.data.items.length,
          cursorType: "null",
          cursorPresent: false,
          paginationDecision: "COMPLETE",
          reason: "terminal null cursor",
        });
        logger.info("inventory.projects.discovery.completed", {
          operationId: this.inventoryOperationId,
          pageCount: paginationStep,
          itemCount: projectsById.size,
          durationMs: rounded(performance.now() - startedAt),
        });
        return { kind: "success", value: [...projectsById.values()] };
      }
      if (nextCursor === cursor || visitedCursors.has(nextCursor)) {
        logReadEvent({
          operation: "projects",
          page: paginationStep,
          stage: "PAGINATION_STATE",
          itemCount: parsed.data.items.length,
          cursorType: typeof nextCursor,
          cursorPresent: true,
          paginationDecision: "BLOCKED",
          reason: "cursor did not progress",
        });
        return {
          kind: "failure",
          reason: "compatibility",
          diagnostic: createReadDiagnostic({
            operation: "projects",
            paginationStep,
            category: "pagination-non-progress",
            httpStatus: result.value.httpStatus,
            jsonParsed: true,
            fieldPath: "cursor",
            expectedType: "new cursor or terminal null",
            actualType: "string",
          }),
        };
      }
      logReadEvent({
        operation: "projects",
        page: paginationStep,
        stage: "PAGINATION_STATE",
        itemCount: parsed.data.items.length,
        cursorType: typeof nextCursor,
        cursorPresent: true,
        paginationDecision: "CONTINUE",
        reason: "new non-null cursor",
      });
      visitedCursors.add(nextCursor);
      cursor = nextCursor;
    }

    return {
      kind: "failure",
      reason: "compatibility",
      diagnostic: createReadDiagnostic({
        operation: "projects",
        paginationStep: INVENTORY_MAX_PAGES,
        category: "pagination-contract",
        fieldPath: "cursor",
        expectedType: "terminal null within safety ceiling",
        actualType: "string",
      }),
    };
  }

  public async fetchProjectConversationPage(
    projectId: string,
    cursor: string | null,
    paginationStep = 1,
  ): Promise<ReadResult<ProjectConversationPage>> {
    const startedAt = performance.now();
    logger.debug("inventory.project.started", {
      operationId: this.inventoryOperationId,
      page: paginationStep,
    });
    if (parseSafetyCriticalIdentifier(projectId) === null) {
      return {
        kind: "failure",
        reason: "compatibility",
        diagnostic: createReadDiagnostic({
          operation: "project-conversations",
          paginationStep,
          category: "response-contract",
          fieldPath: "projectId",
          expectedType: "non-empty bounded identifier",
          actualType: "string",
        }),
      };
    }
    const result = await this.transport.readProjectConversationPage(
      projectId,
      cursor,
      paginationStep,
    );
    if (result.kind === "failure") return result;
    logReadEvent({
      operation: "project-conversations",
      page: paginationStep,
      endpoint: "/backend-api/gizmos/{project-id}/conversations",
      stage: "SCHEMA_VALIDATION_START",
      status: result.value.httpStatus,
      jsonParsed: true,
    });
    const parsed = projectConversationPageSchema.safeParse(result.value.body);
    if (!parsed.success) {
      logSchemaValidationFailure(
        "project-conversations",
        paginationStep,
        parsed.error.issues,
      );
      return {
        kind: "failure",
        reason: "compatibility",
        diagnostic: createSchemaDiagnostic({
          operation: "project-conversations",
          paginationStep,
          httpStatus: result.value.httpStatus,
          body: result.value.body,
          error: parsed.error,
        }),
      };
    }
    logReadEvent({
      operation: "project-conversations",
      page: paginationStep,
      endpoint: "/backend-api/gizmos/{project-id}/conversations",
      stage: "SCHEMA_VALIDATION_OK",
    });
    logReadEvent({
      operation: "project-conversations",
      page: paginationStep,
      stage: "PAGINATION_STATE",
      itemCount: parsed.data.items.length,
      cursorType:
        parsed.data.cursor === null ? "null" : typeof parsed.data.cursor,
      cursorPresent: parsed.data.cursor !== null,
      paginationDecision: parsed.data.cursor === null ? "COMPLETE" : "CONTINUE",
      reason:
        parsed.data.cursor === null
          ? "terminal null cursor"
          : "non-null cursor",
    });
    logger.debug("inventory.project.completed", {
      operationId: this.inventoryOperationId,
      page: paginationStep,
      itemCount: parsed.data.items.length,
      durationMs: rounded(performance.now() - startedAt),
    });
    return {
      kind: "success",
      value: {
        conversations: parsed.data.items.map(normalizeConversation),
        nextCursor: parsed.data.cursor,
      },
    };
  }

  public deleteConversation(
    conversationId: string,
  ): Promise<DeleteAttemptResult> {
    if (this.deleteTransport === undefined) {
      return Promise.resolve({ kind: "fatal", reason: "response-anomaly" });
    }
    return this.deleteTransport.deleteConversation(conversationId);
  }
}
