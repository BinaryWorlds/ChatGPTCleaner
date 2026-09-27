import { createAppError } from "./AppError";
import type { DestructiveRunLock } from "./ports/DestructiveRunLock";
import type { ProtectedConversationStore } from "./ports/ProtectedConversationStore";

export type ProtectionMutation =
  | { readonly kind: "protect"; readonly conversationIds: ReadonlySet<string> }
  | {
      readonly kind: "unprotect";
      readonly conversationIds: ReadonlySet<string>;
    };

export interface ProtectionMutationLockOwner {
  runProtectionMutation<T>(work: () => Promise<T>): Promise<T>;
}

export type ProtectionMutationResult =
  | {
      readonly kind: "saved";
      readonly protectedConversationIds: ReadonlySet<string>;
    }
  | { readonly kind: "locked" };

async function applyCanonicalProtectionMutation(input: {
  readonly mutation: ProtectionMutation;
  readonly protectedConversationStore: ProtectedConversationStore;
}): Promise<ReadonlySet<string>> {
  const current =
    await input.protectedConversationStore.loadProtectedConversationIds();
  if (current.kind === "invalid") {
    throw createAppError("StorageFailure", {
      operation: "protectedStore.mutate",
    });
  }

  const nextProtectedIds = new Set(current.protectedConversationIds);
  if (input.mutation.kind === "protect") {
    for (const conversationId of input.mutation.conversationIds) {
      nextProtectedIds.add(conversationId);
    }
  } else {
    for (const conversationId of input.mutation.conversationIds) {
      nextProtectedIds.delete(conversationId);
    }
  }
  await input.protectedConversationStore.saveProtectedConversationIds(
    nextProtectedIds,
  );
  return nextProtectedIds;
}

export async function mutateProtectedConversationIds(input: {
  readonly mutation: ProtectionMutation;
  readonly protectedConversationStore: ProtectedConversationStore;
  readonly destructiveRunLock: DestructiveRunLock;
  readonly currentRunLockOwner: ProtectionMutationLockOwner | null;
}): Promise<ProtectionMutationResult> {
  const mutate = () => applyCanonicalProtectionMutation(input);

  if (input.currentRunLockOwner !== null) {
    return {
      kind: "saved",
      protectedConversationIds:
        await input.currentRunLockOwner.runProtectionMutation(mutate),
    };
  }

  const result = await input.destructiveRunLock.runExclusive(mutate);
  return result.kind === "acquired"
    ? { kind: "saved", protectedConversationIds: result.value }
    : { kind: "locked" };
}
