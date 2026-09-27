import type { Conversation } from "../../domain/conversation";
import type {
  ConversationPage,
  ReadResult,
} from "../../application/ports/ConversationGateway";

export interface FakeConversationFixture extends Omit<
  Conversation,
  "createdAt" | "updatedAt"
> {
  readonly createdAt?: number | null;
  readonly updatedAt?: number | null;
}

export interface FakeConversationPageFixture {
  readonly conversations: readonly FakeConversationFixture[];
  readonly nextCursor: string | null;
}

export type FakeConversationPageResult =
  | FakeConversationPageFixture
  | Extract<ReadResult<ConversationPage>, { readonly kind: "failure" }>;

export interface FakeGatewayFixture {
  readonly standalonePages: Readonly<
    Record<string, FakeConversationPageResult>
  >;
  readonly projects: unknown;
  readonly projectConversationPages: Readonly<
    Record<string, FakeConversationPageResult>
  >;
  readonly deleteOutcomes?: Readonly<
    Record<string, readonly FakeDeleteOutcome[]>
  >;
  readonly latencyMs?: number;
}

export type FakeDeleteOutcome =
  | "success"
  | "long-rate-limit"
  | 401
  | 403
  | 404
  | 410
  | 422
  | 429
  | 500
  | "network";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 8, 21);

const standaloneRecords = Array.from({ length: 64 }, (_, index) => ({
  id: `standalone-${String(index + 1).padStart(3, "0")}`,
  title: index === 4 ? "(Untitled)" : `Conversation ${index + 1}`,
  createdAt: index === 7 ? null : NOW - (index + 1) * DAY_MS,
  updatedAt: index === 9 ? null : NOW - index * DAY_MS,
}));

export const DEMO_FIXTURE: FakeGatewayFixture = {
  standalonePages: {
    first: {
      conversations: [
        ...standaloneRecords,
        standaloneRecords[0]!,
        {
          id: "project-overlap",
          title: "Must be removed from standalone inventory",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      nextCursor: null,
    },
  },
  projects: [{ id: "project-alpha" }, { id: "project-beta" }],
  projectConversationPages: {
    "project-alpha:first": {
      conversations: [
        {
          id: "project-overlap",
          title: "Project overlap",
          createdAt: NOW - 3 * DAY_MS,
          updatedAt: NOW - DAY_MS,
        },
        {
          id: "project-chat-1",
          title: "Project planning",
          createdAt: NOW - 40 * DAY_MS,
          updatedAt: NOW - 20 * DAY_MS,
        },
      ],
      nextCursor: "project-alpha-page-2",
    },
    "project-alpha:project-alpha-page-2": {
      conversations: [
        {
          id: "project-chat-2",
          title: "(Untitled)",
          createdAt: null,
          updatedAt: null,
        },
        {
          id: "project-chat-1",
          title: "Project planning",
          createdAt: NOW - 40 * DAY_MS,
          updatedAt: NOW - 20 * DAY_MS,
        },
      ],
      nextCursor: null,
    },
    "project-beta:first": {
      conversations: [
        {
          id: "project-chat-3",
          title: "Project delivery",
          createdAt: NOW - 10 * DAY_MS,
          updatedAt: NOW - 2 * DAY_MS,
        },
      ],
      nextCursor: null,
    },
  },
  latencyMs: 25,
};

export const STANDALONE_COMPATIBILITY_FAILURE_FIXTURE: FakeGatewayFixture = {
  ...DEMO_FIXTURE,
  standalonePages: {
    first: { kind: "failure", reason: "compatibility" },
  },
};
