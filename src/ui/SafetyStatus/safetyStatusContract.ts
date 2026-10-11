import type { SafetyBlockReason } from "application/SafetyBlockReason";
import type { InventoryStage } from "ui/managerInventoryState";

export type SafetyStatusState =
  | { readonly kind: "unbound" }
  | { readonly kind: "loading"; readonly stage: InventoryStage }
  | { readonly kind: "ready" }
  | { readonly kind: "blocked"; readonly reason: SafetyBlockReason };
