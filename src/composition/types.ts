import type { Clock } from "../application/ports/Clock";
import type { ConversationGateway } from "../application/ports/ConversationGateway";
import type { DestructiveRunLock } from "../application/ports/DestructiveRunLock";
import type { ProtectedConversationStore } from "../application/ports/ProtectedConversationStore";
import type { SettingsStore } from "../application/ports/SettingsStore";
import type { ApplicationObservability } from "../application/ports/Observability";

export interface ManagerDependencies {
  readonly gateway: ConversationGateway;
  readonly protectedConversationStore: ProtectedConversationStore;
  readonly settingsStore: SettingsStore;
  readonly clock: Clock;
  readonly destructiveRunLock: DestructiveRunLock;
  readonly observability?: ApplicationObservability;
}

export interface ManagerComposition {
  readonly mode: "demo" | "production";
  readonly dependencies: ManagerDependencies | null;
  readonly openConversation: (conversationId: string) => void;
}
