export interface SettingsStore {
  loadRequestsPerMinute(): Promise<unknown>;
  saveRequestsPerMinute(requestsPerMinute: number): Promise<void>;
}
