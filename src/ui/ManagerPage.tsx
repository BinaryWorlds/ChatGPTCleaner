import {
  Alert,
  Button,
  Card,
  Col,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { DeletionRun, type DeletionRunState } from "../application/deletionRun";
import { loadInventory } from "../application/inventory";
import { runPreflight } from "../application/preflight";
import { saveRequestsPerMinute } from "../application/settings";
import type {
  ManagerComposition,
  ManagerDependencies,
} from "../composition/types";
import {
  EMPTY_CONVERSATION_FILTERS,
  filterConversations,
  sortConversations,
  type Conversation,
  type ConversationFilters,
  type ConversationSortField,
  type SortDirection,
} from "../domain/conversation";
import { confirmDeletionPlan, type DeletionPlan } from "../domain/deletionPlan";
import {
  invertMatchingSelection,
  protectConversation,
  selectAllMatching,
} from "../domain/selection";
import { ConversationFiltersBar } from "./ConversationFilters";
import { ConversationTable } from "./ConversationTable";
import { DeletionConfirmationModal } from "./DeletionConfirmationModal";
import { DeletionProgressPanel } from "./DeletionProgressPanel";
import { SafetyStatus } from "./SafetyStatus";

type InventoryState =
  | { readonly kind: "loading" }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "ready"; readonly contextFingerprint: string };

function isRunActive(state: DeletionRunState | null): boolean {
  return (
    state?.kind === "running" ||
    state?.kind === "pausing" ||
    state?.kind === "paused" ||
    state?.kind === "stopping"
  );
}

function isProtectionLocked(state: DeletionRunState | null): boolean {
  return (
    state?.kind === "running" ||
    state?.kind === "pausing" ||
    state?.kind === "stopping"
  );
}

export interface ManagerPageProps {
  readonly composition: ManagerComposition;
}

