import type { Conversation } from "../domain/conversation";
import { AppConfig } from "../config";
import { excludeProjectConversations } from "../domain/selection";
import type {
  ConversationGateway,
  ConversationPage,
  ReadFailureDiagnostic,
  ReadFailureReason,
  ReadResult,
} from "./ports/ConversationGateway";
import { STANDALONE_CONVERSATION_PAGE_LIMIT } from "./ports/ConversationGateway";
import type { ProtectedConversationStore } from "./ports/ProtectedConversationStore";
import type { SettingsStore } from "./ports/SettingsStore";
import { loadRequestsPerMinute } from "./settings";
import type { SafetyBlockReason } from "./SafetyBlockReason";

export interface SafetyInventory {
  readonly standaloneConversations: readonly Conversation[];
  readonly projectConversations: readonly Conversation[];
  readonly projectConversationIds: ReadonlySet<string>;
}

export type SafetyInventoryResult =
  | { readonly kind: "ready"; readonly inventory: SafetyInventory }
  | {
      readonly kind: "blocked";
      readonly reason: Extract<
        SafetyBlockReason,
        ReadFailureReason | "pagination"
      >;
      readonly diagnostic?: ReadFailureDiagnostic;
    };

export type InventoryLoadResult =
  | {
      readonly kind: "ready";
      readonly inventory: SafetyInventory;
      readonly protectedConversationIds: ReadonlySet<string>;
      readonly requestsPerMinute: number;
    }
  | {
      readonly kind: "blocked";
      readonly reason: Extract<
        SafetyBlockReason,
        ReadFailureReason | "pagination" | "protected-storage"
      >;
      readonly diagnostic?: ReadFailureDiagnostic;
    };

export type InventoryLoadProgress =
  | { readonly kind: "read-compatible" }
  | {
      readonly kind: "standalone-progress";
      readonly loadedConversationCount: number;
    }
  | {
      readonly kind: "project-protection-started";
      readonly loadedConversationCount: number;
    };

export type InventoryLoadProgressListener = (
  progress: InventoryLoadProgress,
) => void;

async function loadStandaloneConversations(
  gateway: ConversationGateway,
  onProgress?: InventoryLoadProgressListener,
): Promise<
  | {
      readonly kind: "success";
      readonly conversations: readonly Conversation[];
    }
  | {
      readonly kind: "failure";
      readonly reason: ReadFailureReason | "pagination";
      readonly diagnostic?: ReadFailureDiagnostic;
    }
> {
  const conversationsById = new Map<string, Conversation>();
  let committedPageCount = 0;
  const visitedCursors = new Set<string>();

  const commitPage = (
    pageResult: ReadResult<ConversationPage>,
  ):
    | { readonly kind: "complete" }
    | { readonly kind: "continue"; readonly nextCursor: string }
    | {
        readonly kind: "failure";
        readonly reason: ReadFailureReason | "pagination";
        readonly diagnostic?: ReadFailureDiagnostic;
      } => {
    if (pageResult.kind === "failure") return pageResult;

    const previousConversationCount = conversationsById.size;
    for (const conversation of pageResult.value.conversations) {
      conversationsById.set(conversation.id, conversation);
      if (conversationsById.size > AppConfig.inventory.maxRecords) {
        return { kind: "failure", reason: "pagination" };
      }
    }

    committedPageCount += 1;
    onProgress?.({
      kind: "standalone-progress",
      loadedConversationCount: conversationsById.size,
    });

    const nextCursor = pageResult.value.nextCursor;
    if (nextCursor === null) {
      gateway.completeStandaloneInventoryRead(committedPageCount);
      return { kind: "complete" };
    }
    if (
      conversationsById.size === previousConversationCount ||
      visitedCursors.has(nextCursor)
    ) {
      return { kind: "failure", reason: "pagination" };
    }
    visitedCursors.add(nextCursor);
    return { kind: "continue", nextCursor };
  };

  const firstPageResult = await gateway.fetchStandaloneConversationPage(null);
  if (firstPageResult.kind === "success") {
    onProgress?.({ kind: "read-compatible" });
  }
  const firstPage = commitPage(firstPageResult);
  if (firstPage.kind === "failure") return firstPage;
  if (firstPage.kind === "complete") {
    return {
      kind: "success",
      conversations: [...conversationsById.values()],
    };
  }

  let nextCursor = firstPage.nextCursor;
  let fixedOffsetMode =
    nextCursor === String(STANDALONE_CONVERSATION_PAGE_LIMIT);

  while (committedPageCount < AppConfig.inventory.maxPages) {
    if (!fixedOffsetMode) {
      const pageResult =
        await gateway.fetchStandaloneConversationPage(nextCursor);
      const committedPage = commitPage(pageResult);
      if (committedPage.kind === "failure") return committedPage;
      if (committedPage.kind === "complete") {
        return {
          kind: "success",
          conversations: [...conversationsById.values()],
        };
      }
      nextCursor = committedPage.nextCursor;
      continue;
    }

    const nextPageIndex = committedPageCount;
    const remainingPageCapacity =
      AppConfig.inventory.maxPages - committedPageCount;
    const windowSize = Math.min(
      AppConfig.inventory.standaloneReadConcurrency,
      remainingPageCapacity,
    );
    const pageIndexes = Array.from(
      { length: windowSize },
      (_, index) => nextPageIndex + index,
    );
    const pageResults = await Promise.all(
      pageIndexes.map((pageIndex) =>
        gateway.fetchStandaloneConversationPage(
          String(pageIndex * STANDALONE_CONVERSATION_PAGE_LIMIT),
        ),
      ),
    );

    for (let index = 0; index < pageResults.length; index += 1) {
      const pageResult = pageResults[index];
      const pageIndex = pageIndexes[index];
      if (pageResult === undefined || pageIndex === undefined) {
        return { kind: "failure", reason: "pagination" };
      }
      const committedPage = commitPage(pageResult);
      if (committedPage.kind === "failure") return committedPage;
      if (committedPage.kind === "complete") {
        return {
          kind: "success",
          conversations: [...conversationsById.values()],
        };
      }

      const expectedNextCursor = String(
        (pageIndex + 1) * STANDALONE_CONVERSATION_PAGE_LIMIT,
      );
      nextCursor = committedPage.nextCursor;
      if (nextCursor !== expectedNextCursor) {
        fixedOffsetMode = false;
        break;
      }
    }
  }

  return { kind: "failure", reason: "pagination" };
}

