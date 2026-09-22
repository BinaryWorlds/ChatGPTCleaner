import type {
  DestructiveRunLock,
  LockResult,
} from "../../application/ports/DestructiveRunLock";

export const DESTRUCTIVE_RUN_LOCK_NAME = "chatgpt-cleaner:destructive-run:v1";

export interface WebLockManager {
  request<T>(
    name: string,
    options: { readonly ifAvailable: true; readonly mode: "exclusive" },
    callback: (lock: object | null) => Promise<T>,
  ): Promise<T>;
}

export class WebLocksDestructiveRunLock implements DestructiveRunLock {
  public constructor(private readonly locks: WebLockManager | null) {}

  public runExclusive<T>(work: () => Promise<T>): Promise<LockResult<T>> {
    if (this.locks === null) {
      return Promise.resolve({ kind: "unavailable" });
    }

    return this.locks.request(
      DESTRUCTIVE_RUN_LOCK_NAME,
      { ifAvailable: true, mode: "exclusive" },
      async (lock) => {
        if (lock === null) return { kind: "unavailable" };
        return { kind: "acquired", value: await work() };
      },
    );
  }
}

export function currentWebLockManager(): WebLockManager | null {
  return "locks" in navigator ? navigator.locks : null;
}
