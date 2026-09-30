import { useCallback, useEffect, useRef, useState } from "react";
import { AppConfig } from "../config";
import {
  loadInventory,
  loadRefreshInventoryCandidate,
  type InventoryLoadProgress,
} from "../application/inventory";
import type { ManagerDependencies } from "../composition/types";
import type { Conversation } from "../domain/conversation";
import type { SafetyBlockReason } from "../application/SafetyBlockReason";

export type InventoryStage = "compatibility" | "inventory" | "projects";

type InventoryState =
  | {
      readonly kind: "loading";
      readonly stage: InventoryStage;
      readonly loadedConversationCount: number;
    }
  | {
      readonly kind: "blocked";
      readonly reason: SafetyBlockReason;
    }
  | { readonly kind: "ready" };

export type RefreshInventoryResult =
  | { readonly kind: "refreshed" }
  | {
      readonly kind: "warning";
      readonly reason: SafetyBlockReason;
    }
  | {
      readonly kind: "blocked";
      readonly reason: SafetyBlockReason;
    };

const INITIAL_INVENTORY_STATE: InventoryState = {
  kind: "loading",
  stage: "compatibility",
  loadedConversationCount: 0,
};

export function useManagerInventory(dependencies: ManagerDependencies) {
  const [inventoryState, setInventoryState] = useState<InventoryState>(
    INITIAL_INVENTORY_STATE,
  );
  const [conversations, setConversations] = useState<readonly Conversation[]>(
    [],
  );
  const [projectConversations, setProjectConversations] = useState<
    readonly Conversation[]
  >([]);
  const [conversationTitles, setConversationTitles] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const [protectedConversationIds, setProtectedConversationIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [requestsPerMinute, setRequestsPerMinute] = useState<number>(
    AppConfig.deletion.requestsPerMinute.default,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [hasAcceptedSnapshot, setHasAcceptedSnapshot] = useState(false);
  const [initialLoadAttempt, setInitialLoadAttempt] = useState(0);
  const refreshingRef = useRef(false);

  const replaceInventorySnapshot = useCallback(
    (inventory: {
      readonly standaloneConversations: readonly Conversation[];
      readonly projectConversations: readonly Conversation[];
    }) => {
      setConversations(inventory.standaloneConversations);
      setProjectConversations(inventory.projectConversations);
      setConversationTitles(
        new Map(
          inventory.standaloneConversations.map(({ id, title }) => [id, title]),
        ),
      );
    },
    [],
  );

  useEffect(() => {
    let current = true;

    const updateInventoryProgress = (progress: InventoryLoadProgress) => {
      if (!current) return;
      if (progress.kind === "read-compatible") {
        setInventoryState({
          kind: "loading",
          stage: "inventory",
          loadedConversationCount: 0,
        });
        return;
      }
      setInventoryState({
        kind: "loading",
        stage:
          progress.kind === "project-protection-started"
            ? "projects"
            : "inventory",
        loadedConversationCount: progress.loadedConversationCount,
      });
    };

    loadInventory({ ...dependencies, onProgress: updateInventoryProgress })
      .then((result) => {
        if (!current) return;
        if (result.kind === "blocked") {
          setInventoryState({
            kind: "blocked",
            reason: result.reason,
          });
          return;
        }
        replaceInventorySnapshot(result.inventory);
        setProtectedConversationIds(result.protectedConversationIds);
        setRequestsPerMinute(result.requestsPerMinute);
        setHasAcceptedSnapshot(true);
        setInventoryState({ kind: "ready" });
      })
      .catch(() => {
        if (current) {
          setInventoryState({
            kind: "blocked",
            reason: "network",
          });
        }
      });

    return () => {
      current = false;
    };
  }, [dependencies, initialLoadAttempt, replaceInventorySnapshot]);

  const refreshInventory =
    useCallback(async (): Promise<RefreshInventoryResult> => {
      if (refreshingRef.current) return { kind: "warning", reason: "request" };

      refreshingRef.current = true;
      setRefreshing(true);
      try {
        const result = await loadRefreshInventoryCandidate({
          gateway: dependencies.gateway,
          protectedConversationStore: dependencies.protectedConversationStore,
        });
        if (result.kind === "blocked") {
          const blocksAcceptedSnapshot = [
            "source-unavailable",
            "authentication",
            "compatibility",
            "pagination",
            "request",
            "protected-storage",
          ].includes(result.reason);
          if (blocksAcceptedSnapshot) {
            setInventoryState({
              kind: "blocked",
              reason: result.reason,
            });
            return { kind: "blocked", reason: result.reason };
          }
          return { kind: "warning", reason: result.reason };
        }
        replaceInventorySnapshot(result.inventory);
        setProtectedConversationIds(result.protectedConversationIds);
        setInventoryState({ kind: "ready" });
        return { kind: "refreshed" };
      } catch {
        return { kind: "warning", reason: "network" };
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    }, [dependencies, replaceInventorySnapshot]);

  const retryInitialInventory = useCallback(() => {
    if (hasAcceptedSnapshot || refreshingRef.current) return;
    setInventoryState(INITIAL_INVENTORY_STATE);
    setInitialLoadAttempt((attempt) => attempt + 1);
  }, [hasAcceptedSnapshot]);

  const isRefreshPending = useCallback(() => refreshingRef.current, []);

  const removeConversation = (removedId: string) => {
    setConversations((currentConversations) =>
      currentConversations.filter(({ id }) => id !== removedId),
    );
  };

  return {
    inventoryState,
    conversations,
    projectConversations,
    conversationTitles,
    protectedConversationIds,
    requestsPerMinute,
    refreshing,
    hasAcceptedSnapshot,
    isRefreshPending,
    refreshInventory,
    retryInitialInventory,
    removeConversation,
    setProtectedConversationIds,
    setRequestsPerMinute,
  } as const;
}
