import {
  Alert,
  Button,
  Card,
  Col,
  InputNumber,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { DeletionRun, type DeletionRunState } from "../application/deletionRun";
import {
  loadInventory,
  type InventoryLoadProgress,
} from "../application/inventory";
import type { ReadFailureDiagnostic } from "../application/ports/ConversationGateway";
import { runPreflight } from "../application/preflight";
import { saveProtectedConversationIds } from "../application/protection";
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
  | {
      readonly kind: "loading";
      readonly stage: "compatibility" | "inventory" | "projects";
      readonly loadedConversationCount: number;
    }
  | {
      readonly kind: "blocked";
      readonly reason: string;
      readonly diagnostic?: ReadFailureDiagnostic;
      readonly readCompatibilityConfirmed: boolean;
    }
  | { readonly kind: "ready" };

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
  const [conversationView, setConversationView] = useState<
    "standalone" | "projects"
  >("standalone");
  const [scenarioId, setScenarioId] = useState(composition.initialScenarioId);
  const [dependencies, setDependencies] = useState<ManagerDependencies | null>(
    () => composition.createDependencies(composition.initialScenarioId),
  );
  const [inventoryState, setInventoryState] = useState<InventoryState>({
    kind: "loading",
    stage: "compatibility",
    loadedConversationCount: 0,
  });
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
  const [selectedConversationIds, setSelectedConversationIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [requestsPerMinute, setRequestsPerMinute] = useState(60);
  const [filters, setFilters] = useState<ConversationFilters>(
    EMPTY_CONVERSATION_FILTERS,
  );
  const [projectFilters, setProjectFilters] = useState<ConversationFilters>(
    EMPTY_CONVERSATION_FILTERS,
  );
  const [sortField, setSortField] =
    useState<ConversationSortField>("updatedAt");
  const [sortDirection, setSortDirection] =
    useState<SortDirection>("descending");
  const [projectSortField, setProjectSortField] =
    useState<ConversationSortField>("updatedAt");
  const [projectSortDirection, setProjectSortDirection] =
    useState<SortDirection>("descending");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [projectPage, setProjectPage] = useState(1);
  const [projectPageSize, setProjectPageSize] = useState(50);
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [preflightPlan, setPreflightPlan] = useState<DeletionPlan | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [currentRun, setCurrentRun] = useState<DeletionRun | null>(null);
  const [runState, setRunState] = useState<DeletionRunState | null>(null);
  const [safetyOverride, setSafetyOverride] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const runOperationId = useRef<string | null>(null);

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

  const filteredConversations = useMemo(
    () => filterConversations(conversations, filters),
    [conversations, filters],
  );
  const visibleConversations = useMemo(
    () => sortConversations(filteredConversations, sortField, sortDirection),
    [filteredConversations, sortDirection, sortField],
  );
  const currentStandalonePageConversations = useMemo(
    () => visibleConversations.slice((page - 1) * pageSize, page * pageSize),
    [page, pageSize, visibleConversations],
  );
  const filteredProjectConversations = useMemo(
    () => filterConversations(projectConversations, projectFilters),
    [projectConversations, projectFilters],
  );
  const visibleProjectConversations = useMemo(
    () =>
      sortConversations(
        filteredProjectConversations,
        projectSortField,
        projectSortDirection,
      ),
    [filteredProjectConversations, projectSortDirection, projectSortField],
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
    if (conversationView === "projects") {
      setProjectFilters(nextFilters);
      setProjectPage(1);
      return;
    }
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
        ? {
            kind: "blocked",
            reason: "source-unavailable",
            readCompatibilityConfirmed: false,
          }
        : {
            kind: "loading",
            stage: "compatibility",
            loadedConversationCount: 0,
          },
    );
    setConversations([]);
    setProjectConversations([]);
    setConversationTitles(new Map());
    setSelectedConversationIds(new Set());
    setProtectedConversationIds(new Set());
    setRunState(null);
    setCurrentRun(null);
    setSafetyOverride(null);
    setNotice(null);
    setFilters(EMPTY_CONVERSATION_FILTERS);
    setProjectFilters(EMPTY_CONVERSATION_FILTERS);
    setConversationView("standalone");
    setPage(1);
    setProjectPage(1);
  };

  const persistProtection = (
    nextProtectedIds: ReadonlySet<string>,
    nextSelection: ReadonlySet<string>,
  ) => {
    if (dependencies === null) return;
    saveProtectedConversationIds({
      protectedConversationIds: nextProtectedIds,
      protectedConversationStore: dependencies.protectedConversationStore,
      destructiveRunLock: dependencies.destructiveRunLock,
      currentRunOwnsLock: runState?.kind === "paused",
    })
      .then((result) => {
        if (result === "locked") {
          setSafetyOverride("destructive-run-lock");
          return;
        }
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

    const operationId = dependencies.observability?.createOperationId();
    dependencies.observability?.info("preflight.started", {
      ...(operationId === undefined ? {} : { operationId }),
      selectedCount: selectedConversationIds.size,
    });
    setPreflightRunning(true);
    setSafetyOverride(null);
    runPreflight({
      selectedConversationIds: [...selectedConversationIds],
      gateway: dependencies.gateway,
      protectedConversationStore: dependencies.protectedConversationStore,
    })
      .then((result) => {
        setPreflightRunning(false);
        if (result.kind === "blocked") {
          dependencies.observability?.warn("preflight.blocked", {
            ...(operationId === undefined ? {} : { operationId }),
            reason: result.reason,
          });
          setSafetyOverride(result.reason);
          return;
        }
        dependencies.observability?.info("preflight.completed", {
          ...(operationId === undefined ? {} : { operationId }),
          selectedCount: result.plan.originallySelectedCount,
          eligibleCount: result.plan.eligibleConversationIds.length,
          excludedProjectCount: result.plan.excludedProjectIds.length,
          excludedProtectedCount: result.plan.excludedProtectedIds.length,
          missingCount:
            result.plan.missingConversationIds.length +
            result.plan.invalidSelectionCount,
        });
        if (result.plan.eligibleConversationIds.length === 0) {
          setNotice("No selected conversations remain eligible for deletion.");
          return;
        }
        setConfirmationText("");
        setPreflightPlan(result.plan);
      })
      .catch(() => {
        dependencies.observability?.error(
          "application.operation.failed",
          "UNEXPECTED_FAILURE",
          {
            ...(operationId === undefined ? {} : { operationId }),
            operation: "preflight",
          },
        );
        setPreflightRunning(false);
        setSafetyOverride("network");
      });
  };

  const handleRunStateChange = (nextState: DeletionRunState) => {
    setRunState(nextState);
    if (
      nextState.kind === "finished" ||
      nextState.kind === "stopped" ||
      nextState.kind === "blocked" ||
      nextState.kind === "fatal"
    ) {
      const fields = {
        ...(runOperationId.current === null
          ? {}
          : { operationId: runOperationId.current }),
        state: nextState.kind,
        total: nextState.progress.total,
        processedCount: nextState.progress.processed,
        deletedCount: nextState.progress.deleted,
        failedCount: nextState.progress.failed,
        skippedCount: nextState.progress.skipped,
        retryCount: nextState.progress.retries,
      };
      if (nextState.kind === "fatal") {
        dependencies?.observability?.error(
          "deletion.operation.failed",
          "SAFETY_BLOCKED",
          fields,
        );
      } else if (nextState.kind === "blocked") {
        dependencies?.observability?.warn("deletion.operation.blocked", fields);
      } else {
        dependencies?.observability?.info(
          "deletion.operation.completed",
          fields,
        );
      }
      runOperationId.current = null;
    }
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
      requestsPerMinute,
      gateway: dependencies.gateway,
      protectedConversationStore: dependencies.protectedConversationStore,
      clock: dependencies.clock,
      destructiveRunLock: dependencies.destructiveRunLock,
      onStateChange: handleRunStateChange,
    });
    setCurrentRun(deletionRun);
    runOperationId.current =
      dependencies.observability?.createOperationId() ?? null;
    dependencies.observability?.info("deletion.operation.started", {
      ...(runOperationId.current === null
        ? {}
        : { operationId: runOperationId.current }),
      total: confirmation.plan.confirmedConversationIds.length,
      configuredRate: requestsPerMinute,
    });
    setPreflightPlan(null);
    setConfirmationText("");
    deletionRun
      .startDeletion()
      .catch(() => setSafetyOverride("unexpected-run-error"));
  };

  const retryFailed = () => {
    if (dependencies !== null) {
      runOperationId.current =
        dependencies.observability?.createOperationId() ?? null;
      dependencies.observability?.info("deletion.retry.started", {
        ...(runOperationId.current === null
          ? {}
          : { operationId: runOperationId.current }),
        failedCount: runState?.progress.failedConversationIds.length ?? 0,
      });
    }
    currentRun
      ?.retryFailedDeletion()
      .catch(() => setSafetyOverride("unexpected-run-error"));
  };

  const resumeRun = () => {
    if (dependencies === null || currentRun === null) return;
    runOperationId.current =
      dependencies.observability?.createOperationId() ?? null;
    dependencies.observability?.info("deletion.resume.started", {
      ...(runOperationId.current === null
        ? {}
        : { operationId: runOperationId.current }),
      remainingCount: runState?.progress.remaining ?? 0,
    });
    currentRun.resumeDeletion();
  };

  const stopRun = () => {
    dependencies?.observability?.info("deletion.operation.stopRequested", {
      ...(runOperationId.current === null
        ? {}
        : { operationId: runOperationId.current }),
    });
    currentRun?.stopDeletion();
  };

  const currentConversationId =
    runState?.progress.currentConversationId ?? null;
  const currentConversationLabel =
    currentConversationId === null
      ? "None"
      : `${conversationTitles.get(currentConversationId) ?? "(Untitled)"} (${currentConversationId})`;

  return (
    <Space orientation="vertical" size="middle" className="manager-panel">
      {composition.mode === "demo" && (
        <>
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
                disabled={
                  runActive || preflightRunning || preflightPlan !== null
                }
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
        </>
      )}

      <SafetyStatus
        status={safetyStatus}
        blockedReason={blockedReason}
        {...(inventoryState.kind === "loading"
          ? { loadingStage: inventoryState.stage }
          : {})}
        {...(inventoryState.kind === "blocked"
          ? {
              readCompatibilityConfirmed:
                inventoryState.readCompatibilityConfirmed,
            }
          : {})}
        {...(safetyOverride === null &&
        inventoryState.kind === "blocked" &&
        inventoryState.diagnostic !== undefined
          ? { diagnostic: inventoryState.diagnostic }
          : {})}
      />

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
          <Spin />{" "}
          {inventoryState.stage === "compatibility"
            ? "Checking read API compatibility…"
            : inventoryState.stage === "inventory"
              ? `Inventory: Loading ${inventoryState.loadedConversationCount}`
              : `Inventory: Loaded ${inventoryState.loadedConversationCount}. Building Project protection…`}
        </Card>
      )}

      {inventoryState.kind === "ready" && (
        <>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}>
              <Card size="small" data-testid="standalone-summary">
                <Statistic
                  title="Standalone conversations"
                  value={conversations.length}
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small" data-testid="project-summary">
                <Statistic
                  title="Project conversations protected"
                  value={projectConversationCount}
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small" data-testid="protected-summary">
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

          <Card title="Conversation view and filters" size="small">
            <Space orientation="vertical" className="full-width">
              <Space wrap>
                <Typography.Text>View:</Typography.Text>
                <Segmented
                  aria-label="Conversation view"
                  value={conversationView}
                  options={[
                    {
                      label: "Standalone conversations",
                      value: "standalone",
                    },
                    {
                      label: "Project conversations",
                      value: "projects",
                    },
                  ]}
                  onChange={(value) =>
                    setConversationView(value as "standalone" | "projects")
                  }
                />
              </Space>
              <ConversationFiltersBar
                filters={
                  conversationView === "standalone" ? filters : projectFilters
                }
                onChange={updateFilters}
                currentDate={() =>
                  new Date(dependencies?.clock.now() ?? Date.now())
                }
              />
              {conversationView === "standalone" && (
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
              )}
            </Space>
          </Card>

          {conversationView === "standalone" && (
            <Card title="Selection" size="small">
              <Space wrap>
                <Button
                  disabled={selectionLocked}
                  onClick={() =>
                    setSelectedConversationIds(
                      selectAllMatching(
                        selectedConversationIds,
                        currentStandalonePageConversations,
                        protectedConversationIds,
                      ),
                    )
                  }
                >
                  Select current page
                </Button>
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
          )}

          {runState !== null && (
            <DeletionProgressPanel
              state={runState}
              currentConversationLabel={currentConversationLabel}
              onPause={() => currentRun?.pauseDeletion()}
              onResume={resumeRun}
              onStop={stopRun}
              onRetryFailed={retryFailed}
            />
          )}

          <ConversationTable
            view={conversationView}
            conversations={
              conversationView === "standalone"
                ? visibleConversations
                : visibleProjectConversations
            }
            protectedConversationIds={protectedConversationIds}
            selectedConversationIds={selectedConversationIds}
            selectionDisabled={selectionLocked}
            protectionDisabled={protectionLocked}
            sortField={
              conversationView === "standalone" ? sortField : projectSortField
            }
            sortDirection={
              conversationView === "standalone"
                ? sortDirection
                : projectSortDirection
            }
            page={conversationView === "standalone" ? page : projectPage}
            pageSize={
              conversationView === "standalone" ? pageSize : projectPageSize
            }
            onSelectionChange={setSelectedConversationIds}
            onProtect={handleProtect}
            onUnprotect={handleUnprotect}
            onOpen={(conversationId) => {
              composition.openConversation(conversationId);
              setNotice(
                composition.mode === "demo"
                  ? `Demo Open action: ${conversationId}`
                  : null,
              );
            }}
            onSort={(field, direction) => {
              if (conversationView === "projects") {
                setProjectSortField(field);
                setProjectSortDirection(direction);
                setProjectPage(1);
                return;
              }
              setSortField(field);
              setSortDirection(direction);
              setPage(1);
            }}
            onPageChange={(nextPage, nextPageSize) => {
              if (conversationView === "projects") {
                setProjectPage(nextPageSize === projectPageSize ? nextPage : 1);
                setProjectPageSize(nextPageSize);
                return;
              }
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
