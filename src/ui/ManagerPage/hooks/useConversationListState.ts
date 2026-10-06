import { useMemo, useState } from "react";
import {
  EMPTY_CONVERSATION_FILTERS,
  filterConversations,
  sortConversations,
  type Conversation,
  type ConversationFilters,
  type ConversationSortField,
  type SortDirection,
} from "../../../domain/conversation";
import {
  CONVERSATION_TABLE_PAGINATION,
  clampTablePage,
  type ConversationView,
  type ProtectionFilter,
} from "../ConversationTable/conversationTableContract";
import { useConversationSelection } from "./useConversationSelection";

interface UseConversationListStateOptions {
  readonly conversations: readonly Conversation[];
  readonly projectConversations: readonly Conversation[];
  readonly protectedConversationIds: ReadonlySet<string>;
}

export function useConversationListState({
  conversations,
  projectConversations,
  protectedConversationIds,
}: UseConversationListStateOptions) {
  const [conversationView, setConversationView] =
    useState<ConversationView>("standalone");
  const [filters, setFilters] = useState<ConversationFilters>(
    EMPTY_CONVERSATION_FILTERS,
  );
  const [projectFilters, setProjectFilters] = useState<ConversationFilters>(
    EMPTY_CONVERSATION_FILTERS,
  );
  const [protectionFilter, setProtectionFilter] =
    useState<ProtectionFilter>(null);
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
  const {
    selectedConversationIds,
    replaceSelection,
    selectCurrentPage,
    selectAllMatching,
    invertMatchingSelection,
    clearSelection,
    removeFromSelection,
  } = useConversationSelection();

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

  const updateFilters = (nextFilters: ConversationFilters) => {
    if (conversationView === "projects") {
      setProjectFilters(nextFilters);
      setProjectPage(1);
      return;
    }
    setFilters(nextFilters);
    setPage(1);
  };

  return {
    conversationView,
    setConversationView,
    activeFilters: conversationView === "standalone" ? filters : projectFilters,
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
    selectCurrentPage: () =>
      selectCurrentPage(currentStandalonePageConversations.map(({ id }) => id)),
    selectAllMatching: () =>
      selectAllMatching(protectionFilteredConversations.map(({ id }) => id)),
    invertMatchingSelection: () =>
      invertMatchingSelection(
        protectionFilteredConversations.map(({ id }) => id),
      ),
    updateProtectionFilter: (nextFilter: ProtectionFilter) => {
      setProtectionFilter(nextFilter);
      setPage(1);
    },
    updateStandaloneSort: (
      field: ConversationSortField,
      direction: SortDirection,
    ) => {
      setSortField(field);
      setSortDirection(direction);
      setPage(1);
    },
    updateProjectSort: (
      field: ConversationSortField,
      direction: SortDirection,
    ) => {
      setProjectSortField(field);
      setProjectSortDirection(direction);
      setProjectPage(1);
    },
    updateStandalonePage: (nextPage: number, nextPageSize: number) => {
      setPage(nextPageSize === pageSize ? nextPage : 1);
      setPageSize(nextPageSize);
    },
    updateProjectPage: (nextPage: number, nextPageSize: number) => {
      setProjectPage(nextPageSize === projectPageSize ? nextPage : 1);
      setProjectPageSize(nextPageSize);
    },
  } as const;
}
