import type {
  ProtectedConversationIdsResult,
  ProtectedConversationStore,
} from "../../application/ports/ProtectedConversationStore";
import { AppConfig } from "../../config";
import type { SettingsStore } from "../../application/ports/SettingsStore";

export class FakeProtectedConversationStore implements ProtectedConversationStore {
  public loadCount = 0;

  public constructor(private storedValue: readonly string[] | "invalid" = []) {}

  public loadProtectedConversationIds(): Promise<ProtectedConversationIdsResult> {
    this.loadCount += 1;
    if (this.storedValue === "invalid") {
      return Promise.resolve({ kind: "invalid" });
    }
    return Promise.resolve({
      kind: "success",
      protectedConversationIds: new Set(this.storedValue),
    });
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
