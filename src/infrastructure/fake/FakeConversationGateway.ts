import { z } from "zod";
import {
  isSafetyCriticalIdentifier,
  MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH,
} from "domain/identifier";
import { createAppError } from "application/AppError";
import type { Clock } from "application/ports/Clock";
import type {
  ConversationGateway,
  ConversationPage,
  DeleteAttemptResult,
  ProjectReference,
  ReadResult,
} from "application/ports/ConversationGateway";
import { ChatGptOperation } from "application/ports/ConversationGateway";
import type { FakeDeleteOutcome, FakeGatewayFixture } from "./fixtures";

const rawConversationSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH)
    .refine(isSafetyCriticalIdentifier),
  title: z.string(),
  createdAt: z.number().finite().nullable().default(null),
  updatedAt: z.number().finite().nullable().default(null),
});
const rawConversationPageSchema = z.object({
  conversations: z.array(rawConversationSchema),
  nextCursor: z.string().min(1).nullable(),
});
const projectSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH)
    .refine(isSafetyCriticalIdentifier),
});
const projectsSchema = z.array(projectSchema);
const projectConversationPageSchema = z.object({
  conversations: z.array(rawConversationSchema),
  nextCursor: z.string().min(1).nullable(),
});

function deleteResult(outcome: FakeDeleteOutcome): DeleteAttemptResult {
  if (outcome === "success") return { kind: "deleted", status: 204 };
  if (outcome === 404 || outcome === 410) {
    return { kind: "skipped", status: outcome };
  }
  if (outcome === 401) {
    return {
      kind: "fatal",
      reason: "authentication",
      error: createAppError("AuthenticationUnavailable", {
        operation: ChatGptOperation.ConversationDelete,
        httpStatus: 401,
      }),
      status: 401,
    };
  }
  if (outcome === 403) {
    return {
      kind: "fatal",
      reason: "authorization",
      error: createAppError("AuthorizationDenied", {
        operation: ChatGptOperation.ConversationDelete,
        httpStatus: 403,
      }),
      status: 403,
    };
  }
  if (outcome === 422) {
    return {
      kind: "fatal",
      reason: "client",
      error: createAppError("ApiCompatibilityFailure", {
        operation: ChatGptOperation.ConversationDelete,
        httpStatus: 422,
      }),
      status: 422,
    };
  }
  if (outcome === 429) {
    return {
      kind: "retryable",
      reason: "rate-limit",
      retryAfterMs: 2_000,
      status: 429,
    };
  }
  if (outcome === "long-rate-limit") {
    return {
      kind: "retryable",
      reason: "rate-limit",
      retryAfterMs: 120_000,
      status: 429,
    };
  }
  if (outcome === 500) {
    return { kind: "retryable", reason: "server", status: 500 };
  }
  return { kind: "retryable", reason: "network" };
}

export class FakeConversationGateway implements ConversationGateway {
  private readonly outcomeIndexes = new Map<string, number>();
  public readonly deleteAttempts: { id: string; startedAt: number }[] = [];
  public safetyInventoryReadCount = 0;
  public standalonePageReadCount = 0;
  public projectDiscoveryReadCount = 0;
  public projectConversationPageReadCount = 0;

  public constructor(
    private readonly fixture: FakeGatewayFixture,
    private readonly clock: Clock,
  ) {}

  public beginSafetyInventoryRead(): Promise<ReadResult<null>> {
    this.safetyInventoryReadCount += 1;
    return Promise.resolve({ kind: "success", value: null });
  }

  public fetchStandaloneConversationPage(
    cursor: string | null,
  ): Promise<ReadResult<ConversationPage>> {
    this.standalonePageReadCount += 1;
    const rawPage = this.fixture.standalonePages[cursor ?? "first"];
    if (rawPage !== undefined && "kind" in rawPage) {
      return Promise.resolve(rawPage);
    }
    const parsedPage = rawConversationPageSchema.safeParse(rawPage);
    if (!parsedPage.success) {
      return Promise.resolve({ kind: "failure", reason: "compatibility" });
    }

    return Promise.resolve({
      kind: "success",
      value: parsedPage.data,
    });
  }

  public fetchProjects(): Promise<ReadResult<readonly ProjectReference[]>> {
    this.projectDiscoveryReadCount += 1;
    const parsedProjects = projectsSchema.safeParse(this.fixture.projects);
    return Promise.resolve(
      parsedProjects.success
        ? { kind: "success", value: parsedProjects.data }
        : { kind: "failure", reason: "compatibility" },
    );
  }

  public fetchProjectConversationPage(
    projectId: string,
    cursor: string | null,
  ): Promise<ReadResult<ConversationPage>> {
    this.projectConversationPageReadCount += 1;
    const key = `${projectId}:${cursor ?? "first"}`;
    const rawPage = this.fixture.projectConversationPages[key];
    if (rawPage !== undefined && "kind" in rawPage) {
      return Promise.resolve(rawPage);
    }
    const parsedPage = projectConversationPageSchema.safeParse(rawPage);
    return Promise.resolve(
      parsedPage.success
        ? {
            kind: "success",
            value: parsedPage.data,
          }
        : { kind: "failure", reason: "compatibility" },
    );
  }

  public async deleteConversation(
    conversationId: string,
  ): Promise<DeleteAttemptResult> {
    this.deleteAttempts.push({
      id: conversationId,
      startedAt: this.clock.now(),
    });
    const latencyMs = this.fixture.latencyMs ?? 0;
    if (latencyMs > 0) {
      await this.clock.sleep(latencyMs, new AbortController().signal);
    }
    const outcomes = this.fixture.deleteOutcomes?.[conversationId] ?? [
      "success",
    ];
    const outcomeIndex = this.outcomeIndexes.get(conversationId) ?? 0;
    this.outcomeIndexes.set(conversationId, outcomeIndex + 1);
    return deleteResult(outcomes[outcomeIndex] ?? outcomes.at(-1) ?? "success");
  }
}
