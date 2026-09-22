import type { DestructiveRunLock } from "./ports/DestructiveRunLock";
import type { ProtectedConversationStore } from "./ports/ProtectedConversationStore";

export async function saveProtectedConversationIds(input: {
  readonly protectedConversationIds: ReadonlySet<string>;
  readonly protectedConversationStore: ProtectedConversationStore;
  readonly destructiveRunLock: DestructiveRunLock;
  readonly currentRunOwnsLock: boolean;
}): Promise<"saved" | "locked"> {
  const save = () =>
    input.protectedConversationStore.saveProtectedConversationIds(
      input.protectedConversationIds,
    );

  if (input.currentRunOwnsLock) {
    await save();
    return "saved";
  }

  const result = await input.destructiveRunLock.runExclusive(save);
  return result.kind === "acquired" ? "saved" : "locked";
}
