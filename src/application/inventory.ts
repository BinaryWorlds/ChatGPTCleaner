import type { Conversation } from "../domain/conversation";
import { excludeProjectConversations } from "../domain/selection";
import type {
  ConversationGateway,
  ReadFailureReason,
} from "./ports/ConversationGateway";
import type { ProtectedConversationStore } from "./ports/ProtectedConversationStore";
import type { SettingsStore } from "./ports/SettingsStore";
import { loadRequestsPerMinute } from "./settings";
import { INVENTORY_MAX_PAGES, INVENTORY_MAX_RECORDS } from "./paginationLimits";

export interface SafetyInventory {
  readonly standaloneConversations: readonly Conversation[];
  readonly projectConversationIds: ReadonlySet<string>;
}

export type SafetyInventoryResult =
  | { readonly kind: "ready"; readonly inventory: SafetyInventory }
  | {
      readonly kind: "blocked";
      readonly reason: ReadFailureReason | "pagination";
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
      readonly reason: ReadFailureReason | "pagination" | "protected-storage";
    };

async function loadStandaloneConversations(
  gateway: ConversationGateway,
): Promise<
  | {
      readonly kind: "success";
      readonly conversations: readonly Conversation[];
    }
  | {
      readonly kind: "failure";
      readonly reason: ReadFailureReason | "pagination";
    }
> {
  const conversationsById = new Map<string, Conversation>();
  const visitedCursors = new Set<string>();
  let cursor: string | null = null;

  for (let pageCount = 0; pageCount < INVENTORY_MAX_PAGES; pageCount += 1) {
    const pageResult = await gateway.fetchStandaloneConversationPage(cursor);
    if (pageResult.kind === "failure") return pageResult;

    for (const conversation of pageResult.value.conversations) {
      conversationsById.set(conversation.id, conversation);
      if (conversationsById.size > INVENTORY_MAX_RECORDS) {
        return { kind: "failure", reason: "pagination" };
      }
    }

    const nextCursor = pageResult.value.nextCursor;
    if (nextCursor === null) {
      return {
        kind: "success",
        conversations: [...conversationsById.values()],
      };
    }
    if (nextCursor === cursor || visitedCursors.has(nextCursor)) {
      return { kind: "failure", reason: "pagination" };
    }
    visitedCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return { kind: "failure", reason: "pagination" };
}

async function loadProjectConversationIds(
  gateway: ConversationGateway,
): Promise<
  | { readonly kind: "success"; readonly conversationIds: ReadonlySet<string> }
  | {
      readonly kind: "failure";
      readonly reason: ReadFailureReason | "pagination";
    }
> {
  const projectsResult = await gateway.fetchProjects();
  if (projectsResult.kind === "failure") return projectsResult;

  const conversationIds = new Set<string>();
  let totalPages = 0;

  for (const project of projectsResult.value) {
    const visitedCursors = new Set<string>();
    let cursor: string | null = null;

    while (totalPages < INVENTORY_MAX_PAGES) {
      const pageResult = await gateway.fetchProjectConversationPage(
        project.id,
        cursor,
      );
      if (pageResult.kind === "failure") return pageResult;
      totalPages += 1;

      for (const conversationId of pageResult.value.conversationIds) {
        conversationIds.add(conversationId);
        if (conversationIds.size > INVENTORY_MAX_RECORDS) {
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

    if (cursor !== null && totalPages >= INVENTORY_MAX_PAGES) {
      return { kind: "failure", reason: "pagination" };
    }
  }

  return { kind: "success", conversationIds };
}

export async function loadSafetyInventory(
  gateway: ConversationGateway,
): Promise<SafetyInventoryResult> {
  const standaloneResult = await loadStandaloneConversations(gateway);
  if (standaloneResult.kind === "failure") {
    return { kind: "blocked", reason: standaloneResult.reason };
  }

  const projectResult = await loadProjectConversationIds(gateway);
  if (projectResult.kind === "failure") {
    return { kind: "blocked", reason: projectResult.reason };
  }

  return {
    kind: "ready",
    inventory: {
      standaloneConversations: excludeProjectConversations(
        standaloneResult.conversations,
        projectResult.conversationIds,
      ),
      projectConversationIds: projectResult.conversationIds,
    },
  };
}

export async function loadInventory(input: {
  readonly gateway: ConversationGateway;
  readonly protectedConversationStore: ProtectedConversationStore;
  readonly settingsStore: SettingsStore;
}): Promise<InventoryLoadResult> {
  const safetyInventoryResult = await loadSafetyInventory(input.gateway);
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
