import type { SettingsStore } from "./ports/SettingsStore";

export const DEFAULT_REQUESTS_PER_MINUTE = 60;
export const MIN_REQUESTS_PER_MINUTE = 1;
export const MAX_REQUESTS_PER_MINUTE = 120;

export function isValidRequestsPerMinute(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_REQUESTS_PER_MINUTE &&
    value <= MAX_REQUESTS_PER_MINUTE
  );
}

export async function loadRequestsPerMinute(
  settingsStore: SettingsStore,
): Promise<number> {
  const storedValue = await settingsStore.loadRequestsPerMinute();
  if (isValidRequestsPerMinute(storedValue)) return storedValue;

  await settingsStore.saveRequestsPerMinute(DEFAULT_REQUESTS_PER_MINUTE);
  return DEFAULT_REQUESTS_PER_MINUTE;
}

export async function saveRequestsPerMinute(
  settingsStore: SettingsStore,
  requestsPerMinute: number,
): Promise<boolean> {
  if (!isValidRequestsPerMinute(requestsPerMinute)) return false;

  await settingsStore.saveRequestsPerMinute(requestsPerMinute);
  return true;
}
