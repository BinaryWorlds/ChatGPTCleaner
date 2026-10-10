export const AppConfig = {
  inventory: {
    maxPages: 1_000,
    maxRecords: 100_000,
    projectConversationPageSize: 50,
    standaloneReadConcurrency: 3,
  },
  readRetry: {
    maxAttempts: 4,
    retryBaseDelayMs: 1_000,
    retryMaxDelayMs: 30_000,
  },
  deletion: {
    requestsPerMinute: {
      default: 60,
      min: 1,
      max: 120,
    },
    maximumConcurrentDeleteRequests: {
      default: 1,
      min: 1,
      max: 20,
    },
    maxAttemptsPerConversation: 5,
    retryDeleteTimeouts: true,
    retryBaseDelayMs: 1_000,
    retryMaxDelayMs: 60_000,
    slowResponseThresholdMs: 3_000,
  },
  api: {
    maxRetryAfterMs: 5 * 60_000,
  },
} as const;
