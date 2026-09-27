import {
  CheckSquareOutlined,
  DeleteOutlined,
  FilterOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  LockOutlined,
  MessageOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Flex,
  InputNumber,
  Row,
  Segmented,
  Space,
  Spin,
  Statistic,
  theme,
  Tooltip,
  Typography,
} from "antd";
import { useMemo, useRef, useState } from "react";
import { AppConfig } from "../config";
import type { ThemePreference } from "../application/themePreference";
import {
  mutateProtectedConversationIds,
  type ProtectionMutation,
} from "../application/protection";
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
import { ManagerHeader } from "./ManagerHeader";
import { SafetyStatus, type SafetyStatusState } from "./SafetyStatus";
import { useDeletionWorkflow } from "./useDeletionWorkflow";
import { useManagerInventory } from "./useManagerInventory";

interface ManagerPageProps {
  readonly mode: ManagerComposition["mode"];
  readonly dependencies: ManagerDependencies;
  readonly themePreference?: ThemePreference;
  readonly themePreferencePending?: boolean;
  readonly onThemePreferenceChange?: (preference: ThemePreference) => void;
  readonly openConversation: ManagerComposition["openConversation"];
}

function loadedConversationCountLabel(count: number): string {
  return `${count} ${count === 1 ? "conversation" : "conversations"} loaded`;
}

