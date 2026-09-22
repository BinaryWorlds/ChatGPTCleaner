import type {
  ProtectedConversationIdsResult,
  ProtectedConversationStore,
} from "../../application/ports/ProtectedConversationStore";
import type { SettingsStore } from "../../application/ports/SettingsStore";

const MAX_CONVERSATION_ID_LENGTH = 512;

function parseProtectedIds(value: unknown): ReadonlySet<string> | null {
  if (!Array.isArray(value)) return null;
  const protectedIds = new Set<string>();

  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.length === 0 ||
      item.length > MAX_CONVERSATION_ID_LENGTH
    ) {
      return null;
    }
    protectedIds.add(item);
  }
  return protectedIds;
}

export class FakeProtectedConversationStore implements ProtectedConversationStore {
  public constructor(private storedValue: unknown = []) {}

  public loadProtectedConversationIds(): Promise<ProtectedConversationIdsResult> {
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

  public constructor(private storedValue: unknown = 60) {}

  public loadRequestsPerMinute(): Promise<unknown> {
    return Promise.resolve(this.storedValue);
  }

  public saveRequestsPerMinute(requestsPerMinute: number): Promise<void> {
    this.storedValue = requestsPerMinute;
    this.savedValues.push(requestsPerMinute);
    return Promise.resolve();
  }
}
