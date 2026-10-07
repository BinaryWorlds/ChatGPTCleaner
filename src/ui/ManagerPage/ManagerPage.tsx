import {
  FilterOutlined,
  MessageOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Divider,
  Flex,
  Space,
  Spin,
  theme,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ThemePreference } from "../../application/themePreference";
import type { SourceTabLifecycle } from "../../application/ports/SourceTabLifecycle";
import type {
  ManagerComposition,
  ManagerDependencies,
} from "../../composition/types";
import ConversationFiltersBar from "./ConversationFiltersBar";
import DeletionConfirmationModal from "../DeletionConfirmationModal";
import ManagerHeader from "../ManagerHeader";
import SafetyStatus, { type SafetyStatusState } from "../SafetyStatus";
import BulkUnprotectConfirmationModal from "./BulkUnprotectConfirmationModal";
import ConversationSelectionToolbar from "./ConversationSelectionToolbar";
import ConversationSummary from "./ConversationSummary";
import ConversationTable from "./ConversationTable";
import ConversationViewToolbar from "./ConversationViewToolbar";
import DeletionRunSection from "./DeletionRunSection";
import { useConversationListState } from "./hooks/useConversationListState";
import { useConversationProtection } from "./hooks/useConversationProtection";
import { useDeletionRateSetting } from "./hooks/useDeletionRateSetting";
import { useDeletionWorkflow } from "./hooks/useDeletionWorkflow";
import { useManagerInventory } from "./hooks/useManagerInventory";
import { useManagerRefresh } from "./hooks/useManagerRefresh";
import { useSourceTabAvailability } from "./hooks/useSourceTabAvailability";
import InventoryLoadingState from "./InventoryLoadingState";

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

