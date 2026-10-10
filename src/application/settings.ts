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

export function isValidMaximumConcurrentDeleteRequests(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= AppConfig.deletion.maximumConcurrentDeleteRequests.min &&
    value <= AppConfig.deletion.maximumConcurrentDeleteRequests.max
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

export async function loadMaximumConcurrentDeleteRequests(
  settingsStore: SettingsStore,
): Promise<number> {
  const storedValue = await settingsStore.loadMaximumConcurrentDeleteRequests();
  if (isValidMaximumConcurrentDeleteRequests(storedValue)) return storedValue;

  const defaultValue =
    AppConfig.deletion.maximumConcurrentDeleteRequests.default;
  await settingsStore.saveMaximumConcurrentDeleteRequests(defaultValue);
  return defaultValue;
}

export async function saveMaximumConcurrentDeleteRequests(
  settingsStore: SettingsStore,
  maximumConcurrentDeleteRequests: number,
): Promise<boolean> {
  if (
    !isValidMaximumConcurrentDeleteRequests(maximumConcurrentDeleteRequests)
  ) {
    return false;
  }

  await settingsStore.saveMaximumConcurrentDeleteRequests(
    maximumConcurrentDeleteRequests,
  );
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

export class SerializedMaximumConcurrentDeleteRequestsWriter {
  private pendingWrite: Promise<void> = Promise.resolve();

  public constructor(private readonly settingsStore: SettingsStore) {}

  public save(maximumConcurrentDeleteRequests: number): Promise<boolean> {
    const write = this.pendingWrite.then(() =>
      saveMaximumConcurrentDeleteRequests(
        this.settingsStore,
        maximumConcurrentDeleteRequests,
      ),
    );
    this.pendingWrite = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }
}