export function ManagerPage({ composition }: ManagerPageProps) {
  const [scenarioId, setScenarioId] = useState(composition.initialScenarioId);
  const [dependencies, setDependencies] = useState<ManagerDependencies | null>(
    () => composition.createDependencies(composition.initialScenarioId),
  );
  const [inventoryState, setInventoryState] = useState<InventoryState>({
    kind: "loading",
  });
  const [conversations, setConversations] = useState<readonly Conversation[]>(
    [],
  );
  const [conversationTitles, setConversationTitles] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const [projectConversationCount, setProjectConversationCount] = useState(0);
  const [protectedConversationIds, setProtectedConversationIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [selectedConversationIds, setSelectedConversationIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [requestsPerMinute, setRequestsPerMinute] = useState(60);
  const [filters, setFilters] = useState<ConversationFilters>(
    EMPTY_CONVERSATION_FILTERS,
  );
  const [sortField, setSortField] =
    useState<ConversationSortField>("updatedAt");
  const [sortDirection, setSortDirection] =
    useState<SortDirection>("descending");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [preflightPlan, setPreflightPlan] = useState<DeletionPlan | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [currentRun, setCurrentRun] = useState<DeletionRun | null>(null);
  const [runState, setRunState] = useState<DeletionRunState | null>(null);
  const [safetyOverride, setSafetyOverride] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    if (dependencies === null) {
      return () => {
        current = false;
      };
    }

    loadInventory(dependencies)
      .then((result) => {
        if (!current) return;
        if (result.kind === "blocked") {
          setInventoryState({ kind: "blocked", reason: result.reason });
          return;
        }
        setConversations(result.inventory.standaloneConversations);
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
        setInventoryState({
          kind: "ready",
          contextFingerprint: result.inventory.context.fingerprint,
        });
      })
      .catch(() => {
        if (current) {
          setInventoryState({ kind: "blocked", reason: "network" });
        }
      });

    return () => {
      current = false;
    };
  }, [dependencies]);

  const filteredConversations = useMemo(
    () => filterConversations(conversations, filters),
    [conversations, filters],
  );
  const visibleConversations = useMemo(
    () => sortConversations(filteredConversations, sortField, sortDirection),
    [filteredConversations, sortDirection, sortField],
  );
  const runActive = isRunActive(runState);
  const selectionLocked = runActive;
  const protectionLocked = isProtectionLocked(runState);
  const safetyStatus =
    inventoryState.kind === "loading"
      ? "loading"
      : inventoryState.kind === "blocked" || safetyOverride !== null
        ? "blocked"
        : "ready";
  const blockedReason =
    safetyOverride ??
    (inventoryState.kind === "blocked" ? inventoryState.reason : undefined);

  const updateFilters = (nextFilters: ConversationFilters) => {
    setFilters(nextFilters);
    setPage(1);
  };

  const changeScenario = (nextScenarioId: string) => {
    if (runActive || preflightRunning || preflightPlan !== null) return;
    const nextDependencies = composition.createDependencies(nextScenarioId);
    setScenarioId(nextScenarioId);
    setDependencies(nextDependencies);
    setInventoryState(
      nextDependencies === null
        ? { kind: "blocked", reason: "source-unavailable" }
        : { kind: "loading" },
    );
    setConversations([]);
    setConversationTitles(new Map());
    setSelectedConversationIds(new Set());
    setProtectedConversationIds(new Set());
    setRunState(null);
    setCurrentRun(null);
    setSafetyOverride(null);
    setNotice(null);
    setFilters(EMPTY_CONVERSATION_FILTERS);
    setPage(1);
  };

  const persistProtection = (
    nextProtectedIds: ReadonlySet<string>,
    nextSelection: ReadonlySet<string>,
  ) => {
    if (dependencies === null) return;
    dependencies.protectedConversationStore
      .saveProtectedConversationIds(nextProtectedIds)
      .then(() => {
        setProtectedConversationIds(nextProtectedIds);
        setSelectedConversationIds(nextSelection);
      })
      .catch(() => setSafetyOverride("protected-storage"));
  };

  const handleProtect = (conversationId: string) => {
    if (protectionLocked) return;
    const result = protectConversation(
      protectedConversationIds,
      selectedConversationIds,
      conversationId,
    );
    persistProtection(
      result.protectedConversationIds,
      result.selectedConversationIds,
    );
  };

  const handleUnprotect = (conversationId: string) => {
    if (protectionLocked) return;
    const nextProtectedIds = new Set(protectedConversationIds);
    nextProtectedIds.delete(conversationId);
    persistProtection(nextProtectedIds, selectedConversationIds);
  };

  const handleRateChange = (value: number | null) => {
    if (dependencies === null || value === null || runActive) return;
    saveRequestsPerMinute(dependencies.settingsStore, value)
      .then((saved) => {
        if (saved) setRequestsPerMinute(value);
      })
      .catch(() => setNotice("Could not save the deletion rate."));
  };

  const beginPreflight = () => {
    if (
      dependencies === null ||
      inventoryState.kind !== "ready" ||
      selectedConversationIds.size === 0 ||
      runActive
    ) {
      return;
    }

    setPreflightRunning(true);
    setSafetyOverride(null);
    runPreflight({
      selectedConversationIds: [...selectedConversationIds],
      expectedContextFingerprint: inventoryState.contextFingerprint,
      gateway: dependencies.gateway,
      protectedConversationStore: dependencies.protectedConversationStore,
    })
      .then((result) => {
        setPreflightRunning(false);
        if (result.kind === "blocked") {
          setSafetyOverride(result.reason);
          return;
        }
        if (result.plan.eligibleConversationIds.length === 0) {
          setNotice("No selected conversations remain eligible for deletion.");
          return;
        }
        setConfirmationText("");
        setPreflightPlan(result.plan);
      })
      .catch(() => {
        setPreflightRunning(false);
        setSafetyOverride("network");
      });
  };

  const handleRunStateChange = (nextState: DeletionRunState) => {
    setRunState(nextState);
    if (nextState.kind === "blocked" || nextState.kind === "fatal") {
      setSafetyOverride(nextState.reason);
    }
    if (nextState.progress.removedConversationIds.length === 0) return;

    const removedIds = new Set(nextState.progress.removedConversationIds);
    setConversations((currentConversations) =>
      currentConversations.filter(({ id }) => !removedIds.has(id)),
    );
    setSelectedConversationIds(
      (currentSelection) =>
        new Set(
          [...currentSelection].filter(
            (conversationId) => !removedIds.has(conversationId),
          ),
        ),
    );
  };

  const confirmAndStartDeletion = () => {
    if (dependencies === null || preflightPlan === null) return;
    const confirmation = confirmDeletionPlan(preflightPlan, confirmationText);
    if (confirmation.kind !== "confirmed") return;

    const deletionRun = new DeletionRun({
      confirmedPlan: confirmation.plan,
      expectedContextFingerprint:
        inventoryState.kind === "ready"
          ? inventoryState.contextFingerprint
          : "",
      requestsPerMinute,
      gateway: dependencies.gateway,
      protectedConversationStore: dependencies.protectedConversationStore,
      clock: dependencies.clock,
      destructiveRunLock: dependencies.destructiveRunLock,
      onStateChange: handleRunStateChange,
    });
    setCurrentRun(deletionRun);
    setPreflightPlan(null);
    setConfirmationText("");
    deletionRun
      .startDeletion()
      .catch(() => setSafetyOverride("unexpected-run-error"));
  };

  const retryFailed = () => {
    currentRun
      ?.retryFailedDeletion()
      .catch(() => setSafetyOverride("unexpected-run-error"));
  };

  const currentConversationId =
    runState?.progress.currentConversationId ?? null;
  const currentConversationLabel =
    currentConversationId === null
      ? "None"
      : `${conversationTitles.get(currentConversationId) ?? "(Untitled)"} (${currentConversationId})`;

  return (
    <Space orientation="vertical" size="middle" className="manager-panel">
      <Alert
        type="success"
        showIcon
        title="Demo mode"
        description="Deterministic fake infrastructure is active. No request can reach ChatGPT and no real DELETE can be issued."
      />
      <Card size="small" title="Demo scenario">
        <Space wrap>
          <Select
            aria-label="Demo scenario"
            value={scenarioId}
            disabled={runActive || preflightRunning || preflightPlan !== null}
            options={composition.scenarios.map((scenario) => ({
              value: scenario.id,
              label: scenario.label,
            }))}
            onChange={changeScenario}
          />
          <Typography.Text type="secondary">
            {
              composition.scenarios.find(({ id }) => id === scenarioId)
                ?.description
            }
          </Typography.Text>
        </Space>
      </Card>

      <SafetyStatus status={safetyStatus} blockedReason={blockedReason} />

      {notice !== null && (
        <Alert
          closable
          type="info"
          title={notice}
          onClose={() => setNotice(null)}
        />
      )}

      {inventoryState.kind === "loading" && (
        <Card>
          <Spin /> Loading conversations and building Project protection…
        </Card>
      )}

      {inventoryState.kind === "ready" && (
        <>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title="Standalone conversations"
                  value={conversations.length}
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title="Project conversations protected"
                  value={projectConversationCount}
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title="User protected"
                  value={protectedConversationIds.size}
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <div data-testid="selected-count">
                  <Statistic
                    title="Selected"
                    value={selectedConversationIds.size}
                  />
                </div>
              </Card>
            </Col>
          </Row>

          <Card title="Filters and deletion settings" size="small">
            <Space orientation="vertical" className="full-width">
              <ConversationFiltersBar
                filters={filters}
                onChange={updateFilters}
              />
              <Space>
                <Typography.Text>Requests per minute</Typography.Text>
                <InputNumber
                  aria-label="Requests per minute"
                  min={1}
                  max={120}
                  precision={0}
                  value={requestsPerMinute}
                  disabled={runActive}
                  onChange={handleRateChange}
                />
              </Space>
            </Space>
          </Card>

          <Card title="Selection" size="small">
            <Space wrap>
              <Button
                disabled={selectionLocked}
                onClick={() =>
                  setSelectedConversationIds(
                    selectAllMatching(
                      selectedConversationIds,
                      filteredConversations,
                      protectedConversationIds,
                    ),
                  )
                }
              >
                Select all matching
              </Button>
              <Button
                disabled={selectionLocked}
                onClick={() => setSelectedConversationIds(new Set())}
              >
                Clear selection
              </Button>
              <Button
                disabled={selectionLocked}
                onClick={() =>
                  setSelectedConversationIds(
                    invertMatchingSelection(
                      selectedConversationIds,
                      filteredConversations,
                      protectedConversationIds,
                    ),
                  )
                }
              >
                Invert matching
              </Button>
              <Button
                danger
                type="primary"
                disabled={
                  selectionLocked ||
                  selectedConversationIds.size === 0 ||
                  safetyStatus !== "ready" ||
                  preflightRunning
                }
                onClick={beginPreflight}
              >
                Delete selected ({selectedConversationIds.size})
              </Button>
              {preflightRunning && (
                <Space>
                  <Spin size="small" />
                  <Typography.Text>
                    Running fresh safety preflightâ€¦
                  </Typography.Text>
                </Space>
              )}
            </Space>
          </Card>

          {runState !== null && (
            <DeletionProgressPanel
              state={runState}
              currentConversationLabel={currentConversationLabel}
              onPause={() => currentRun?.pauseDeletion()}
              onResume={() => currentRun?.resumeDeletion()}
              onStop={() => currentRun?.stopDeletion()}
              onRetryFailed={retryFailed}
            />
          )}

          <ConversationTable
            conversations={visibleConversations}
            protectedConversationIds={protectedConversationIds}
            selectedConversationIds={selectedConversationIds}
            selectionDisabled={selectionLocked}
            protectionDisabled={protectionLocked}
            sortField={sortField}
            sortDirection={sortDirection}
            page={page}
            pageSize={pageSize}
            onSelectionChange={setSelectedConversationIds}
            onProtect={handleProtect}
            onUnprotect={handleUnprotect}
            onOpen={(conversationId) => {
              composition.openConversation(conversationId);
              setNotice(`Demo Open action: ${conversationId}`);
            }}
            onSort={(field, direction) => {
              setSortField(field);
              setSortDirection(direction);
              setPage(1);
            }}
            onPageChange={(nextPage, nextPageSize) => {
              setPage(nextPageSize === pageSize ? nextPage : 1);
              setPageSize(nextPageSize);
            }}
          />
        </>
      )}

      <DeletionConfirmationModal
        plan={preflightPlan}
        confirmationText={confirmationText}
        onConfirmationTextChange={setConfirmationText}
        onCancel={() => {
          setPreflightPlan(null);
          setConfirmationText("");
        }}
        onConfirm={confirmAndStartDeletion}
      />
    </Space>
  );
}
