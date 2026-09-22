import { FakeClock } from "../infrastructure/fake/FakeClock";
import { FakeConversationGateway } from "../infrastructure/fake/FakeConversationGateway";
import { FakeDestructiveRunLock } from "../infrastructure/fake/FakeDestructiveRunLock";
import {
  FakeProtectedConversationStore,
  FakeSettingsStore,
} from "../infrastructure/fake/FakeStores";
import { DEMO_FIXTURE } from "../infrastructure/fake/fixtures";

export function createManagerComposition() {
  const clock = new FakeClock();
  return {
    mode: "demo" as const,
    gateway: new FakeConversationGateway(DEMO_FIXTURE, clock),
    protectedConversationStore: new FakeProtectedConversationStore([
      "standalone-010",
      "standalone-011",
    ]),
    settingsStore: new FakeSettingsStore(60),
    clock,
    destructiveRunLock: new FakeDestructiveRunLock(),
  };
}
