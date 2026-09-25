import { buildDeletionPlan, type DeletionPlan } from "../domain/deletionPlan";
import { loadSafetyInventory } from "./inventory";
import type {
  ConversationGateway,
  ReadFailureReason,
} from "./ports/ConversationGateway";
import type { ProtectedConversationStore } from "./ports/ProtectedConversationStore";
import type { SafetyBlockReason } from "./SafetyBlockReason";

export type PreflightResult =
  | { readonly kind: "ready"; readonly plan: DeletionPlan }
  | {
      readonly kind: "blocked";
      readonly reason: Extract<
        SafetyBlockReason,
        ReadFailureReason | "pagination" | "protected-storage"
      >;
    };

export async function runPreflight(input: {
  readonly selectedConversationIds: readonly unknown[];
  readonly gateway: ConversationGateway;
  readonly protectedConversationStore: ProtectedConversationStore;
}): Promise<PreflightResult> {
  const inventoryResult = await loadSafetyInventory(input.gateway);
  if (inventoryResult.kind === "blocked") return inventoryResult;

  const protectedIdsResult =
    await input.protectedConversationStore.loadProtectedConversationIds();
  if (protectedIdsResult.kind === "invalid") {
    return { kind: "blocked", reason: "protected-storage" };
  }

  return {
    kind: "ready",
    plan: buildDeletionPlan({
      selectedConversationIds: input.selectedConversationIds,
      standaloneConversations:
        inventoryResult.inventory.standaloneConversations,
      projectConversationIds: inventoryResult.inventory.projectConversationIds,
      protectedConversationIds: protectedIdsResult.protectedConversationIds,
    }),
  };
}
