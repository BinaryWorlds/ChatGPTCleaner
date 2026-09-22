export interface FakeGatewayFixture {
  readonly standalonePages: Readonly<Record<string, unknown>>;
  readonly projects: unknown;
  readonly projectConversationPages: Readonly<Record<string, unknown>>;
  readonly deleteOutcomes?: Readonly<
    Record<string, readonly FakeDeleteOutcome[]>
  >;
  readonly latencyMs?: number;
}

export type FakeDeleteOutcome =
  "success" | 404 | 410 | 429 | 500 | 403 | "network";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 8, 21);

const standaloneRecords = Array.from({ length: 64 }, (_, index) => ({
  id: `standalone-${String(index + 1).padStart(3, "0")}`,
  title: index === 4 ? null : `Conversation ${index + 1}`,
  createdAt: index === 7 ? null : NOW - (index + 1) * DAY_MS,
  updatedAt: index === 9 ? null : NOW - index * DAY_MS,
}));

export const DEMO_FIXTURE: FakeGatewayFixture = {
  standalonePages: {
    first: {
      conversations: [
        ...standaloneRecords.slice(0, 25),
        standaloneRecords[0],
        {
          id: "project-overlap",
          title: "Must be removed from standalone inventory",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      nextCursor: "standalone-page-2",
    },
    "standalone-page-2": {
      conversations: standaloneRecords.slice(25, 50),
      nextCursor: "standalone-page-3",
    },
    "standalone-page-3": {
      conversations: standaloneRecords.slice(50),
      nextCursor: null,
    },
  },
  projects: [{ id: "project-alpha" }, { id: "project-beta" }],
  projectConversationPages: {
    "project-alpha:first": {
      conversationIds: ["project-overlap", "project-chat-1"],
      nextCursor: "project-alpha-page-2",
    },
    "project-alpha:project-alpha-page-2": {
      conversationIds: ["project-chat-2", "project-chat-1"],
      nextCursor: null,
    },
    "project-beta:first": {
      conversationIds: ["project-chat-3"],
      nextCursor: null,
    },
  },
  deleteOutcomes: {
    "standalone-001": ["success"],
    "standalone-002": [404],
    "standalone-003": [410],
    "standalone-004": [429, "success"],
    "standalone-005": [500, "success"],
    "standalone-006": [
      "network",
      "network",
      "network",
      "network",
      "network",
      "success",
    ],
    "standalone-007": [403],
  },
  latencyMs: 25,
};

export const MALFORMED_STANDALONE_FIXTURE: FakeGatewayFixture = {
  ...DEMO_FIXTURE,
  standalonePages: {
    first: {
      conversations: [{ title: "Missing safety-critical ID" }],
      nextCursor: null,
    },
  },
};