export function ManagerPage({
  mode,
  dependencies,
  themePreference = "auto",
  themePreferencePending = false,
  onThemePreferenceChange = () => undefined,
  openConversation,
}: ManagerPageProps) {
  const { token } = theme.useToken();
  const [conversationView, setConversationView] =
    useState<ConversationView>("standalone");
  const {
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
    () => new SerializedRequestsPerMinuteWriter(dependencies.settingsStore),
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
    protectionMutationLockOwner,
    safetyOverride,
    currentConversationId,
    beginDeletionPreview,
    confirmAndStartDeletion,
    retryFailed,
    resumeRun,
    pauseRun,
    stopRun,
    cancelConfirmation,
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
      removeConversation(removedId);
      setSelectedConversationIds((currentSelection) => {
        const nextSelection = new Set(currentSelection);
        nextSelection.delete(removedId);
        return nextSelection;
      });
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
  const eligibleSelectedConversationIds = useMemo(
    () =>
      new Set(
        conversations
          .filter(
            ({ id }) =>
              selectedConversationIds.has(id) &&
              !protectedConversationIds.has(id),
          )
          .map(({ id }) => id),
      ),
    [conversations, protectedConversationIds, selectedConversationIds],
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

  const persistProtection = (mutation: ProtectionMutation) => {
    if (protectionMutationPendingRef.current) return;
    protectionMutationPendingRef.current = true;
    setProtectionMutationPending(true);
    mutateProtectedConversationIds({
      mutation,
      protectedConversationStore: dependencies.protectedConversationStore,
      destructiveRunLock: dependencies.destructiveRunLock,
      currentRunLockOwner: protectionMutationLockOwner,
    })
      .then((result) => {
        if (result.kind === "locked") {
          blockSafety("destructive-run-lock");
          return;
        }
        setProtectedConversationIds(result.protectedConversationIds);
        if (mutation.kind === "protect") {
          setSelectedConversationIds(
            (currentSelection) =>
              new Set(
                [...currentSelection].filter(
                  (conversationId) =>
                    !result.protectedConversationIds.has(conversationId),
                ),
              ),
          );
        }
      })
      .catch(() => blockSafety("protected-storage"))
      .finally(() => {
        protectionMutationPendingRef.current = false;
        setProtectionMutationPending(false);
      });
  };

  const handleProtect = (conversationId: string) => {
    if (protectionLocked || protectionMutationPendingRef.current) return;
    persistProtection({
      kind: "protect",
      conversationIds: new Set([conversationId]),
    });
  };

  const handleProtectSelected = () => {
    if (
      conversationView !== "standalone" ||
      protectionLocked ||
      protectionMutationPendingRef.current ||
      eligibleSelectedConversationIds.size === 0
    ) {
      return;
    }
    persistProtection({
      kind: "protect",
      conversationIds: eligibleSelectedConversationIds,
    });
  };

  const handleUnprotect = (conversationId: string) => {
    if (protectionLocked || protectionMutationPendingRef.current) return;
    persistProtection({ kind: "unprotect", conversationId });
  };

  const handleRateChange = (value: number | null) => {
    if (value === null || runActive) return;
    rateWriter
      .save(value)
      .then((saved) => {
        if (saved) setRequestsPerMinute(value);
      })
      .catch(() => setNotice("Could not save the deletion rate."));
  };

  const handleOpenConversation = (conversationId: string) => {
    openConversation(conversationId);
    setNotice(mode === "demo" ? `Demo Open action: ${conversationId}` : null);
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
      <ManagerHeader
        themePreference={themePreference}
        themePreferencePending={themePreferencePending}
        onThemePreferenceChange={onThemePreferenceChange}
      >
        <Button
          aria-label="Refresh inventory"
          icon={<ReloadOutlined aria-hidden />}
          disabled={
            inventoryState.kind !== "ready" ||
            runActive ||
            refreshing ||
            protectionMutationPending
          }
          onClick={handleRefresh}
        >
          Refresh
        </Button>
        {refreshing && (
          <Typography.Text type="secondary">
            <Spin size="small" /> Refreshing inventory…
          </Typography.Text>
        )}
      </ManagerHeader>

      {mode === "demo" && (
        <Alert
          type="success"
          showIcon
          title="Demo mode"
          description="Deterministic fake infrastructure is active. No request can reach ChatGPT and no real DELETE can be issued."
        />
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
              ? `Loading conversations… ${loadedConversationCountLabel(inventoryState.loadedConversationCount)}`
              : `${loadedConversationCountLabel(inventoryState.loadedConversationCount)}. Building Project protection…`}
        </Card>
      )}

      {inventoryState.kind === "ready" && (
        <Card
          title={
            <Space size={token.marginXS}>
              <MessageOutlined
                aria-hidden
                style={{ color: token.colorPrimary }}
              />
              <span>Conversations</span>
            </Space>
          }
          size="small"
        >
          <Row
            gutter={[token.marginLG, token.marginSM]}
            style={{
              padding: token.paddingSM,
              background: token.colorFillAlter,
              borderRadius: token.borderRadiusLG,
            }}
          >
            <Col xs={12} md={6}>
              <Statistic
                data-testid="standalone-summary"
                title={
                  <Space size={token.marginXS}>
                    <MessageOutlined
                      aria-hidden
                      style={{ color: token.colorPrimary, opacity: 0.65 }}
                    />
                    <span>Standalone conversations</span>
                  </Space>
                }
                value={conversations.length}
                styles={{
                  content: {
                    color: token.colorPrimary,
                    fontSize: token.fontSizeHeading3,
                  },
                }}
              />
            </Col>
            <Col xs={12} md={6}>
              <Statistic
                data-testid="project-summary"
                title={
                  <Space size={token.marginXS}>
                    <FolderOpenOutlined
                      aria-hidden
                      style={{ color: token.colorPrimary, opacity: 0.65 }}
                    />
                    <span>Project conversations protected</span>
                  </Space>
                }
                value={projectConversations.length}
                styles={{
                  content: {
                    color: token.colorPrimary,
                    fontSize: token.fontSizeHeading3,
                  },
                }}
              />
            </Col>
            <Col xs={12} md={6}>
              <Statistic
                data-testid="protected-summary"
                title={
                  <Space size={token.marginXS}>
                    <SafetyCertificateOutlined
                      aria-hidden
                      style={{ color: token.colorPrimary, opacity: 0.65 }}
                    />
                    <span>User protected</span>
                  </Space>
                }
                value={protectedConversationIds.size}
                styles={{
                  content: {
                    color: token.colorPrimary,
                    fontSize: token.fontSizeHeading3,
                  },
                }}
              />
            </Col>
            <Col xs={12} md={6}>
              <Statistic
                data-testid="selected-count"
                title={
                  <Space size={token.marginXS}>
                    <CheckSquareOutlined
                      aria-hidden
                      style={{ color: token.colorPrimary, opacity: 0.65 }}
                    />
                    <span>Selected</span>
                  </Space>
                }
                value={selectedConversationIds.size}
                styles={{
                  content: {
                    color: token.colorPrimary,
                    fontSize: token.fontSizeHeading3,
                  },
                }}
              />
            </Col>
          </Row>

          <Divider style={{ marginBlock: token.marginMD }} />
          <Space
            orientation="vertical"
            size={token.marginMD}
            className="full-width"
          >
            <Flex justify="space-between" align="center" wrap gap="small">
              <Space wrap>
                <Typography.Text>View:</Typography.Text>
                <Segmented
                  className="view-segmented"
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
              {conversationView === "standalone" && (
                <Space>
                  <Space size={token.marginXXS}>
                    <Typography.Text>Delete rate</Typography.Text>
                    <Tooltip
                      title="Maximum DELETE requests sent per minute during a deletion run."
                      trigger={["hover", "focus"]}
                    >
                      <span
                        aria-label="About Delete rate"
                        tabIndex={0}
                        style={{
                          color: token.colorTextTertiary,
                          display: "inline-flex",
                          fontSize: token.fontSizeSM,
                        }}
                      >
                        <InfoCircleOutlined aria-hidden />
                      </span>
                    </Tooltip>
                  </Space>
                  <InputNumber
                    aria-label="Delete rate"
                    min={AppConfig.deletion.requestsPerMinute.min}
                    max={AppConfig.deletion.requestsPerMinute.max}
                    precision={0}
                    style={{ width: 128 }}
                    suffix="/ min"
                    value={requestsPerMinute}
                    disabled={runActive}
                    onChange={handleRateChange}
                  />
                </Space>
              )}
            </Flex>
            <div>
              <Typography.Title
                level={5}
                style={{ marginTop: 0, marginBottom: token.marginXS }}
              >
                <Space size={token.marginXS}>
                  <FilterOutlined
                    aria-hidden
                    style={{ color: token.colorPrimary }}
                  />
                  <span>Filters</span>
                </Space>
              </Typography.Title>
              <ConversationFiltersBar
                filters={
                  conversationView === "standalone" ? filters : projectFilters
                }
                onChange={updateFilters}
                currentDate={() => new Date(dependencies.clock.now())}
              />
            </div>
          </Space>
          <Divider style={{ marginBlock: token.marginMD }} />
          <Space
            orientation="vertical"
            size={token.marginSM}
            className="full-width"
          >
            <Typography.Title level={5} style={{ margin: 0 }}>
              <Space size={token.marginXS}>
                <CheckSquareOutlined
                  aria-hidden
                  style={{ color: token.colorPrimary }}
                />
                <span>Selection</span>
              </Space>
            </Typography.Title>
            <Flex justify="space-between" align="center" wrap gap="small">
              <Space wrap>
                <Button
                  disabled={conversationView === "projects" || selectionLocked}
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
                  disabled={conversationView === "projects" || selectionLocked}
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
                  disabled={conversationView === "projects" || selectionLocked}
                  onClick={() => setSelectedConversationIds(new Set())}
                >
                  Clear selection
                </Button>
                <Button
                  disabled={conversationView === "projects" || selectionLocked}
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
              </Space>
              <Space wrap>
                <Button
                  icon={<LockOutlined aria-hidden />}
                  disabled={
                    conversationView === "projects" ||
                    protectionLocked ||
                    eligibleSelectedConversationIds.size === 0
                  }
                  onClick={handleProtectSelected}
                >
                  Protect selected
                </Button>
                <Button
                  danger
                  type="primary"
                  icon={<DeleteOutlined aria-hidden />}
                  disabled={
                    conversationView === "projects" ||
                    selectionLocked ||
                    selectedConversationIds.size === 0 ||
                    safetyState.kind !== "ready"
                  }
                  onClick={beginDeletionPreview}
                >
                  Delete selected ({selectedConversationIds.size})
                </Button>
              </Space>
            </Flex>
          </Space>

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

          <Divider style={{ marginBlock: token.marginMD }} />
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
              onOpen={handleOpenConversation}
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
              onOpen={handleOpenConversation}
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
        </Card>
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
