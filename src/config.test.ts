import { describe, expect, it } from "vitest";
import { AppConfig } from "./config";

describe("application configuration", () => {
  it("retains the established product policy values", () => {
    expect(AppConfig).toEqual({
      inventory: {
        maxPages: 1_000,
        maxRecords: 100_000,
        standaloneReadConcurrency: 3,
      },
      readRetry: {
        maxAttempts: 4,
        retryBaseDelayMs: 1_000,
        retryMaxDelayMs: 30_000,
      },
      deletion: {
        requestsPerMinute: { default: 60, min: 1, max: 120 },
        maximumConcurrentDeleteRequests: { default: 1, min: 1, max: 20 },
        maxAttemptsPerConversation: 5,
        retryDeleteTimeouts: true,
        retryBaseDelayMs: 1_000,
        retryMaxDelayMs: 60_000,
        slowResponseThresholdMs: 3_000,
      },
      api: { maxRetryAfterMs: 5 * 60_000 },
    });
  });
});
