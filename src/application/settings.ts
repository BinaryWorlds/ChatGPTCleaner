import type { SettingsStore } from "./ports/SettingsStore";
import { AppConfig } from "../config";

export function isValidRequestsPerMinute(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= AppConfig.deletion.requestsPerMinute.min &&
    value <= AppConfig.deletion.requestsPerMinute.max
  );
}

export async function loadRequestsPerMinute(
  settingsStore: SettingsStore,
): Promise<number> {
  const storedValue = await settingsStore.loadRequestsPerMinute();
  if (isValidRequestsPerMinute(storedValue)) return storedValue;

  await settingsStore.saveRequestsPerMinute(
    AppConfig.deletion.requestsPerMinute.default,
  );
  return AppConfig.deletion.requestsPerMinute.default;
}

export async function saveRequestsPerMinute(
  settingsStore: SettingsStore,
  requestsPerMinute: number,
): Promise<boolean> {
  if (!isValidRequestsPerMinute(requestsPerMinute)) return false;

  await settingsStore.saveRequestsPerMinute(requestsPerMinute);
  return true;
}

export class SerializedRequestsPerMinuteWriter {
  private pendingWrite: Promise<void> = Promise.resolve();

  public constructor(private readonly settingsStore: SettingsStore) {}

  public save(requestsPerMinute: number): Promise<boolean> {
    const write = this.pendingWrite.then(() =>
      saveRequestsPerMinute(this.settingsStore, requestsPerMinute),
    );
    this.pendingWrite = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }
}
