import { describe, expect, it, vi } from "vitest";
import { FakeDestructiveRunLock } from "infrastructure/fake/FakeDestructiveRunLock";
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
      mutation: {
        kind: "protect",
        conversationIds: new Set(["newly-protected"]),
      },
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

  it("protects many IDs with one canonical read and save", async () => {
    const store = new MutableProtectedConversationStore(
      new Set(["protected-by-other-manager"]),
    );
    const load = vi.spyOn(store, "loadProtectedConversationIds");
    const save = vi.spyOn(store, "saveProtectedConversationIds");

    const result = await mutateProtectedConversationIds({
      mutation: {
        kind: "protect",
        conversationIds: new Set(["alpha", "beta"]),
      },
      protectedConversationStore: store,
      destructiveRunLock: new FakeDestructiveRunLock(),
      currentRunLockOwner: null,
    });

    expect(result).toMatchObject({ kind: "saved" });
    expect(store.ids()).toEqual([
      "alpha",
      "beta",
      "protected-by-other-manager",
    ]);
    expect(load).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
  });

  it("unprotects one ID without overwriting unrelated canonical changes", async () => {
    const staleManagerSnapshot = new Set(["old", "remove"]);
    const store = new MutableProtectedConversationStore(staleManagerSnapshot);
    store.replaceCanonicalIds(new Set(["added-by-other-manager", "remove"]));

    const result = await mutateProtectedConversationIds({
      mutation: {
        kind: "unprotect",
        conversationIds: new Set(["remove"]),
      },
      protectedConversationStore: store,
      destructiveRunLock: new FakeDestructiveRunLock(),
      currentRunLockOwner: null,
    });

    expect(result).toMatchObject({ kind: "saved" });
    expect(store.ids()).toEqual(["added-by-other-manager"]);
  });

  it("bulk unprotect can only remove IDs from the requested set", async () => {
    const store = new MutableProtectedConversationStore(
      new Set(["requested", "no-longer-requested"]),
    );
    store.replaceCanonicalIds(
      new Set(["requested", "newly-protected-by-other-manager"]),
    );
    const load = vi.spyOn(store, "loadProtectedConversationIds");
    const save = vi.spyOn(store, "saveProtectedConversationIds");

    await mutateProtectedConversationIds({
      mutation: {
        kind: "unprotect",
        conversationIds: new Set(["requested", "no-longer-requested"]),
      },
      protectedConversationStore: store,
      destructiveRunLock: new FakeDestructiveRunLock(),
      currentRunLockOwner: null,
    });

    expect(store.ids()).toEqual(["newly-protected-by-other-manager"]);
    expect(load).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
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
        mutation: {
          kind: "protect",
          conversationIds: new Set(["conversation"]),
        },
        protectedConversationStore: store,
        destructiveRunLock: new FakeDestructiveRunLock(),
        currentRunLockOwner: null,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
    expect(saveCalled).toBe(false);
  });

  it("does not access protected storage when the destructive lock is unavailable", async () => {
    const store = new MutableProtectedConversationStore(new Set());
    const load = vi.spyOn(store, "loadProtectedConversationIds");
    const save = vi.spyOn(store, "saveProtectedConversationIds");

    const result = await mutateProtectedConversationIds({
      mutation: {
        kind: "protect",
        conversationIds: new Set(["conversation"]),
      },
      protectedConversationStore: store,
      destructiveRunLock: new FakeDestructiveRunLock({ active: true }),
      currentRunLockOwner: null,
    });

    expect(result).toEqual({ kind: "locked" });
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
