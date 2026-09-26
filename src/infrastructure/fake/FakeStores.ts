import type {
  ProtectedConversationIdsResult,
  ProtectedConversationStore,
} from "../../application/ports/ProtectedConversationStore";
import { AppConfig } from "../../config";
import { isSafetyCriticalIdentifier } from "../../domain/identifier";
import type { SettingsStore } from "../../application/ports/SettingsStore";

function parseProtectedIds(value: unknown): ReadonlySet<string> | null {
  if (!Array.isArray(value)) return null;
  const protectedIds = new Set<string>();

  for (const item of value) {
    if (!isSafetyCriticalIdentifier(item)) {
      return null;
    }
    protectedIds.add(item);
  }
  return protectedIds;
}

export class FakeProtectedConversationStore implements ProtectedConversationStore {
  public loadCount = 0;

  public constructor(private storedValue: unknown = []) {}

  public loadProtectedConversationIds(): Promise<ProtectedConversationIdsResult> {
    this.loadCount += 1;
    const protectedConversationIds = parseProtectedIds(this.storedValue);
    return Promise.resolve(
      protectedConversationIds === null
        ? { kind: "invalid" }
        : { kind: "success", protectedConversationIds },
    );
  }

  public saveProtectedConversationIds(
    protectedConversationIds: ReadonlySet<string>,
  ): Promise<void> {
    this.storedValue = [...protectedConversationIds];
    return Promise.resolve();
  }
}

export class FakeSettingsStore implements SettingsStore {
  public savedValues: number[] = [];

  public constructor(
    private storedValue: unknown = AppConfig.deletion.requestsPerMinute.default,
  ) {}

  public loadRequestsPerMinute(): Promise<unknown> {
    return Promise.resolve(this.storedValue);
  }

  public saveRequestsPerMinute(requestsPerMinute: number): Promise<void> {
    this.storedValue = requestsPerMinute;
    this.savedValues.push(requestsPerMinute);
    return Promise.resolve();
  }
}
