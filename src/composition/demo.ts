import { FakeConversationGateway } from "../infrastructure/fake/FakeConversationGateway";
import { AppConfig } from "../config";
import { FakeDestructiveRunLock } from "../infrastructure/fake/FakeDestructiveRunLock";
import {
  FakeProtectedConversationStore,
  FakeSettingsStore,
  FakeThemePreferenceStore,
} from "../infrastructure/fake/FakeStores";
import { DEMO_FIXTURE } from "../infrastructure/fake/fixtures";
import { SystemClock } from "../infrastructure/time/SystemClock";
import { createApplicationObservability } from "../infrastructure/observability/applicationObservability";
import { copyConversationId } from "../infrastructure/browser/copyConversationId";
import type { ManagerComposition } from "./types";

export function createManagerComposition(): ManagerComposition {
  const clock = new SystemClock();
  return {
    mode: "demo",
    dependencies: {
      gateway: new FakeConversationGateway(DEMO_FIXTURE, clock),
      protectedConversationStore: new FakeProtectedConversationStore([
        "standalone-010",
        "standalone-011",
      ]),
      settingsStore: new FakeSettingsStore(
        AppConfig.deletion.requestsPerMinute.default,
      ),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      observability: createApplicationObservability(),
    },
    themePreferenceStore: new FakeThemePreferenceStore(),
    openConversation: () => undefined,
    copyConversationId,
  };
}
