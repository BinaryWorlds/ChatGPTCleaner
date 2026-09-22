import type { Conversation } from "./conversation";

const deletionPlanBrand: unique symbol = Symbol("DeletionPlan");
const confirmedDeletionPlanBrand: unique symbol = Symbol(
  "ConfirmedDeletionPlan",
);
const MAX_CONVERSATION_ID_LENGTH = 512;

export interface DeletionPlan {
  readonly [deletionPlanBrand]: true;
  readonly originallySelectedCount: number;
  readonly eligibleConversationIds: readonly string[];
  readonly excludedProjectIds: readonly string[];
  readonly excludedProtectedIds: readonly string[];
  readonly missingConversationIds: readonly string[];
  readonly invalidSelectionCount: number;
}

export interface ConfirmedDeletionPlan {
  readonly [confirmedDeletionPlanBrand]: true;
  readonly confirmedConversationIds: readonly string[];
}

export type ConfirmationResult =
  | { readonly kind: "confirmed"; readonly plan: ConfirmedDeletionPlan }
  | { readonly kind: "rejected"; readonly expectedText: string };

function isConversationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CONVERSATION_ID_LENGTH
  );
}

export function buildDeletionPlan(input: {
  readonly selectedConversationIds: readonly unknown[];
  readonly standaloneConversations: readonly Conversation[];
  readonly projectConversationIds: ReadonlySet<string>;
  readonly protectedConversationIds: ReadonlySet<string>;
}): DeletionPlan {
  const standaloneIds = new Set(
    input.standaloneConversations.map((conversation) => conversation.id),
  );
  const uniqueValidIds = new Set<string>();
  let invalidSelectionCount = 0;

  for (const selectedId of input.selectedConversationIds) {
    if (!isConversationId(selectedId)) {
      invalidSelectionCount += 1;
      continue;
    }
    uniqueValidIds.add(selectedId);
  }

  const eligibleConversationIds: string[] = [];
  const excludedProjectIds: string[] = [];
  const excludedProtectedIds: string[] = [];
  const missingConversationIds: string[] = [];

  for (const selectedId of uniqueValidIds) {
    if (input.projectConversationIds.has(selectedId)) {
      excludedProjectIds.push(selectedId);
      continue;
    }
    if (input.protectedConversationIds.has(selectedId)) {
      excludedProtectedIds.push(selectedId);
      continue;
    }
    if (!standaloneIds.has(selectedId)) {
      missingConversationIds.push(selectedId);
      continue;
    }
    eligibleConversationIds.push(selectedId);
  }

  return {
    [deletionPlanBrand]: true,
    originallySelectedCount: input.selectedConversationIds.length,
    eligibleConversationIds,
    excludedProjectIds,
    excludedProtectedIds,
    missingConversationIds,
    invalidSelectionCount,
  };
}

export function confirmDeletionPlan(
  plan: DeletionPlan,
  confirmationText: string,
): ConfirmationResult {
  const expectedText = `DELETE ${plan.eligibleConversationIds.length}`;
  if (
    plan.eligibleConversationIds.length === 0 ||
    confirmationText !== expectedText
  ) {
    return { kind: "rejected", expectedText };
  }

  return {
    kind: "confirmed",
    plan: {
      [confirmedDeletionPlanBrand]: true,
      confirmedConversationIds: [...plan.eligibleConversationIds],
    },
  };
}

export function shrinkConfirmedDeletionPlan(
  confirmedPlan: ConfirmedDeletionPlan,
  revalidatedPlan: DeletionPlan,
): ConfirmedDeletionPlan {
  const revalidatedIds = new Set(revalidatedPlan.eligibleConversationIds);

  return {
    [confirmedDeletionPlanBrand]: true,
    confirmedConversationIds: confirmedPlan.confirmedConversationIds.filter(
      (conversationId) => revalidatedIds.has(conversationId),
    ),
  };
}
