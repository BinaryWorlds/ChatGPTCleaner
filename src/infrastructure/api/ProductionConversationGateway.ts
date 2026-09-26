import { AppConfig } from "../../config";
import { createAppError } from "../../application/AppError";
import { isSafetyCriticalIdentifier } from "../../domain/identifier";
import type {
  ConversationGateway,
  ConversationPage,
  DeleteAttemptResult,
  ProjectConversationPage,
  ProjectReference,
  ReadResult,
} from "../../application/ports/ConversationGateway";
import {
  ChatGptOperation,
  STANDALONE_CONVERSATION_PAGE_LIMIT,
} from "../../application/ports/ConversationGateway";
import { logSchemaValidationFailure } from "../observability/readLogging";
import { logger } from "../observability/logger";
import type { PageContextReadTransport } from "./SourceBoundPageContextReadTransport";
import type { PageContextDeleteTransport } from "./PageContextDeleteTransport";
import {
  createReadDiagnostic,
  createSchemaDiagnostic,
} from "./readDiagnostics";
import {
  normalizeConversation,
  parseProjectConversationPage,
  parseProjectsPage,
  parseStandalonePage,
} from "./conversationPageParsing";
import {
  decideCursorPagination,
  decideStandalonePagination,
  parseOffset,
} from "./paginationDecisions";

export class ProductionConversationGateway implements ConversationGateway {
  public constructor(
    private readonly transport: PageContextReadTransport,
    private readonly deleteTransport?: Pick<
      PageContextDeleteTransport,
      "deleteConversation"
    >,
  ) {}

  public beginSafetyInventoryRead(): Promise<ReadResult<null>> {
    return this.transport.beginSafetyInventoryRead();
  }

  public async fetchStandaloneConversationPage(
    cursor: string | null,
  ): Promise<ReadResult<ConversationPage>> {
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
    const result = await this.transport.readStandalonePage(requestedOffset);
    if (result.kind === "failure") return result;

    const paginationStep =
      Math.floor(requestedOffset / STANDALONE_CONVERSATION_PAGE_LIMIT) + 1;
    const parsed = parseStandalonePage(result.value.body);
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
    const paginationDecision = decideStandalonePagination(
      requestedOffset,
      STANDALONE_CONVERSATION_PAGE_LIMIT,
      parsed.data,
    );
    if (
      paginationDecision.kind === "blocked" &&
      paginationDecision.reason === "offset-mismatch"
    ) {
      logger.warn("inventory.pagination.state", {
        operation: ChatGptOperation.StandaloneConversationsList,
        page: paginationStep,
        itemCount: parsed.data.items.length,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
        total: parsed.data.total,
        paginationDecision: "BLOCKED",
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
    if (paginationDecision.kind === "blocked") {
      logger.warn("inventory.pagination.state", {
        operation: ChatGptOperation.StandaloneConversationsList,
        page: paginationStep,
        itemCount: parsed.data.items.length,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
        total: parsed.data.total,
        paginationDecision: "BLOCKED",
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

    const { complete, observedEnd } = paginationDecision;
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

    for (let page = 0; page < AppConfig.inventory.maxPages; page += 1) {
      const paginationStep = page + 1;
      const result = await this.transport.readProjectsPage(
        cursor,
        paginationStep,
      );
      if (result.kind === "failure") return result;
      const parsed = parseProjectsPage(result.value.body);
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
      for (const item of parsed.data.items) {
        const id = item.gizmo.gizmo.id;
        projectsById.set(id, { id });
        if (projectsById.size > AppConfig.inventory.maxRecords) {
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
      const paginationDecision = decideCursorPagination(
        cursor,
        visitedCursors,
        nextCursor,
      );
      if (paginationDecision.kind === "complete") {
        return { kind: "success", value: [...projectsById.values()] };
      }
      if (paginationDecision.kind === "blocked") {
        logger.warn("inventory.pagination.state", {
          operation: ChatGptOperation.ProjectsList,
          page: paginationStep,
          itemCount: parsed.data.items.length,
          cursorType: typeof nextCursor,
          cursorPresent: true,
          paginationDecision: "BLOCKED",
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
      visitedCursors.add(paginationDecision.nextCursor);
      cursor = paginationDecision.nextCursor;
    }

    return {
      kind: "failure",
      reason: "compatibility",
      diagnostic: createReadDiagnostic({
        operation: "projects",
        paginationStep: AppConfig.inventory.maxPages,
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
    if (!isSafetyCriticalIdentifier(projectId)) {
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
    const parsed = parseProjectConversationPage(result.value.body);
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
      return Promise.resolve({
        kind: "fatal",
        reason: "response-anomaly",
        error: createAppError("ApiCompatibilityFailure", {
          operation: ChatGptOperation.ConversationDelete,
        }),
      });
    }
    return this.deleteTransport.deleteConversation(conversationId);
  }
}
