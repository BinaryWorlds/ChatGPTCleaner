import type { Conversation } from "../../domain/conversation";
import type { AppError } from "../AppError";
import type { ReadFailureReason } from "../SafetyBlockReason";

export type { ReadFailureReason } from "../SafetyBlockReason";

export const ChatGptOperation = {
  StandaloneConversationsList: "standaloneConversations.list",
  ProjectsList: "projects.list",
  ProjectConversationsList: "projectConversations.list",
  ConversationDelete: "conversation.delete",
} as const;

export const STANDALONE_CONVERSATION_PAGE_LIMIT = 100;

export interface ProjectReference {
  readonly id: string;
}

export interface ConversationPage {
  readonly conversations: readonly Conversation[];
  readonly nextCursor: string | null;
}

export type ReadOperationName =
  "standalone" | "projects" | "project-conversations";

export type ReadDiagnosticCategory =
  | "response-contract"
  | "response-format"
  | "pagination-contract"
  | "pagination-non-progress";

export type JsonValueType =
  | "absent"
  | "array"
  | "boolean"
  | "null"
  | "number"
  | "object"
  | "string"
  | "non-json";

export interface ReadFailureDiagnostic {
  readonly operation: ReadOperationName;
  readonly endpointFamily: string;
  readonly category: ReadDiagnosticCategory;
  readonly paginationStep: number;
  readonly httpStatus?: number;
  readonly jsonParsed?: boolean;
  readonly fieldPath?: string;
  readonly expectedType?: string;
  readonly actualType?: JsonValueType;
  readonly missingRequiredField?: string;
}

export type ReadResult<T> =
  | { readonly kind: "success"; readonly value: T }
  | {
      readonly kind: "failure";
      readonly reason: ReadFailureReason;
      readonly diagnostic?: ReadFailureDiagnostic;
    };

export type DeleteAttemptResult =
  | { readonly kind: "deleted"; readonly status?: number }
  | { readonly kind: "skipped"; readonly status: 404 | 410 }
  | {
      readonly kind: "retryable";
      readonly reason: "rate-limit" | "server" | "network";
      readonly retryAfterMs?: number;
      readonly status?: number;
    }
  | {
      readonly kind: "fatal";
      readonly reason:
        | "authentication"
        | "authorization"
        | "client"
        | "response-anomaly"
        | "retry-later"
        | "source-unavailable";
      readonly error: AppError;
      readonly status?: number;
    };

export interface ConversationGateway {
  beginSafetyInventoryRead(): Promise<ReadResult<null>>;
  fetchStandaloneConversationPage(
    cursor: string | null,
  ): Promise<ReadResult<ConversationPage>>;
  fetchProjects(): Promise<ReadResult<readonly ProjectReference[]>>;
  fetchProjectConversationPage(
    projectId: string,
    cursor: string | null,
    paginationStep?: number,
  ): Promise<ReadResult<ConversationPage>>;
  deleteConversation(conversationId: string): Promise<DeleteAttemptResult>;
}
