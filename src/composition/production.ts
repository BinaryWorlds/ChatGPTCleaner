import type { ManagerComposition } from "./types";

export function createManagerComposition(): ManagerComposition {
  return {
    mode: "production-deferred",
    scenarios: [],
    initialScenarioId: "production",
    createDependencies: () => null,
    openConversation: () => undefined,
  };
}
