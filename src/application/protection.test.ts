import { describe, expect, it } from "vitest";
import { FakeDestructiveRunLock } from "../infrastructure/fake/FakeDestructiveRunLock";
import type {
  ProtectedConversationIdsResult,
  ProtectedConversationStore,
} from "./ports/ProtectedConversationStore";
import { mutateProtectedConversationIds } from "./protection";

class MutableProtectedConversationStore implements ProtectedConversationStore {
  public constructor(private protectedIds: ReadonlySet<string>) {}

  public replaceCanonicalIds(protectedIds: ReadonlySet<string>): void {
    this.protectedIds = new Set(protectedIds);
  }

  public loadProtectedConversationIds(): Promise<ProtectedConversationIdsResult> {
    return Promise.resolve({
      kind: "success",
      protectedConversationIds: new Set(this.protectedIds),
    });
  }

  public saveProtectedConversationIds(
    protectedConversationIds: ReadonlySet<string>,
  ): Promise<void> {
    this.protectedIds = new Set(protectedConversationIds);
    return Promise.resolve();
  }

  public ids(): readonly string[] {
    return [...this.protectedIds].sort();
  }
}

describe("protected conversation mutations", () => {
  it("protects against the current canonical set instead of a stale manager snapshot", async () => {
    const staleManagerSnapshot = new Set<string>();
    const store = new MutableProtectedConversationStore(staleManagerSnapshot);
    store.replaceCanonicalIds(new Set(["protected-by-other-manager"]));

    const result = await mutateProtectedConversationIds({
      mutation: { kind: "protect", conversationId: "newly-protected" },
      protectedConversationStore: store,
      destructiveRunLock: new FakeDestructiveRunLock(),
      currentRunLockOwner: null,
    });

    expect(result).toMatchObject({ kind: "saved" });
    expect(store.ids()).toEqual([
      "newly-protected",
      "protected-by-other-manager",
    ]);
  });

  it("unprotects one ID without overwriting unrelated canonical changes", async () => {
    const staleManagerSnapshot = new Set(["old", "remove"]);
    const store = new MutableProtectedConversationStore(staleManagerSnapshot);
    store.replaceCanonicalIds(new Set(["added-by-other-manager", "remove"]));

    const result = await mutateProtectedConversationIds({
      mutation: { kind: "unprotect", conversationId: "remove" },
      protectedConversationStore: store,
      destructiveRunLock: new FakeDestructiveRunLock(),
      currentRunLockOwner: null,
    });

    expect(result).toMatchObject({ kind: "saved" });
    expect(store.ids()).toEqual(["added-by-other-manager"]);
  });

  it("fails closed without saving when canonical protection storage is invalid", async () => {
    let saveCalled = false;
    const store: ProtectedConversationStore = {
      loadProtectedConversationIds: () => Promise.resolve({ kind: "invalid" }),
      saveProtectedConversationIds: () => {
        saveCalled = true;
        return Promise.resolve();
      },
    };

    await expect(
      mutateProtectedConversationIds({
        mutation: { kind: "protect", conversationId: "conversation" },
        protectedConversationStore: store,
        destructiveRunLock: new FakeDestructiveRunLock(),
        currentRunLockOwner: null,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
    expect(saveCalled).toBe(false);
  });
});
