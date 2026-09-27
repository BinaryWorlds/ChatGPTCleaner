import { describe, expect, it, vi } from "vitest";
import { loadRequestsPerMinute } from "../../application/settings";
import {
  BrowserProtectedConversationStore,
  BrowserSettingsStore,
  BrowserThemePreferenceStore,
  TrustedStorageAccess,
  type BrowserLocalStorage,
} from "./BrowserStores";

function storageWith(initial: Record<string, unknown>) {
  const values = { ...initial };
  return {
    values,
    get: vi.fn((key: string) => Promise.resolve({ [key]: values[key] })),
    set: vi.fn((items: Record<string, unknown>) => {
      Object.assign(values, items);
      return Promise.resolve();
    }),
    setAccessLevel: vi.fn().mockResolvedValue(undefined),
  };
}

describe("browser-backed stores", () => {
  it("loads, deduplicates, and persists valid protected IDs", async () => {
    const storage = storageWith({
      protectedConversationIds: ["one", "two", "one"],
    });
    const store = new BrowserProtectedConversationStore(
      storage,
      new TrustedStorageAccess(storage),
    );

    const result = await store.loadProtectedConversationIds();
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect([...result.protectedConversationIds]).toEqual(["one", "two"]);
    }
    await store.saveProtectedConversationIds(new Set(["three"]));
    expect(storage.values.protectedConversationIds).toEqual(["three"]);
    expect(storage.setAccessLevel.mock.calls).toHaveLength(1);
    expect(storage.setAccessLevel.mock.calls[0]).toEqual([
      {
        accessLevel: "TRUSTED_CONTEXTS",
      },
    ]);
  });

  it("treats missing protection data as empty and malformed data as invalid", async () => {
    const missingStorage = storageWith({});
    const missingStore = new BrowserProtectedConversationStore(
      missingStorage,
      new TrustedStorageAccess(missingStorage),
    );
    await expect(missingStore.loadProtectedConversationIds()).resolves.toEqual({
      kind: "success",
      protectedConversationIds: new Set(),
    });

    for (const malformed of ["one", [42], [""], ["x".repeat(513)]]) {
      const storage = storageWith({ protectedConversationIds: malformed });
      const store = new BrowserProtectedConversationStore(
        storage,
        new TrustedStorageAccess(storage),
      );
      await expect(store.loadProtectedConversationIds()).resolves.toEqual({
        kind: "invalid",
      });
    }
  });

  it("normalizes malformed rate settings to 60 and persists the result", async () => {
    const storage = storageWith({ requestsPerMinute: "fast" });
    const store = new BrowserSettingsStore(
      storage,
      new TrustedStorageAccess(storage),
    );
    await expect(loadRequestsPerMinute(store)).resolves.toBe(60);
    expect(storage.values.requestsPerMinute).toBe(60);
  });

  it("continues when access restriction is unavailable", async () => {
    const values: Record<string, unknown> = { requestsPerMinute: 30 };
    const storage: BrowserLocalStorage = {
      get: (key) => Promise.resolve({ [key]: values[key] }),
      set: (items) => {
        Object.assign(values, items);
        return Promise.resolve();
      },
    };
    const store = new BrowserSettingsStore(
      storage,
      new TrustedStorageAccess(storage),
    );
    await expect(store.loadRequestsPerMinute()).resolves.toBe(30);
  });

  it("persists only the theme preference value", async () => {
    const storage = storageWith({ themePreference: "dark" });
    const store = new BrowserThemePreferenceStore(
      storage,
      new TrustedStorageAccess(storage),
    );

    await expect(store.loadThemePreference()).resolves.toBe("dark");
    await store.saveThemePreference("light");

    expect(storage.values).toEqual({ themePreference: "light" });
  });
});
