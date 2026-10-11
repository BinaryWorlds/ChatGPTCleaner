import type {
  Conversation,
  ConversationSortField,
  SortDirection,
} from "domain/conversation";

export type ConversationView = "standalone" | "projects";
export type ProtectionFilter = "protected" | "unprotected" | null;

export const CONVERSATION_TABLE_PAGINATION = {
  defaultPageSize: 50,
  pageSizeOptions: [25, 50, 100],
} as const;

interface CommonConversationTableProps {
  readonly conversations: readonly Conversation[];
  readonly sortField: ConversationSortField;
  readonly sortDirection: SortDirection;
  readonly page: number;
  readonly pageSize: number;
  readonly onOpen: (conversationId: string) => void;
  readonly onCopyId: (conversationId: string) => Promise<void>;
  readonly onSort: (
    field: ConversationSortField,
    direction: SortDirection,
  ) => void;
  readonly onPageChange: (page: number, pageSize: number) => void;
}

interface StandaloneConversationTableProps extends CommonConversationTableProps {
  readonly view: "standalone";
  readonly protectedConversationIds: ReadonlySet<string>;
  readonly selectedConversationIds: ReadonlySet<string>;
  readonly selectionDisabled: boolean;
  readonly protectionDisabled: boolean;
  readonly protectionFilter: ProtectionFilter;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
  readonly onProtectionFilterChange: (filter: ProtectionFilter) => void;
  readonly onProtect: (conversationId: string) => void;
  readonly onUnprotect: (conversationId: string) => void;
}

interface ProjectConversationTableProps extends CommonConversationTableProps {
  readonly view: "projects";
  readonly protectedConversationIds?: never;
  readonly selectedConversationIds?: never;
  readonly selectionDisabled?: never;
  readonly protectionDisabled?: never;
  readonly protectionFilter?: never;
  readonly onSelectionChange?: never;
  readonly onProtectionFilterChange?: never;
  readonly onProtect?: never;
  readonly onUnprotect?: never;
}

export type ConversationTableProps =
  StandaloneConversationTableProps | ProjectConversationTableProps;

export function clampTablePage(
  requestedPage: number,
  recordCount: number,
  pageSize: number,
): number {
  const lastPage = Math.max(1, Math.ceil(recordCount / pageSize));
  return Math.min(Math.max(1, requestedPage), lastPage);
}
