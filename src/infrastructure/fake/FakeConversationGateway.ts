import { z } from "zod";
import type { Clock } from "../../application/ports/Clock";
import type {
  ConversationGateway,
  ConversationPage,
  DeleteAttemptResult,
  ProjectConversationPage,
  ProjectReference,
  ReadResult,
  SafetyContext,
} from "../../application/ports/ConversationGateway";
import type { Conversation } from "../../domain/conversation";
import type { FakeDeleteOutcome, FakeGatewayFixture } from "./fixtures";

const rawConversationSchema = z.object({
  id: z.string().min(1).max(512),
  title: z.unknown().optional(),
  createdAt: z.unknown().optional(),
  updatedAt: z.unknown().optional(),
});
const rawConversationPageSchema = z.object({
  conversations: z.array(rawConversationSchema),
  nextCursor: z.string().min(1).nullable(),
});
const projectSchema = z.object({ id: z.string().min(1).max(512) });
const projectsSchema = z.array(projectSchema);
const projectConversationPageSchema = z.object({
  conversationIds: z.array(z.string().min(1).max(512)),
  nextCursor: z.string().min(1).nullable(),
});

function displayTitle(value: unknown): string {
  return typeof value === "string" && value.trim() !== ""
    ? value
    : "(Untitled)";
}

function displayTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function deleteResult(outcome: FakeDeleteOutcome): DeleteAttemptResult {
  if (outcome === "success") return { kind: "deleted" };
  if (outcome === 404 || outcome === 410) {
    return { kind: "skipped", status: outcome };
  }
  if (outcome === 403) return { kind: "fatal", reason: "authentication" };
  if (outcome === 429) {
    return { kind: "retryable", reason: "rate-limit", retryAfterMs: 2_000 };
  }
  if (outcome === 500) return { kind: "retryable", reason: "server" };
  return { kind: "retryable", reason: "network" };
}

export class FakeConversationGateway implements ConversationGateway {
  private contextReadCount = 0;
  private readonly outcomeIndexes = new Map<string, number>();
  public readonly deleteAttempts: { id: string; startedAt: number }[] = [];

  public constructor(
    private readonly fixture: FakeGatewayFixture,
    private readonly clock: Clock,
  ) {}

  public readSafetyContext(): Promise<ReadResult<SafetyContext>> {
    const index = Math.min(
      this.contextReadCount,
      this.fixture.contexts.length - 1,
    );
    this.contextReadCount += 1;
    const fingerprint = this.fixture.contexts[index];
    return Promise.resolve(
      fingerprint === undefined || fingerprint === ""
        ? { kind: "failure", reason: "compatibility" }
        : { kind: "success", value: { fingerprint } },
    );
  }

  public fetchStandaloneConversationPage(
    cursor: string | null,
  ): Promise<ReadResult<ConversationPage>> {
    const rawPage = this.fixture.standalonePages[cursor ?? "first"];
    const parsedPage = rawConversationPageSchema.safeParse(rawPage);
    if (!parsedPage.success) {
      return Promise.resolve({ kind: "failure", reason: "compatibility" });
    }

    const conversations: Conversation[] = parsedPage.data.conversations.map(
      (rawConversation) => ({
        id: rawConversation.id,
        title: displayTitle(rawConversation.title),
        createdAt: displayTimestamp(rawConversation.createdAt),
        updatedAt: displayTimestamp(rawConversation.updatedAt),
      }),
    );
    return Promise.resolve({
      kind: "success",
      value: { conversations, nextCursor: parsedPage.data.nextCursor },
    });
  }

  public fetchProjects(): Promise<ReadResult<readonly ProjectReference[]>> {
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
  ): Promise<ReadResult<ProjectConversationPage>> {
    const key = `${projectId}:${cursor ?? "first"}`;
    const parsedPage = projectConversationPageSchema.safeParse(
      this.fixture.projectConversationPages[key],
    );
    return Promise.resolve(
      parsedPage.success
        ? { kind: "success", value: parsedPage.data }
        : { kind: "failure", reason: "compatibility" },
    );
  }

  public async deleteConversation(
    conversationId: string,
  ): Promise<DeleteAttemptResult> {
    const latencyMs = this.fixture.latencyMs ?? 0;
    if (latencyMs > 0) {
      await this.clock.sleep(latencyMs, new AbortController().signal);
    }

    this.deleteAttempts.push({
      id: conversationId,
      startedAt: this.clock.now(),
    });
    const outcomes = this.fixture.deleteOutcomes?.[conversationId] ?? [
      "success",
    ];
    const outcomeIndex = this.outcomeIndexes.get(conversationId) ?? 0;
    this.outcomeIndexes.set(conversationId, outcomeIndex + 1);
    return deleteResult(outcomes[outcomeIndex] ?? outcomes.at(-1) ?? "success");
  }
}
