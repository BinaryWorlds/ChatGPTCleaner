import { useTranslation } from "react-i18next";
import { isSafetyOverrideRevalidatedByCompleteRefresh } from "../../../application/SafetyBlockReason";
import type { SafetyBlockReason } from "../../../application/SafetyBlockReason";
import type { RefreshInventoryResult } from "./useManagerInventory";

interface UseManagerRefreshOptions {
  readonly runOwnsWorkflow: boolean;
  readonly isRefreshPending: () => boolean;
  readonly isProtectionMutationPending: () => boolean;
  readonly refreshInventory: () => Promise<RefreshInventoryResult>;
  readonly recoverSafetyAfterCompleteRefresh: () => void;
  readonly clearSelection: () => void;
  readonly cancelConfirmation: () => void;
  readonly safetyOverride: SafetyBlockReason | null;
  readonly setNotice: (notice: string | null) => void;
}

export function useManagerRefresh({
  runOwnsWorkflow,
  isRefreshPending,
  isProtectionMutationPending,
  refreshInventory,
  recoverSafetyAfterCompleteRefresh,
  clearSelection,
  cancelConfirmation,
  safetyOverride,
  setNotice,
}: UseManagerRefreshOptions) {
  const { t } = useTranslation();

  return () => {
    if (
      runOwnsWorkflow ||
      isRefreshPending() ||
      isProtectionMutationPending()
    ) {
      return;
    }

    setNotice(null);
    refreshInventory()
      .then((result) => {
        if (result.kind === "warning") {
          setNotice(t("refresh.warning"));
          return;
        }
        if (result.kind === "blocked") return;
        recoverSafetyAfterCompleteRefresh();
        clearSelection();
        cancelConfirmation();
        if (
          safetyOverride === null ||
          isSafetyOverrideRevalidatedByCompleteRefresh(safetyOverride)
        ) {
          setNotice(t("refresh.success"));
        }
      })
      .catch(() => setNotice(t("refresh.failure")));
  };
}
