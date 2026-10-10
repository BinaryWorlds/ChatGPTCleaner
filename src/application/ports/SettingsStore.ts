export interface SettingsStore {
  loadRequestsPerMinute(): Promise<unknown>;
  saveRequestsPerMinute(requestsPerMinute: number): Promise<void>;
  loadMaximumConcurrentDeleteRequests(): Promise<unknown>;
  saveMaximumConcurrentDeleteRequests(
    maximumConcurrentDeleteRequests: number,
  ): Promise<void>;
}
