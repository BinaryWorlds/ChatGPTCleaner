import { FakeConversationGateway } from "../infrastructure/fake/FakeConversationGateway";
import { FakeDestructiveRunLock } from "../infrastructure/fake/FakeDestructiveRunLock";
import {
  FakeProtectedConversationStore,
  FakeSettingsStore,
} from "../infrastructure/fake/FakeStores";
import {
  DEMO_FIXTURE,
  MALFORMED_STANDALONE_FIXTURE,
  type FakeGatewayFixture,
} from "../infrastructure/fake/fixtures";
import { SystemClock } from "../infrastructure/time/SystemClock";
import { createApplicationObservability } from "../infrastructure/observability/applicationObservability";
import type { ManagerComposition, ManagerDependencies } from "./types";

const scenarios = [
  {
    id: "standard",
    label: "Standard outcomes",
    description:
      "IDs 001–007 cover success, gone, retries, failed network, and fatal 403.",
  },
  {
    id: "malformed",
    label: "Malformed API response",
    description: "Safety-critical inventory validation fails closed.",
  },
] as const;

function fixtureForScenario(scenarioId: string): FakeGatewayFixture {
  if (scenarioId === "malformed") return MALFORMED_STANDALONE_FIXTURE;
  return DEMO_FIXTURE;
}

function createDependencies(scenarioId: string): ManagerDependencies {
  const clock = new SystemClock();
  return {
    gateway: new FakeConversationGateway(fixtureForScenario(scenarioId), clock),
    protectedConversationStore: new FakeProtectedConversationStore([
      "standalone-010",
      "standalone-011",
    ]),
    settingsStore: new FakeSettingsStore(60),
    clock,
    destructiveRunLock: new FakeDestructiveRunLock(),
    observability: createApplicationObservability(),
  };
}

export function createManagerComposition(): ManagerComposition {
  return {
    mode: "demo",
    scenarios,
    initialScenarioId: "standard",
    createDependencies,
    openConversation: () => undefined,
  };
}
