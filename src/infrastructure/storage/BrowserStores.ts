import { z } from "zod";
import type {
  ProtectedConversationIdsResult,
  ProtectedConversationStore,
} from "../../application/ports/ProtectedConversationStore";
import type { SettingsStore } from "../../application/ports/SettingsStore";
import { createAppError } from "../../application/AppError";
import { logger, summarizeUnknownError } from "../observability/logger";

const PROTECTED_IDS_KEY = "protectedConversationIds";
const REQUESTS_PER_MINUTE_KEY = "requestsPerMinute";

const protectedIdsSchema = z.array(z.string().min(1).max(512));

export interface BrowserLocalStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  setAccessLevel?(details: {
    readonly accessLevel: "TRUSTED_CONTEXTS";
  }): Promise<void>;
}

export class TrustedStorageAccess {
  private accessPromise: Promise<void> | null = null;

  public constructor(private readonly storage: BrowserLocalStorage) {}

  public ensureRestricted(): Promise<void> {
    this.accessPromise ??=
      this.storage.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }) ??
      Promise.resolve();
    return this.accessPromise;
  }
}

export class BrowserProtectedConversationStore implements ProtectedConversationStore {
  public constructor(
    private readonly storage: BrowserLocalStorage,
    private readonly trustedAccess: TrustedStorageAccess,
  ) {}

  public async loadProtectedConversationIds(): Promise<ProtectedConversationIdsResult> {
    logger.debug("protectedStore.load.started");
    try {
      await this.trustedAccess.ensureRestricted();
      const stored = await this.storage.get(PROTECTED_IDS_KEY);
      const value = stored[PROTECTED_IDS_KEY] ?? [];
      const parsed = protectedIdsSchema.safeParse(value);
      if (!parsed.success) {
        logger.warn("protectedStore.load.invalid", {
          issueCount: parsed.error.issues.length,
        });
        return { kind: "invalid" };
      }
      logger.debug("protectedStore.load.succeeded", {
        protectedCount: parsed.data.length,
      });
      return {
        kind: "success",
        protectedConversationIds: new Set(parsed.data),
      };
    } catch (cause) {
      logger.error(
        "application.operation.failed",
        summarizeUnknownError(cause),
        {
          operation: "protectedStore.load",
          errorCode: "STORAGE_FAILURE",
        },
      );
      throw createAppError("StorageFailure", {
        operation: "protectedStore.load",
        cause,
      });
    }
  }

  public async saveProtectedConversationIds(
    protectedConversationIds: ReadonlySet<string>,
  ): Promise<void> {
    try {
      await this.trustedAccess.ensureRestricted();
      const parsed = protectedIdsSchema.safeParse([
        ...protectedConversationIds,
      ]);
      if (!parsed.success) {
        throw new TypeError("Protected conversation IDs are invalid.");
      }
      await this.storage.set({ [PROTECTED_IDS_KEY]: parsed.data });
      logger.debug("protectedStore.save.succeeded", {
        protectedCount: parsed.data.length,
      });
    } catch (cause) {
      logger.error(
        "application.operation.failed",
        summarizeUnknownError(cause),
        {
          operation: "protectedStore.save",
          errorCode: "STORAGE_FAILURE",
        },
      );
      throw createAppError("StorageFailure", {
        operation: "protectedStore.save",
        cause,
      });
    }
  }
}

export class BrowserSettingsStore implements SettingsStore {
  public constructor(
    private readonly storage: BrowserLocalStorage,
    private readonly trustedAccess: TrustedStorageAccess,
  ) {}

  public async loadRequestsPerMinute(): Promise<unknown> {
    try {
      await this.trustedAccess.ensureRestricted();
      const stored = await this.storage.get(REQUESTS_PER_MINUTE_KEY);
      logger.debug("settingsStore.load.succeeded");
      return stored[REQUESTS_PER_MINUTE_KEY];
    } catch (cause) {
      throw createAppError("StorageFailure", {
        operation: "settingsStore.load",
        cause,
      });
    }
  }

  public async saveRequestsPerMinute(requestsPerMinute: number): Promise<void> {
    try {
      await this.trustedAccess.ensureRestricted();
      await this.storage.set({ [REQUESTS_PER_MINUTE_KEY]: requestsPerMinute });
      logger.debug("settingsStore.save.succeeded");
    } catch (cause) {
      throw createAppError("StorageFailure", {
        operation: "settingsStore.save",
        cause,
      });
    }
  }
}

export function createChromeLocalStorage(): BrowserLocalStorage {
  return {
    get: (key) => browser.storage.local.get(key),
    set: (items) => browser.storage.local.set(items),
    setAccessLevel: (details) => browser.storage.local.setAccessLevel(details),
  };
}
