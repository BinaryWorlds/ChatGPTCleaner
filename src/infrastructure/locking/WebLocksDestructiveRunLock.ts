import type {
  DestructiveRunLock,
  LockResult,
} from "../../application/ports/DestructiveRunLock";
import { logger } from "../observability/logger";

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
    logger.debug("runLock.acquire.started");
    if (this.locks === null) {
      logger.warn("runLock.acquire.unavailable");
      return Promise.resolve({ kind: "unavailable" });
    }

    return this.locks.request(
      DESTRUCTIVE_RUN_LOCK_NAME,
      { ifAvailable: true, mode: "exclusive" },
      async (lock) => {
        if (lock === null) {
          logger.warn("runLock.acquire.unavailable");
          return { kind: "unavailable" };
        }
        logger.debug("runLock.acquire.succeeded");
        try {
          return { kind: "acquired", value: await work() };
        } finally {
          logger.debug("runLock.released");
        }
      },
    );
  }
}

export function currentWebLockManager(): WebLockManager | null {
  return "locks" in navigator ? navigator.locks : null;
}