async function loadProjectConversationIds(
  gateway: ConversationGateway,
): Promise<
  | {
      readonly kind: "success";
      readonly conversations: readonly Conversation[];
      readonly conversationIds: ReadonlySet<string>;
    }
  | {
      readonly kind: "failure";
      readonly reason: ReadFailureReason | "pagination";
      readonly diagnostic?: ReadFailureDiagnostic;
    }
> {
  const projectsResult = await gateway.fetchProjects();
  if (projectsResult.kind === "failure") return projectsResult;

  const conversationIds = new Set<string>();
  const conversationsById = new Map<string, Conversation>();
  let totalPages = 0;

  for (const project of projectsResult.value) {
    const visitedCursors = new Set<string>();
    let cursor: string | null = null;
    let projectPage = 1;

    while (totalPages < AppConfig.inventory.maxPages) {
      const pageResult = await gateway.fetchProjectConversationPage(
        project.id,
        cursor,
        projectPage,
      );
      if (pageResult.kind === "failure") return pageResult;
      totalPages += 1;
      projectPage += 1;

      for (const conversation of pageResult.value.conversations) {
        conversationIds.add(conversation.id);
        conversationsById.set(conversation.id, conversation);
        if (conversationIds.size > AppConfig.inventory.maxRecords) {
          return { kind: "failure", reason: "pagination" };
        }
      }

      const nextCursor = pageResult.value.nextCursor;
      if (nextCursor === null) break;
      if (nextCursor === cursor || visitedCursors.has(nextCursor)) {
        return { kind: "failure", reason: "pagination" };
      }
      visitedCursors.add(nextCursor);
      cursor = nextCursor;
    }

    if (cursor !== null && totalPages >= AppConfig.inventory.maxPages) {
      return { kind: "failure", reason: "pagination" };
    }
  }

  return {
    kind: "success",
    conversations: [...conversationsById.values()],
    conversationIds,
  };
}

export async function loadSafetyInventory(
  gateway: ConversationGateway,
  onProgress?: InventoryLoadProgressListener,
): Promise<SafetyInventoryResult> {
  const sourceResult = await gateway.beginSafetyInventoryRead();
  if (sourceResult.kind === "failure") {
    return {
      kind: "blocked",
      reason: sourceResult.reason,
      ...(sourceResult.diagnostic === undefined
        ? {}
        : { diagnostic: sourceResult.diagnostic }),
    };
  }

  const standaloneResult = await loadStandaloneConversations(
    gateway,
    onProgress,
  );
  if (standaloneResult.kind === "failure") {
    return {
      kind: "blocked",
      reason: standaloneResult.reason,
      ...(standaloneResult.diagnostic === undefined
        ? {}
        : { diagnostic: standaloneResult.diagnostic }),
    };
  }

  onProgress?.({
    kind: "project-protection-started",
    loadedConversationCount: standaloneResult.conversations.length,
  });
  const projectResult = await loadProjectConversationIds(gateway);
  if (projectResult.kind === "failure") {
    return {
      kind: "blocked",
      reason: projectResult.reason,
      ...(projectResult.diagnostic === undefined
        ? {}
        : { diagnostic: projectResult.diagnostic }),
    };
  }

  return {
    kind: "ready",
    inventory: {
      standaloneConversations: excludeProjectConversations(
        standaloneResult.conversations,
        projectResult.conversationIds,
      ),
      projectConversations: projectResult.conversations,
      projectConversationIds: projectResult.conversationIds,
    },
  };
}

export async function loadInventory(input: {
  readonly gateway: ConversationGateway;
  readonly protectedConversationStore: ProtectedConversationStore;
  readonly settingsStore: SettingsStore;
  readonly onProgress?: InventoryLoadProgressListener;
}): Promise<InventoryLoadResult> {
  const safetyInventoryResult = await loadSafetyInventory(
    input.gateway,
    input.onProgress,
  );
  if (safetyInventoryResult.kind === "blocked") return safetyInventoryResult;

  const protectedIdsResult =
    await input.protectedConversationStore.loadProtectedConversationIds();
  if (protectedIdsResult.kind === "invalid") {
    return { kind: "blocked", reason: "protected-storage" };
  }

  return {
    kind: "ready",
    inventory: safetyInventoryResult.inventory,
    protectedConversationIds: protectedIdsResult.protectedConversationIds,
    requestsPerMinute: await loadRequestsPerMinute(input.settingsStore),
  };
}