export default function ManagerPage({
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
  const sourceLost = useSourceTabAvailability({
    sourceTabLifecycle,
    hasAcceptedSnapshot,
  });
  const {
    conversationView,
    setConversationView,
    activeFilters,
    updateFilters,
    protectionFilter,
    sortField,
    sortDirection,
    projectSortField,
    projectSortDirection,
    pageSize,
    projectPageSize,
    visibleConversations,
    visibleProjectConversations,
    visibleStandalonePage,
    visibleProjectPage,
    selectedConversationIds,
    eligibleSelectedConversationIds,
    protectedSelectedConversationIds,
    replaceSelection,
    clearSelection,
    removeFromSelection,
    selectCurrentPage,
    selectAllMatching,
    invertMatchingSelection,
    updateProtectionFilter,
    updateStandaloneSort,
    updateProjectSort,
    updateStandalonePage,
    updateProjectPage,
  } = useConversationListState({
    conversations,
    projectConversations,
    protectedConversationIds,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const protectionMutationPendingRef = useRef(false);
  const isProtectionMutationPending = () =>
    protectionMutationPendingRef.current;
  const projectConversationIds = useMemo(
    () => new Set(projectConversations.map(({ id }) => id)),
    [projectConversations],
  );
  const {
    previewPlan,
    runState,
    runActive,
    runOwnsWorkflow,
    retryFailedAvailable,
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
    isProtectionMutationPending,
    onConversationRemoved: (removedId) => {
      removeConversation(removedId);
      removeFromSelection([removedId]);
    },
    onNotice: setNotice,
    onOperationAttempt: () => setNotice(null),
    onOperationLockConflict: () => setNotice(t("operation.lockConflict")),
  });

  const {
    mutationPending: protectionMutationPending,
    pendingBulkUnprotectIds,
    protectionLocked,
    protectConversation,
    protectSelectedConversations,
    unprotectConversation,
    requestUnprotectSelectedConversations,
    cancelBulkUnprotect,
    confirmBulkUnprotect,
  } = useConversationProtection({
    dependencies,
    conversationView,
    runOwnsWorkflow,
    refreshing,
    isRefreshPending,
    mutationPendingRef: protectionMutationPendingRef,
    mutationLockOwner: protectionMutationLockOwner,
    eligibleSelectedConversationIds,
    protectedSelectedConversationIds,
    setProtectedConversationIds,
    blockSafety,
    setNotice,
  });

  useEffect(() => {
    if (
      sourceLost ||
      inventoryState.kind === "blocked" ||
      safetyOverride !== null
    ) {
      cancelConfirmation();
    }
  }, [cancelConfirmation, inventoryState.kind, safetyOverride, sourceLost]);

  const selectionLocked = runOwnsWorkflow || refreshing;
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

  const handleRateChange = useDeletionRateSetting({
    dependencies,
    runActive,
    setRequestsPerMinute,
    setNotice,
  });

  const handleOpenConversation = (conversationId: string) => {
    openConversation(conversationId);
    setNotice(
      mode === "demo" ? t("demo.openAction", { id: conversationId }) : null,
    );
  };

  const handleRefresh = useManagerRefresh({
    runOwnsWorkflow,
    isRefreshPending,
    isProtectionMutationPending,
    refreshInventory,
    recoverSafetyAfterCompleteRefresh,
    clearSelection,
    cancelConfirmation,
    safetyOverride,
    setNotice,
  });

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
        <InventoryLoadingState text={inventoryLoadingText} />
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
          <ConversationSummary
            standaloneCount={conversations.length}
            projectCount={projectConversations.length}
            protectedCount={protectedConversationIds.size}
            selectedCount={selectedConversationIds.size}
          />

          <Divider style={{ marginBlock: token.marginMD }} />
          <Space
            orientation="vertical"
            size={token.marginMD}
            className="full-width"
          >
            <ConversationViewToolbar
              conversationView={conversationView}
              requestsPerMinute={requestsPerMinute}
              rateControlDisabled={runActive}
              onConversationViewChange={setConversationView}
              onRateChange={handleRateChange}
            />
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
                filters={activeFilters}
                onChange={updateFilters}
                currentDate={() => new Date(dependencies.clock.now())}
              />
            </div>
          </Space>
          <Divider style={{ marginBlock: token.marginMD }} />
          <ConversationSelectionToolbar
            selectedCount={selectedConversationIds.size}
            protectableCount={eligibleSelectedConversationIds.size}
            unprotectableCount={protectedSelectedConversationIds.size}
            selectionActionsDisabled={
              conversationView === "projects" || selectionLocked
            }
            protectDisabled={
              conversationView === "projects" ||
              protectionLocked ||
              eligibleSelectedConversationIds.size === 0
            }
            unprotectDisabled={
              conversationView === "projects" ||
              protectionLocked ||
              protectedSelectedConversationIds.size === 0
            }
            deleteDisabled={
              conversationView === "projects" ||
              selectionLocked ||
              eligibleSelectedConversationIds.size === 0 ||
              safetyState.kind !== "ready"
            }
            onSelectCurrentPage={selectCurrentPage}
            onSelectAllMatching={selectAllMatching}
            onInvertMatchingSelection={invertMatchingSelection}
            onClearSelection={clearSelection}
            onProtect={protectSelectedConversations}
            onUnprotect={requestUnprotectSelectedConversations}
            onDelete={beginDeletionPreview}
          />

          {runState !== null && (
            <>
              <Divider style={{ marginBlock: token.marginMD }} />
              <DeletionRunSection
                state={runState}
                currentConversationLabel={currentConversationLabel}
                resumeDisabled={protectionMutationPending}
                retryFailedDisabled={!retryFailedAvailable}
                onPause={pauseRun}
                onResume={resumeRun}
                onStop={stopRun}
                onRetryFailed={retryFailed}
              />
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
              onProtectionFilterChange={updateProtectionFilter}
              onProtect={protectConversation}
              onUnprotect={unprotectConversation}
              onOpen={handleOpenConversation}
              onCopyId={copyConversationId}
              onSort={updateStandaloneSort}
              onPageChange={updateStandalonePage}
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
              onSort={updateProjectSort}
              onPageChange={updateProjectPage}
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
        <BulkUnprotectConfirmationModal
          conversationIds={pendingBulkUnprotectIds}
          confirmDisabled={protectionLocked}
          onCancel={cancelBulkUnprotect}
          onConfirm={confirmBulkUnprotect}
        />
      )}
    </div>
  );
}
