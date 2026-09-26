import { useCallback, useEffect, useRef, useState } from "react";
import { AppConfig } from "../config";
import {
  loadInventory,
  loadSafetyInventory,
  type InventoryLoadProgress,
} from "../application/inventory";
import type { ReadFailureDiagnostic } from "../application/ports/ConversationGateway";
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
      readonly diagnostic?: ReadFailureDiagnostic;
      readonly readCompatibilityConfirmed: boolean;
    }
  | { readonly kind: "ready" };

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
    let readCompatibilityConfirmed = false;

    const updateInventoryProgress = (progress: InventoryLoadProgress) => {
      if (!current) return;
      if (progress.kind === "read-compatible") {
        readCompatibilityConfirmed = true;
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
            readCompatibilityConfirmed,
            ...(result.diagnostic === undefined
              ? {}
              : { diagnostic: result.diagnostic }),
          });
          return;
        }
        replaceInventorySnapshot(result.inventory);
        setProtectedConversationIds(result.protectedConversationIds);
        setRequestsPerMinute(result.requestsPerMinute);
        setInventoryState({ kind: "ready" });
      })
      .catch(() => {
        if (current) {
          setInventoryState({
            kind: "blocked",
            reason: "network",
            readCompatibilityConfirmed,
          });
        }
      });

    return () => {
      current = false;
    };
  }, [dependencies, replaceInventorySnapshot]);

  const refreshInventory = useCallback(async (): Promise<boolean> => {
    if (refreshingRef.current) return false;

    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const result = await loadSafetyInventory(dependencies.gateway);
      if (result.kind === "blocked") return false;
      replaceInventorySnapshot(result.inventory);
      return true;
    } catch {
      return false;
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [dependencies, replaceInventorySnapshot]);

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
    refreshInventory,
    removeConversation,
    setProtectedConversationIds,
    setRequestsPerMinute,
  } as const;
}
