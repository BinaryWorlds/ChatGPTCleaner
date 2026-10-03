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
  UnlockOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Flex,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Space,
  Spin,
  Statistic,
  theme,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppConfig } from "../config";
import type { ThemePreference } from "../application/themePreference";
import { isSafetyOverrideRevalidatedByCompleteRefresh } from "../application/SafetyBlockReason";
import type { SourceTabLifecycle } from "../application/ports/SourceTabLifecycle";
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
import { useConversationSelection } from "./useConversationSelection";
import { useDeletionWorkflow } from "./useDeletionWorkflow";
import { useManagerInventory } from "./useManagerInventory";

interface ManagerPageProps {
  readonly mode: ManagerComposition["mode"];
  readonly dependencies: ManagerDependencies;
  readonly themePreference?: ThemePreference;
  readonly themePreferencePending?: boolean;
  readonly onThemePreferenceChange?: (preference: ThemePreference) => void;
  readonly openConversation: ManagerComposition["openConversation"];
  readonly copyConversationId: ManagerComposition["copyConversationId"];
  readonly sourceTabLifecycle?: SourceTabLifecycle;
}

export function ManagerPage({
  mode,
  dependencies,
  themePreference = "auto",
  themePreferencePending = false,
  onThemePreferenceChange = () => undefined,
  openConversation,
  copyConversationId,
  sourceTabLifecycle,
}: ManagerPageProps) {
  const { t } = useTranslation();
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
    hasAcceptedSnapshot,
    isRefreshPending,
    refreshInventory,
    retryInitialInventory,
    removeConversation,
    setProtectedConversationIds,
    setRequestsPerMinute,
  } = useManagerInventory(dependencies);
  const [sourceLost, setSourceLost] = useState(false);
  const {
    selectedConversationIds,
    replaceSelection,
    selectCurrentPage,
    selectAllMatching,
    invertMatchingSelection,
    clearSelection,
    removeFromSelection,
  } = useConversationSelection();
  const [filters, setFilters] = useState<ConversationFilters>(
    EMPTY_CONVERSATION_FILTERS,
  );
  const [projectFilters, setProjectFilters] = useState<ConversationFilters>(
    EMPTY_CONVERSATION_FILTERS,
  );
  const [protectionFilter, setProtectionFilter] = useState<
    "protected" | "unprotected" | null
  >(null);
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
  const [pendingBulkUnprotectIds, setPendingBulkUnprotectIds] =
    useState<ReadonlySet<string> | null>(null);
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
    runOwnsWorkflow,
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
    recoverSafetyAfterCompleteRefresh,
    blockSafety,
  } = useDeletionWorkflow({
    dependencies,
    inventoryReady:
      inventoryState.kind === "ready" && !refreshing && !sourceLost,
    standaloneConversations: conversations,
    projectConversationIds,
    protectedConversationIds,
    selectedConversationIds,
    requestsPerMinute,
    isProtectionMutationPending: () => protectionMutationPendingRef.current,
    onConversationRemoved: (removedId) => {
      removeConversation(removedId);
      removeFromSelection([removedId]);
    },
    onNotice: setNotice,
    onOperationAttempt: () => setNotice(null),
    onOperationLockConflict: () => setNotice(t("operation.lockConflict")),
  });

  useEffect(() => {
    if (
      sourceTabLifecycle === undefined ||
      !hasAcceptedSnapshot ||
      sourceLost
    ) {
      return;
    }
    let current = true;
    const validateSource = () => {
      sourceTabLifecycle.validate().then(
        (result) => {
          if (current && result.kind === "invalid") setSourceLost(true);
        },
        () => {
          if (current) setSourceLost(true);
        },
      );
    };
    const unsubscribe = sourceTabLifecycle.subscribe(validateSource);
    const validateVisibleSource = () => {
      if (document.visibilityState === "visible") validateSource();
    };
    window.addEventListener("focus", validateSource);
    document.addEventListener("visibilitychange", validateVisibleSource);
    return () => {
      current = false;
      unsubscribe();
      window.removeEventListener("focus", validateSource);
      document.removeEventListener("visibilitychange", validateVisibleSource);
    };
  }, [hasAcceptedSnapshot, sourceLost, sourceTabLifecycle]);

  useEffect(() => {
    if (
      sourceLost ||
      inventoryState.kind === "blocked" ||
      safetyOverride !== null
    ) {
      cancelConfirmation();
    }
  }, [cancelConfirmation, inventoryState.kind, safetyOverride, sourceLost]);

  const filteredConversations = useMemo(
    () => filterConversations(conversations, filters),
    [conversations, filters],
  );
  const protectionFilteredConversations = useMemo(() => {
    if (protectionFilter === null) return filteredConversations;
    const showProtected = protectionFilter === "protected";
    return filteredConversations.filter(
      ({ id }) => protectedConversationIds.has(id) === showProtected,
    );
  }, [filteredConversations, protectedConversationIds, protectionFilter]);
  const visibleConversations = useMemo(
    () =>
      sortConversations(
        protectionFilteredConversations,
        sortField,
        sortDirection,
      ),
    [protectionFilteredConversations, sortDirection, sortField],
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
  const protectedSelectedConversationIds = useMemo(
    () =>
      new Set(
        conversations
          .filter(
            ({ id }) =>
              selectedConversationIds.has(id) &&
              protectedConversationIds.has(id),
          )
          .map(({ id }) => id),
      ),
    [conversations, protectedConversationIds, selectedConversationIds],
  );
  const selectionLocked = runOwnsWorkflow || refreshing;
  const protectionLocked =
    runOwnsWorkflow || protectionMutationPending || refreshing;
  const safetyState: SafetyStatusState = (() => {
    if (sourceLost) return { kind: "blocked", reason: "source-unavailable" };
    if (inventoryState.kind === "loading") {
      return { kind: "loading", stage: inventoryState.stage };
    }
    if (safetyOverride !== null) {
      return {
        kind: "blocked",
        reason: safetyOverride,
      };
    }
    if (inventoryState.kind === "blocked") {
      if (
        inventoryState.reason === "source-unavailable" &&
        !hasAcceptedSnapshot
      ) {
        return { kind: "unbound" };
      }
      return { kind: "blocked", reason: inventoryState.reason };
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
    if (protectionMutationPendingRef.current || isRefreshPending()) return;
    setNotice(null);
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
          setNotice(t("operation.lockConflict"));
          return;
        }
        setProtectedConversationIds(result.protectedConversationIds);
      })
      .catch(() => blockSafety("protected-storage"))
      .finally(() => {
        protectionMutationPendingRef.current = false;
        setProtectionMutationPending(false);
      });
  };

  const handleProtect = (conversationId: string) => {
    if (
      protectionLocked ||
      protectionMutationPendingRef.current ||
      isRefreshPending()
    ) {
      return;
    }
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

  const handleUnprotect = (conversationId: string) => {
    if (
      protectionLocked ||
      protectionMutationPendingRef.current ||
      isRefreshPending()
    ) {
      return;
    }
    persistProtection({
      kind: "unprotect",
      conversationIds: new Set([conversationId]),
    });
  };

  const handleUnprotectSelected = () => {
    if (
      conversationView !== "standalone" ||
      protectionLocked ||
      protectionMutationPendingRef.current ||
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

  const handleRateChange = (value: number | null) => {
    if (value === null || runActive) return;
    rateWriter
      .save(value)
      .then((saved) => {
        if (saved) setRequestsPerMinute(value);
      })
      .catch(() => setNotice(t("rate.saveFailure")));
  };

  const handleOpenConversation = (conversationId: string) => {
    openConversation(conversationId);
    setNotice(
      mode === "demo" ? t("demo.openAction", { id: conversationId }) : null,
    );
  };

  const handleRefresh = () => {
    if (
      runOwnsWorkflow ||
      isRefreshPending() ||
      protectionMutationPendingRef.current
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

  const currentConversationLabel =
    currentConversationId === null
      ? t("deletion.none")
      : `${conversationTitles.get(currentConversationId) ?? t("deletion.untitled")} (${currentConversationId})`;
  const inventoryLoadingText =
    inventoryState.kind !== "loading"
      ? null
      : inventoryState.stage === "compatibility"
        ? t("inventory.checkingCompatibility")
        : inventoryState.stage === "inventory"
          ? t("inventory.loading", {
              count: inventoryState.loadedConversationCount,
            })
          : t("inventory.buildingProtection", {
              count: inventoryState.loadedConversationCount,
            });

  return (
    <div className="manager-panel">
      <ManagerHeader
        themePreference={themePreference}
        themePreferencePending={themePreferencePending}
        onThemePreferenceChange={onThemePreferenceChange}
        status={
          refreshing ? (
            <Flex align="center" gap="small" role="status">
              <Spin size="small" />
              <Typography.Text type="secondary">
                {t("refresh.loading")}
              </Typography.Text>
            </Flex>
          ) : null
        }
      >
        <Button
          aria-label={t("refresh.ariaLabel")}
          icon={<ReloadOutlined aria-hidden />}
          disabled={
            (!hasAcceptedSnapshot && inventoryState.kind !== "ready") ||
            runOwnsWorkflow ||
            refreshing ||
            protectionMutationPending
          }
          onClick={handleRefresh}
        >
          {t("refresh.button")}
        </Button>
      </ManagerHeader>

      {mode === "demo" && (
        <Alert
          type="success"
          showIcon
          title={t("demo.title")}
          description={t("demo.description")}
        />
      )}

      <SafetyStatus
        state={safetyState}
        operationState={runState}
        onRetry={hasAcceptedSnapshot ? handleRefresh : retryInitialInventory}
        onRetryFailed={retryFailed}
        onStop={stopRun}
      />

      {notice !== null && safetyState.kind !== "blocked" && (
        <Alert
          closable
          type="info"
          title={notice}
          onClose={() => setNotice(null)}
        />
      )}

      {inventoryState.kind === "loading" && (
        <div className="inventory-loading-surface">
          <Flex align="center" gap="small" role="status">
            <Spin size="small" />
            <span>{inventoryLoadingText}</span>
          </Flex>
          <div className="inventory-loading-track" aria-hidden />
        </div>
      )}

      {hasAcceptedSnapshot && (
        <Card
          className="workspace-card"
          title={
            <Space size={token.marginXS}>
              <MessageOutlined
                aria-hidden
                style={{ color: token.colorPrimary }}
              />
              <span>{t("summary.title")}</span>
            </Space>
          }
          size="small"
        >
          <Row
            className="summary-metrics"
            gutter={[token.marginLG, token.marginSM]}
          >
            <Col className="summary-metric" xs={12} md={6}>
              <Statistic
                data-testid="standalone-summary"
                title={
                  <Space size={token.marginXS}>
                    <MessageOutlined aria-hidden />
                    <span>{t("summary.standalone")}</span>
                  </Space>
                }
                value={conversations.length}
              />
            </Col>
            <Col className="summary-metric" xs={12} md={6}>
              <Statistic
                data-testid="project-summary"
                title={
                  <Space size={token.marginXS}>
                    <FolderOpenOutlined aria-hidden />
                    <span>{t("summary.projectProtected")}</span>
                  </Space>
                }
                value={projectConversations.length}
              />
            </Col>
            <Col className="summary-metric" xs={12} md={6}>
              <Statistic
                data-testid="protected-summary"
                title={
                  <Space size={token.marginXS}>
                    <SafetyCertificateOutlined aria-hidden />
                    <span>{t("summary.userProtected")}</span>
                  </Space>
                }
                value={protectedConversationIds.size}
              />
            </Col>
            <Col
              className={`summary-metric${selectedConversationIds.size > 0 ? " summary-metric-selected" : ""}`}
              xs={12}
              md={6}
            >
              <Statistic
                data-testid="selected-count"
                title={
                  <Space size={token.marginXS}>
                    <CheckSquareOutlined aria-hidden />
                    <span>{t("summary.selected")}</span>
                  </Space>
                }
                value={selectedConversationIds.size}
              />
            </Col>
          </Row>

          <Divider style={{ marginBlock: token.marginMD }} />
          <Space
            orientation="vertical"
            size={token.marginMD}
            className="full-width"
          >
            <Flex
              className="workspace-toolbar"
              justify="space-between"
              align="center"
              wrap
              gap="small"
            >
              <Flex
                className="view-control-group"
                align="center"
                wrap
                gap="small"
              >
                <Typography.Text>{t("view.label")}</Typography.Text>
                <Segmented
                  className="view-segmented"
                  aria-label={t("view.ariaLabel")}
                  value={conversationView}
                  options={[
                    {
                      label: t("view.standalone"),
                      value: "standalone",
                    },
                    {
                      label: t("view.projects"),
                      value: "projects",
                    },
                  ]}
                  onChange={(value) => {
                    if (value === "standalone" || value === "projects") {
                      setConversationView(value);
                    }
                  }}
                />
              </Flex>
              {conversationView === "standalone" && (
                <Flex className="delete-rate-group" align="center" gap="small">
                  <Space size={token.marginXXS}>
                    <Typography.Text>{t("rate.label")}</Typography.Text>
                    <Tooltip
                      title={t("rate.tooltip")}
                      trigger={["hover", "focus"]}
                    >
                      <span
                        aria-label={t("rate.ariaHelp")}
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
                    aria-label={t("rate.label")}
                    min={AppConfig.deletion.requestsPerMinute.min}
                    max={AppConfig.deletion.requestsPerMinute.max}
                    precision={0}
                    style={{ width: 128 }}
                    suffix={t("rate.unit")}
                    value={requestsPerMinute}
                    disabled={runActive}
                    onChange={handleRateChange}
                  />
                </Flex>
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
                  <span>{t("filters.title")}</span>
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
          <section aria-labelledby="selection-heading">
            <Space
              orientation="vertical"
              size={token.marginSM}
              className="full-width"
            >
              <Typography.Title
                id="selection-heading"
                level={5}
                style={{ margin: 0 }}
              >
                <Space size={token.marginXS}>
                  <CheckSquareOutlined
                    aria-hidden
                    style={{ color: token.colorPrimary }}
                  />
                  <span>{t("selection.title")}</span>
                </Space>
              </Typography.Title>
              <div className="selection-toolbar">
                <Flex className="selection-controls" wrap gap="small">
                  <Button
                    disabled={
                      conversationView === "projects" || selectionLocked
                    }
                    onClick={() =>
                      selectCurrentPage(
                        currentStandalonePageConversations.map(({ id }) => id),
                      )
                    }
                  >
                    {t("selection.currentPage")}
                  </Button>
                  <Tooltip
                    title={t("selection.allMatchingHelp")}
                    trigger={["hover", "focus"]}
                  >
                    <Button
                      disabled={
                        conversationView === "projects" || selectionLocked
                      }
                      onClick={() =>
                        selectAllMatching(
                          protectionFilteredConversations.map(({ id }) => id),
                        )
                      }
                    >
                      {t("selection.allMatching")}
                    </Button>
                  </Tooltip>
                  <Button
                    disabled={
                      conversationView === "projects" || selectionLocked
                    }
                    onClick={() =>
                      invertMatchingSelection(
                        protectionFilteredConversations.map(({ id }) => id),
                      )
                    }
                  >
                    {t("selection.invert")}
                  </Button>
                  <Button
                    disabled={
                      conversationView === "projects" || selectionLocked
                    }
                    onClick={clearSelection}
                  >
                    {t("selection.clear")}
                  </Button>
                </Flex>
                <Typography.Text
                  className="selection-summary"
                  strong
                  data-testid="selection-summary"
                >
                  {t("selection.summary", {
                    count: selectedConversationIds.size,
                  })}
                </Typography.Text>
                <Flex className="selection-primary-actions" wrap gap="small">
                  <Button
                    icon={<LockOutlined aria-hidden />}
                    disabled={
                      conversationView === "projects" ||
                      protectionLocked ||
                      eligibleSelectedConversationIds.size === 0
                    }
                    onClick={handleProtectSelected}
                  >
                    {t("selection.protectSelected", {
                      count: eligibleSelectedConversationIds.size,
                    })}
                  </Button>
                  <Button
                    icon={<UnlockOutlined aria-hidden />}
                    disabled={
                      conversationView === "projects" ||
                      protectionLocked ||
                      protectedSelectedConversationIds.size === 0
                    }
                    onClick={handleUnprotectSelected}
                  >
                    {t("selection.unprotectSelected", {
                      count: protectedSelectedConversationIds.size,
                    })}
                  </Button>
                  <Button
                    danger
                    type="primary"
                    icon={<DeleteOutlined aria-hidden />}
                    disabled={
                      conversationView === "projects" ||
                      selectionLocked ||
                      eligibleSelectedConversationIds.size === 0 ||
                      safetyState.kind !== "ready"
                    }
                    onClick={beginDeletionPreview}
                  >
                    {t("selection.deleteSelected", {
                      count: eligibleSelectedConversationIds.size,
                    })}
                  </Button>
                </Flex>
              </div>
            </Space>
          </section>

          {runState !== null && (
            <>
              <Divider style={{ marginBlock: token.marginMD }} />
              <section
                className="deletion-operation"
                aria-labelledby="deletion-operation-heading"
              >
                <Space
                  orientation="vertical"
                  size={token.marginSM}
                  className="full-width"
                >
                  <Typography.Title
                    id="deletion-operation-heading"
                    level={5}
                    style={{ margin: 0 }}
                  >
                    <Space size={token.marginXS}>
                      <DeleteOutlined
                        aria-hidden
                        style={{ color: token.colorPrimary }}
                      />
                      <span>{t("deletion.operationTitle")}</span>
                    </Space>
                  </Typography.Title>
                  <DeletionProgressPanel
                    state={runState}
                    currentConversationLabel={currentConversationLabel}
                    onPause={pauseRun}
                    onResume={resumeRun}
                    resumeDisabled={protectionMutationPending}
                    onStop={stopRun}
                    onRetryFailed={retryFailed}
                  />
                </Space>
              </section>
            </>
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
              protectionFilter={protectionFilter}
              sortField={sortField}
              sortDirection={sortDirection}
              page={visibleStandalonePage}
              pageSize={pageSize}
              onSelectionChange={replaceSelection}
              onProtectionFilterChange={(nextFilter) => {
                setProtectionFilter(nextFilter);
                setPage(1);
              }}
              onProtect={handleProtect}
              onUnprotect={handleUnprotect}
              onOpen={handleOpenConversation}
              onCopyId={copyConversationId}
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
              onCopyId={copyConversationId}
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
      {pendingBulkUnprotectIds !== null && (
        <Modal
          open
          title={t("unprotectConfirmation.title", {
            count: pendingBulkUnprotectIds.size,
          })}
          okText={t("unprotectConfirmation.confirm", {
            count: pendingBulkUnprotectIds.size,
          })}
          cancelText={t("common.cancel")}
          okButtonProps={{ disabled: protectionLocked }}
          onCancel={() => setPendingBulkUnprotectIds(null)}
          onOk={() => {
            const requestedIds = pendingBulkUnprotectIds;
            setPendingBulkUnprotectIds(null);
            persistProtection({
              kind: "unprotect",
              conversationIds: requestedIds,
            });
          }}
        >
          <Typography.Paragraph>
            {t("unprotectConfirmation.description")}
          </Typography.Paragraph>
        </Modal>
      )}
    </div>
  );
}
