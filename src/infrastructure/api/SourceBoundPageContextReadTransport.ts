import type { Clock } from "application/ports/Clock";
import { appErrorCode } from "application/AppError";
import { STANDALONE_CONVERSATION_PAGE_LIMIT } from "application/ports/ConversationGateway";
import {
  ChatGptOperation,
  type ReadResult,
} from "application/ports/ConversationGateway";
import { ApiRequestLifecycleEvent } from "application/ports/Observability";
import type { SourceTabValidator } from "application/ports/SourceTabLifecycle";
import { executeReadWithRetry } from "./readRetry";
import {
  normalizeExecutionResult,
  sourceFailure,
  type PageContextReadExecutor,
  type PageReadOperation,
  type ReadTransportPayload,
} from "./PageContextReadContracts";
import { createOperationId, logger } from "infrastructure/observability/logger";

export class PageContextReadTransport {
  private boundSourceTabId: number | null = null;
  private operationId = createOperationId();

  public constructor(
    private readonly sourceTab: SourceTabValidator,
    private readonly executor: PageContextReadExecutor,
    private readonly clock: Clock,
  ) {}

  public async beginSafetyInventoryRead(): Promise<ReadResult<null>> {
    this.operationId = createOperationId();
    this.boundSourceTabId = null;
    this.executor.beginInventoryRun?.();
    const source = await this.sourceTab.validate();
    if (source.kind !== "valid") {
      logger.warn("sourceTab.validation.failed", {
        operationId: this.operationId,
        errorCode: appErrorCode("SourceTabUnavailable"),
      });
      return sourceFailure();
    }
    this.boundSourceTabId = source.tabId;
    return { kind: "success", value: null };
  }

  public readStandalonePage(
    offset: number,
  ): Promise<ReadResult<ReadTransportPayload>> {
    const paginationStep =
      Math.floor(offset / STANDALONE_CONVERSATION_PAGE_LIMIT) + 1;
    return this.read("standalone", paginationStep, (tabId) =>
      this.executor.fetchStandalonePage(tabId, offset, paginationStep),
    );
  }

  public readProjectsPage(
    cursor: string | null,
    paginationStep = 1,
  ): Promise<ReadResult<ReadTransportPayload>> {
    return this.read("projects", paginationStep, (tabId) =>
      this.executor.fetchProjectsPage(tabId, cursor, paginationStep),
    );
  }

  public readProjectConversationPage(
    projectId: string,
    cursor: string | null,
    paginationStep = 1,
  ): Promise<ReadResult<ReadTransportPayload>> {
    return this.read("project-conversations", paginationStep, (tabId) =>
      this.executor.fetchProjectConversationsPage(
        tabId,
        projectId,
        cursor,
        paginationStep,
      ),
    );
  }

  private async read(
    operation: PageReadOperation["kind"],
    paginationStep: number,
    execute: (tabId: number) => Promise<unknown>,
  ): Promise<ReadResult<ReadTransportPayload>> {
    if (this.boundSourceTabId === null) {
      const sourceResult = await this.beginSafetyInventoryRead();
      if (sourceResult.kind === "failure") return sourceResult;
    }
    const operationName =
      operation === "standalone"
        ? ChatGptOperation.StandaloneConversationsList
        : operation === "projects"
          ? ChatGptOperation.ProjectsList
          : ChatGptOperation.ProjectConversationsList;
    return executeReadWithRetry<ReadTransportPayload>({
      clock: this.clock,
      operationId: this.operationId,
      page: paginationStep,
      operation: operationName,
      attempt: async () => {
        const sourceTabId = this.boundSourceTabId;
        if (sourceTabId === null) {
          return sourceFailure();
        }

        let rawResult: unknown;
        try {
          rawResult = await execute(sourceTabId);
        } catch {
          logger.warn(ApiRequestLifecycleEvent.Failed, {
            operationId: this.operationId,
            operation: operationName,
            page: paginationStep,
            stage: "TRANSPORT_ERROR",
            responseReceived: false,
          });
          return { kind: "network-error" };
        }
        return normalizeExecutionResult(rawResult, operation, paginationStep);
      },
    });
  }
}
