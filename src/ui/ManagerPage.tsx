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
import { useMemo, useRef, useState } from "react";
import { AppConfig } from "../config";
import { saveProtectedConversationIds } from "../application/protection";
import { SerializedRequestsPerMinuteWriter } from "../application/settings";
import type {
  ManagerComposition,
  ManagerDependencies,
} from "../composition/types";
import {
  EMPTY_CONVERSATION_FILTERS,
  filterConversations,
  sortConversations,
  type ConversationFilters,
  type ConversationSortField,
  type SortDirection,
} from "../domain/conversation";
import {
  invertMatchingSelection,
  protectConversation,
  selectAllMatching,
} from "../domain/selection";
import { ConversationFiltersBar } from "./ConversationFilters";
import {
  CONVERSATION_TABLE_PAGINATION,
  clampTablePage,
  ConversationTable,
  type ConversationView,
} from "./ConversationTable";
import { DeletionConfirmationModal } from "./DeletionConfirmationModal";
import { DeletionProgressPanel } from "./DeletionProgressPanel";
import { SafetyStatus, type SafetyStatusState } from "./SafetyStatus";
import { useDeletionWorkflow } from "./useDeletionWorkflow";
import { useManagerInventory } from "./useManagerInventory";

interface ManagerPageProps {
  readonly composition: ManagerComposition;
}

