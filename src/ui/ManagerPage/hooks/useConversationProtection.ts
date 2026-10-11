import { useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  mutateProtectedConversationIds,
  type ProtectionMutation,
  type ProtectionMutationLockOwner,
} from "application/protection";
import type { SafetyBlockReason } from "application/SafetyBlockReason";
import type { ManagerDependencies } from "composition/types";
import type { ConversationView } from "ui/ManagerPage/components/ConversationTable/conversationTableContract";

interface UseConversationProtectionOptions {
  readonly dependencies: ManagerDependencies;
  readonly conversationView: ConversationView;
  readonly runOwnsWorkflow: boolean;
  readonly refreshing: boolean;
  readonly isRefreshPending: () => boolean;
  readonly mutationPendingRef: RefObject<boolean>;
  readonly mutationLockOwner: ProtectionMutationLockOwner | null;
  readonly eligibleSelectedConversationIds: ReadonlySet<string>;
  readonly protectedSelectedConversationIds: ReadonlySet<string>;
  readonly setProtectedConversationIds: (
    protectedConversationIds: ReadonlySet<string>,
  ) => void;
  readonly blockSafety: (reason: SafetyBlockReason) => void;
  readonly setNotice: (notice: string | null) => void;
}

export function useConversationProtection({
  dependencies,
  conversationView,
  runOwnsWorkflow,
  refreshing,
  isRefreshPending,
  mutationPendingRef,
  mutationLockOwner,
  eligibleSelectedConversationIds,
  protectedSelectedConversationIds,
  setProtectedConversationIds,
  blockSafety,
  setNotice,
}: UseConversationProtectionOptions) {
  const { t } = useTranslation();
  const [mutationPending, setMutationPending] = useState(false);
  const [pendingBulkUnprotectIds, setPendingBulkUnprotectIds] =
    useState<ReadonlySet<string> | null>(null);
  const protectionLocked = runOwnsWorkflow || mutationPending || refreshing;

  const persistProtection = (mutation: ProtectionMutation) => {
    if (mutationPendingRef.current || isRefreshPending()) return;
    setNotice(null);
    mutationPendingRef.current = true;
    setMutationPending(true);
    mutateProtectedConversationIds({
      mutation,
      protectedConversationStore: dependencies.protectedConversationStore,
      destructiveRunLock: dependencies.destructiveRunLock,
      currentRunLockOwner: mutationLockOwner,
    })
      .then((result) => {
        if (result.kind === "locked") {
          setNotice(t("operation.lockConflict"));
          return;
        }
        setProtectedConversationIds(result.protectedConversationIds);
      })
      .catch(() => blockSafety("protected-storage"))
      .finally(() => {
        mutationPendingRef.current = false;
        setMutationPending(false);
      });
  };

  const protectConversation = (conversationId: string) => {
    if (protectionLocked || mutationPendingRef.current || isRefreshPending()) {
      return;
    }
    persistProtection({
      kind: "protect",
      conversationIds: new Set([conversationId]),
    });
  };

  const protectSelectedConversations = () => {
    if (
      conversationView !== "standalone" ||
      protectionLocked ||
      mutationPendingRef.current ||
      isRefreshPending() ||
      eligibleSelectedConversationIds.size === 0
    ) {
      return;
    }
    persistProtection({
      kind: "protect",
      conversationIds: eligibleSelectedConversationIds,
    });
  };

  const unprotectConversation = (conversationId: string) => {
    if (protectionLocked || mutationPendingRef.current || isRefreshPending()) {
      return;
    }
    persistProtection({
      kind: "unprotect",
      conversationIds: new Set([conversationId]),
    });
  };

  const requestUnprotectSelectedConversations = () => {
    if (
      conversationView !== "standalone" ||
      protectionLocked ||
      mutationPendingRef.current ||
      isRefreshPending() ||
      protectedSelectedConversationIds.size === 0
    ) {
      return;
    }

    const requestedIds = new Set(protectedSelectedConversationIds);
    if (requestedIds.size === 1) {
      persistProtection({ kind: "unprotect", conversationIds: requestedIds });
      return;
    }
    setPendingBulkUnprotectIds(requestedIds);
  };

  const confirmBulkUnprotect = (conversationIds: ReadonlySet<string>) => {
    setPendingBulkUnprotectIds(null);
    persistProtection({
      kind: "unprotect",
      conversationIds,
    });
  };

  return {
    mutationPending,
    pendingBulkUnprotectIds,
    protectionLocked,
    protectConversation,
    protectSelectedConversations,
    unprotectConversation,
    requestUnprotectSelectedConversations,
    cancelBulkUnprotect: () => setPendingBulkUnprotectIds(null),
    confirmBulkUnprotect,
  } as const;
}
