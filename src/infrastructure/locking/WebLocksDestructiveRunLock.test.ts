import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentWebLockManager,
  WebLocksDestructiveRunLock,
  type WebLockManager,
} from "./WebLocksDestructiveRunLock";

class ContendedLockManager implements WebLockManager {
  public readonly calls: Array<{
    readonly name: string;
    readonly options: {
      readonly ifAvailable: true;
      readonly mode: "exclusive";
    };
  }> = [];
  private held = false;

  public async request<T>(
    name: string,
    options: { readonly ifAvailable: true; readonly mode: "exclusive" },
    callback: (lock: object | null) => Promise<T>,
  ): Promise<T> {
    this.calls.push({ name, options });
    if (this.held) return callback(null);
    this.held = true;
    try {
      return await callback({});
    } finally {
      this.held = false;
    }
  }
}

describe("WebLocksDestructiveRunLock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects when Web Locks are unavailable", () => {
    vi.stubGlobal("navigator", {});

    expect(currentWebLockManager()).toBeNull();
  });

  it("returns the available Web Locks manager", () => {
    const fakeManager = { request: vi.fn() };
    vi.stubGlobal("navigator", { locks: fakeManager });

    expect(currentWebLockManager()).toBe(fakeManager);
  });

  it("acquires the stable exclusive lock and retains it until work settles", async () => {
    let releaseWork: (() => void) | undefined;
    const work = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseWork = () => resolve("done");
        }),
    );
    const locks = new ContendedLockManager();
    const lock = new WebLocksDestructiveRunLock(locks);

    const first = lock.runExclusive(work);
    await Promise.resolve();
    await expect(
      lock.runExclusive(() => Promise.resolve("second")),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(locks.calls).toEqual([
      {
        name: "chatgpt-cleaner:destructive-run:v1",
        options: { ifAvailable: true, mode: "exclusive" },
      },
      {
        name: "chatgpt-cleaner:destructive-run:v1",
        options: { ifAvailable: true, mode: "exclusive" },
      },
    ]);
    releaseWork?.();
    await expect(first).resolves.toEqual({ kind: "acquired", value: "done" });
  });

  it("fails closed when Web Locks are unavailable", async () => {
    const work = vi.fn(() => Promise.resolve("unsafe"));
    await expect(
      new WebLocksDestructiveRunLock(null).runExclusive(work),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(work).not.toHaveBeenCalled();
  });
});
