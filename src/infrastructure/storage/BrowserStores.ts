import { z } from "zod";
import type {
  ProtectedConversationIdsResult,
  ProtectedConversationStore,
} from "../../application/ports/ProtectedConversationStore";
import type { SettingsStore } from "../../application/ports/SettingsStore";

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
    await this.trustedAccess.ensureRestricted();
    const stored = await this.storage.get(PROTECTED_IDS_KEY);
    const value = stored[PROTECTED_IDS_KEY] ?? [];
    const parsed = protectedIdsSchema.safeParse(value);
    if (!parsed.success) return { kind: "invalid" };
    return {
      kind: "success",
      protectedConversationIds: new Set(parsed.data),
    };
  }

  public async saveProtectedConversationIds(
    protectedConversationIds: ReadonlySet<string>,
  ): Promise<void> {
    await this.trustedAccess.ensureRestricted();
    const parsed = protectedIdsSchema.safeParse([...protectedConversationIds]);
    if (!parsed.success) {
      throw new TypeError("Protected conversation IDs are invalid.");
    }
    await this.storage.set({ [PROTECTED_IDS_KEY]: parsed.data });
  }
}

export class BrowserSettingsStore implements SettingsStore {
  public constructor(
    private readonly storage: BrowserLocalStorage,
    private readonly trustedAccess: TrustedStorageAccess,
  ) {}

  public async loadRequestsPerMinute(): Promise<unknown> {
    await this.trustedAccess.ensureRestricted();
    const stored = await this.storage.get(REQUESTS_PER_MINUTE_KEY);
    return stored[REQUESTS_PER_MINUTE_KEY];
  }

  public async saveRequestsPerMinute(requestsPerMinute: number): Promise<void> {
    await this.trustedAccess.ensureRestricted();
    await this.storage.set({ [REQUESTS_PER_MINUTE_KEY]: requestsPerMinute });
  }
}

export function createChromeLocalStorage(): BrowserLocalStorage {
  return {
    get: (key) => browser.storage.local.get(key),
    set: (items) => browser.storage.local.set(items),
    setAccessLevel: (details) => browser.storage.local.setAccessLevel(details),
  };
}