export function ManagerPage({ composition }: ManagerPageProps) {
  const [conversationView, setConversationView] =
    useState<ConversationView>("standalone");
  const [scenarioId, setScenarioId] = useState(composition.initialScenarioId);
  const [dependencies, setDependencies] = useState<ManagerDependencies | null>(
    () => composition.createDependencies(composition.initialScenarioId),
  );
  const {
    inventoryState,
    conversations,
    projectConversations,
    conversationTitles,
    protectedConversationIds,
    requestsPerMinute,
    refreshing,
    refreshInventory,
    resetInventory,
    removeConversations,
    setProtectedConversationIds,
    setRequestsPerMinute,
  } = useManagerInventory(dependencies);
  const [selectedConversationIds, setSelectedConversationIds] = useState<
    ReadonlySet<string>
  >(new Set());
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
  const [pageSize, setPageSize] = useState<number>(
    CONVERSATION_TABLE_PAGINATION.defaultPageSize,
  );
  const [projectPage, setProjectPage] = useState(1);
  const [projectPageSize, setProjectPageSize] = useState<number>(
    CONVERSATION_TABLE_PAGINATION.defaultPageSize,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [protectionMutationPending, setProtectionMutationPending] =
    useState(false);
  const protectionMutationPendingRef = useRef(false);
  const rateWriter = useMemo(
    () =>
      dependencies === null
        ? null
        : new SerializedRequestsPerMinuteWriter(dependencies.settingsStore),
    [dependencies],
  );
  const projectConversationIds = useMemo(
    () => new Set(projectConversations.map(({ id }) => id)),
    [projectConversations],
  );
  const {
    previewPlan,
    runState,
    runActive,
    protectionLocked: protectionLockedByRun,
    safetyOverride,
    currentConversationId,
    beginDeletionPreview,
    confirmAndStartDeletion,
    retryFailed,
    resumeRun,
    pauseRun,
    stopRun,
    cancelConfirmation,
    resetWorkflow,
    blockSafety,
  } = useDeletionWorkflow({
    dependencies,
    inventoryReady: inventoryState.kind === "ready" && !refreshing,
    standaloneConversations: conversations,
    projectConversationIds,
    protectedConversationIds,
    selectedConversationIds,
    requestsPerMinute,
    isProtectionMutationPending: () => protectionMutationPendingRef.current,
    onConversationRemoved: (removedId) => {
      removeConversations(new Set([removedId]));
      setSelectedConversationIds(
        (currentSelection) =>
          new Set(
            [...currentSelection].filter(
              (conversationId) => conversationId !== removedId,
            ),
          ),
      );
    },
    onNotice: setNotice,
  });

  const filteredConversations = useMemo(
    () => filterConversations(conversations, filters),
    [conversations, filters],
  );
  const visibleConversations = useMemo(
    () => sortConversations(filteredConversations, sortField, sortDirection),
    [filteredConversations, sortDirection, sortField],
  );
  const visibleStandalonePage = clampTablePage(
    page,
    visibleConversations.length,
    pageSize,
  );
  const currentStandalonePageConversations = useMemo(
    () =>
      visibleConversations.slice(
        (visibleStandalonePage - 1) * pageSize,
        visibleStandalonePage * pageSize,
      ),
    [pageSize, visibleConversations, visibleStandalonePage],
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
  const visibleProjectPage = clampTablePage(
    projectPage,
    visibleProjectConversations.length,
    projectPageSize,
  );
  const selectionLocked = runActive || refreshing;
  const protectionLocked = protectionLockedByRun || protectionMutationPending;
  const safetyState: SafetyStatusState = (() => {
    if (inventoryState.kind === "loading") {
      return { kind: "loading", stage: inventoryState.stage };
    }
    if (safetyOverride !== null) {
      return {
        kind: "blocked",
        reason: safetyOverride,
        readCompatibilityConfirmed: inventoryState.kind === "ready",
      };
    }
    if (inventoryState.kind === "blocked") {
      return {
        kind: "blocked",
        reason: inventoryState.reason,
        readCompatibilityConfirmed: inventoryState.readCompatibilityConfirmed,
        ...(inventoryState.diagnostic === undefined
          ? {}
          : { diagnostic: inventoryState.diagnostic }),
      };
    }
    return { kind: "ready" };
  })();

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
    if (
      runActive ||
      refreshing ||
      previewPlan !== null ||
      protectionMutationPendingRef.current
    ) {
      return;
    }
    const nextDependencies = composition.createDependencies(nextScenarioId);
    setScenarioId(nextScenarioId);
    setDependencies(nextDependencies);
    resetInventory(nextDependencies !== null);
    setSelectedConversationIds(new Set());
    resetWorkflow();
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
    if (dependencies === null || protectionMutationPendingRef.current) return;
    protectionMutationPendingRef.current = true;
    setProtectionMutationPending(true);
    saveProtectedConversationIds({
      protectedConversationIds: nextProtectedIds,
      protectedConversationStore: dependencies.protectedConversationStore,
      destructiveRunLock: dependencies.destructiveRunLock,
      currentRunOwnsLock: runState?.kind === "paused",
    })
      .then((result) => {
        if (result === "locked") {
          blockSafety("destructive-run-lock");
          return;
        }
        setProtectedConversationIds(nextProtectedIds);
        setSelectedConversationIds(nextSelection);
      })
      .catch(() => blockSafety("protected-storage"))
      .finally(() => {
        protectionMutationPendingRef.current = false;
        setProtectionMutationPending(false);
      });
  };

  const handleProtect = (conversationId: string) => {
    if (protectionLocked || protectionMutationPendingRef.current) return;
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
    if (protectionLocked || protectionMutationPendingRef.current) return;
    const nextProtectedIds = new Set(protectedConversationIds);
    nextProtectedIds.delete(conversationId);
    persistProtection(nextProtectedIds, selectedConversationIds);
  };

  const handleRateChange = (value: number | null) => {
    if (rateWriter === null || value === null || runActive) return;
    rateWriter
      .save(value)
      .then((saved) => {
        if (saved) setRequestsPerMinute(value);
      })
      .catch(() => setNotice("Could not save the deletion rate."));
  };

  const handleRefresh = () => {
    if (runActive || refreshing || protectionMutationPendingRef.current) {
      return;
    }
    setNotice(null);
    refreshInventory()
      .then((refreshed) => {
        if (!refreshed) {
          setNotice("Refresh failed. The previous inventory is still active.");
          return;
        }
        setSelectedConversationIds(new Set());
        cancelConfirmation();
        setNotice("Inventory refreshed.");
      })
      .catch(() =>
        setNotice("Refresh failed. The previous inventory is still active."),
      );
  };

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
                disabled={runActive || refreshing || protectionMutationPending}
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

      <SafetyStatus state={safetyState} />

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
          <Card size="small">
            <Space>
              <Button
                aria-label="Refresh inventory"
                disabled={runActive || refreshing || protectionMutationPending}
                onClick={handleRefresh}
              >
                Refresh
              </Button>
              {refreshing && (
                <Typography.Text type="secondary">
                  <Spin size="small" /> Refreshing inventory…
                </Typography.Text>
              )}
            </Space>
          </Card>

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
                  value={projectConversations.length}
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
                  onChange={(value) => {
                    if (value === "standalone" || value === "projects") {
                      setConversationView(value);
                    }
                  }}
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
                    min={AppConfig.deletion.requestsPerMinute.min}
                    max={AppConfig.deletion.requestsPerMinute.max}
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
                    safetyState.kind !== "ready"
                  }
                  onClick={beginDeletionPreview}
                >
                  Delete selected ({selectedConversationIds.size})
                </Button>
              </Space>
            </Card>
          )}

          {runState !== null && (
            <DeletionProgressPanel
              state={runState}
              currentConversationLabel={currentConversationLabel}
              onPause={pauseRun}
              onResume={resumeRun}
              resumeDisabled={protectionMutationPending}
              onStop={stopRun}
              onRetryFailed={retryFailed}
            />
          )}

          {conversationView === "standalone" ? (
            <ConversationTable
              view="standalone"
              conversations={visibleConversations}
              protectedConversationIds={protectedConversationIds}
              selectedConversationIds={selectedConversationIds}
              selectionDisabled={selectionLocked}
              protectionDisabled={protectionLocked}
              sortField={sortField}
              sortDirection={sortDirection}
              page={visibleStandalonePage}
              pageSize={pageSize}
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
                setSortField(field);
                setSortDirection(direction);
                setPage(1);
              }}
              onPageChange={(nextPage, nextPageSize) => {
                setPage(nextPageSize === pageSize ? nextPage : 1);
                setPageSize(nextPageSize);
              }}
            />
          ) : (
            <ConversationTable
              view="projects"
              conversations={visibleProjectConversations}
              sortField={projectSortField}
              sortDirection={projectSortDirection}
              page={visibleProjectPage}
              pageSize={projectPageSize}
              onOpen={(conversationId) => {
                composition.openConversation(conversationId);
                setNotice(
                  composition.mode === "demo"
                    ? `Demo Open action: ${conversationId}`
                    : null,
                );
              }}
              onSort={(field, direction) => {
                setProjectSortField(field);
                setProjectSortDirection(direction);
                setProjectPage(1);
              }}
              onPageChange={(nextPage, nextPageSize) => {
                setProjectPage(nextPageSize === projectPageSize ? nextPage : 1);
                setProjectPageSize(nextPageSize);
              }}
            />
          )}
        </>
      )}

      {previewPlan !== null && (
        <DeletionConfirmationModal
          plan={previewPlan}
          disabled={refreshing}
          onCancel={cancelConfirmation}
          onConfirm={confirmAndStartDeletion}
        />
      )}
    </Space>
  );
}
