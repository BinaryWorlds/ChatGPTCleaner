import type {
  ConversationGateway,
  ConversationPage,
  DeleteAttemptResult,
  ProjectConversationPage,
  ProjectReference,
  ReadResult,
  SafetyContext,
} from "../../application/ports/ConversationGateway";
import type { SourceTabValidationResult } from "../browser/SourceTab";

export interface SourceTabValidator {
  validate(): Promise<SourceTabValidationResult>;
}

/**
 * Production safety boundary while the undocumented read contract is unverified.
 * It validates the bound source tab before failing closed, and deliberately
 * contains no request or DELETE implementation.
 */
export class ProductionConversationGateway implements ConversationGateway {
  public constructor(private readonly sourceTab: SourceTabValidator) {}

  private async unavailable<T>(): Promise<ReadResult<T>> {
    const sourceTab = await this.sourceTab.validate();
    return sourceTab.kind === "valid"
      ? { kind: "failure", reason: "contract-unverified" }
      : { kind: "failure", reason: "source-unavailable" };
  }

  public readSafetyContext(): Promise<ReadResult<SafetyContext>> {
    return this.unavailable();
  }

  public fetchStandaloneConversationPage(
    cursor: string | null,
  ): Promise<ReadResult<ConversationPage>> {
    void cursor;
    return this.unavailable();
  }

  public fetchProjects(): Promise<ReadResult<readonly ProjectReference[]>> {
    return this.unavailable();
  }

  public fetchProjectConversationPage(
    projectId: string,
    cursor: string | null,
  ): Promise<ReadResult<ProjectConversationPage>> {
    void projectId;
    void cursor;
    return this.unavailable();
  }

  public deleteConversation(
    conversationId: string,
  ): Promise<DeleteAttemptResult> {
    void conversationId;
    return Promise.resolve({ kind: "fatal", reason: "response-anomaly" });
  }
}
