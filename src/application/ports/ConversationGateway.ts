import type { Conversation } from "../../domain/conversation";

export interface SafetyContext {
  readonly fingerprint: string;
}

export interface ProjectReference {
  readonly id: string;
}

export interface ConversationPage {
  readonly conversations: readonly Conversation[];
  readonly nextCursor: string | null;
}

export interface ProjectConversationPage {
  readonly conversationIds: readonly string[];
  readonly nextCursor: string | null;
}

export type ReadFailureReason =
  | "authentication"
  | "compatibility"
  | "network"
  | "retry-later"
  | "source-unavailable";

export type ReadResult<T> =
  | { readonly kind: "success"; readonly value: T }
  | { readonly kind: "failure"; readonly reason: ReadFailureReason };

export type DeleteAttemptResult =
  | { readonly kind: "deleted" }
  | { readonly kind: "skipped"; readonly status: 404 | 410 }
  | {
      readonly kind: "retryable";
      readonly reason: "rate-limit" | "server" | "network";
      readonly retryAfterMs?: number;
    }
  | {
      readonly kind: "fatal";
      readonly reason: "authentication" | "client" | "response-anomaly";
    };

export interface ConversationGateway {
  readSafetyContext(): Promise<ReadResult<SafetyContext>>;
  fetchStandaloneConversationPage(
    cursor: string | null,
  ): Promise<ReadResult<ConversationPage>>;
  fetchProjects(): Promise<ReadResult<readonly ProjectReference[]>>;
  fetchProjectConversationPage(
    projectId: string,
    cursor: string | null,
  ): Promise<ReadResult<ProjectConversationPage>>;
  deleteConversation(conversationId: string): Promise<DeleteAttemptResult>;
}
