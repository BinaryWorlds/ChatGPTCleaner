import { useEffect, useState } from "react";
import { AppConfig } from "../config";
import {
  loadInventory,
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

export function useManagerInventory(dependencies: ManagerDependencies | null) {
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
  const [projectConversationCount, setProjectConversationCount] = useState(0);
  const [protectedConversationIds, setProtectedConversationIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [requestsPerMinute, setRequestsPerMinute] = useState<number>(
    AppConfig.deletion.requestsPerMinute.default,
  );

  useEffect(() => {
    let current = true;
    let readCompatibilityConfirmed = false;
    if (dependencies === null) {
      return () => {
        current = false;
      };
    }

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
        setConversations(result.inventory.standaloneConversations);
        setProjectConversations(result.inventory.projectConversations);
        setConversationTitles(
          new Map(
            result.inventory.standaloneConversations.map(({ id, title }) => [
              id,
              title,
            ]),
          ),
        );
        setProjectConversationCount(
          result.inventory.projectConversationIds.size,
        );
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
  }, [dependencies]);

  const resetInventory = (sourceAvailable: boolean) => {
    setInventoryState(
      sourceAvailable
        ? INITIAL_INVENTORY_STATE
        : {
            kind: "blocked",
            reason: "source-unavailable",
            readCompatibilityConfirmed: false,
          },
    );
    setConversations([]);
    setProjectConversations([]);
    setConversationTitles(new Map());
    setProjectConversationCount(0);
    setProtectedConversationIds(new Set());
  };

  const removeConversations = (removedIds: ReadonlySet<string>) => {
    setConversations((currentConversations) =>
      currentConversations.filter(({ id }) => !removedIds.has(id)),
    );
  };

  return {
    inventoryState,
    conversations,
    projectConversations,
    conversationTitles,
    projectConversationCount,
    protectedConversationIds,
    requestsPerMinute,
    resetInventory,
    removeConversations,
    setProtectedConversationIds,
    setRequestsPerMinute,
  } as const;
}
