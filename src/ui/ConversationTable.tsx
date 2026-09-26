import { Button, Space, Table, Tag, Typography, type TableProps } from "antd";
import type {
  Conversation,
  ConversationSortField,
  SortDirection,
} from "../domain/conversation";

export type ConversationView = "standalone" | "projects";

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
  readonly onSort: (
    field: ConversationSortField,
    direction: SortDirection,
  ) => void;
  readonly onPageChange: (page: number, pageSize: number) => void;
}

interface StandaloneConversationTableProps extends CommonConversationTableProps {
  readonly view: Extract<ConversationView, "standalone">;
  readonly protectedConversationIds: ReadonlySet<string>;
  readonly selectedConversationIds: ReadonlySet<string>;
  readonly selectionDisabled: boolean;
  readonly protectionDisabled: boolean;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
  readonly onProtect: (conversationId: string) => void;
  readonly onUnprotect: (conversationId: string) => void;
}

interface ProjectConversationTableProps extends CommonConversationTableProps {
  readonly view: Extract<ConversationView, "projects">;
  readonly protectedConversationIds?: never;
  readonly selectedConversationIds?: never;
  readonly selectionDisabled?: never;
  readonly protectionDisabled?: never;
  readonly onSelectionChange?: never;
  readonly onProtect?: never;
  readonly onUnprotect?: never;
}

type ConversationTableProps =
  StandaloneConversationTableProps | ProjectConversationTableProps;

function formatDate(timestamp: number | null): string {
  if (timestamp === null) return "Unknown";
  return new Date(timestamp).toLocaleString();
}

export function clampTablePage(
  requestedPage: number,
  recordCount: number,
  pageSize: number,
): number {
  const lastPage = Math.max(1, Math.ceil(recordCount / pageSize));
  return Math.min(Math.max(1, requestedPage), lastPage);
}

export function ConversationTable(props: ConversationTableProps) {
  const {
    view,
    conversations,
    sortField,
    sortDirection,
    page,
    pageSize,
    onOpen,
    onSort,
    onPageChange,
  } = props;
  const columns: TableProps<Conversation>["columns"] = [
    {
      title: "Title",
      dataIndex: "title",
      key: "title",
      sorter: true,
      sortOrder:
        sortField === "title"
          ? sortDirection === "ascending"
            ? "ascend"
            : "descend"
          : null,
    },
    {
      title: "Created",
      dataIndex: "createdAt",
      key: "createdAt",
      sorter: true,
      sortOrder:
        sortField === "createdAt"
          ? sortDirection === "ascending"
            ? "ascend"
            : "descend"
          : null,
      render: (timestamp: number | null) => formatDate(timestamp),
    },
    {
      title: "Updated",
      dataIndex: "updatedAt",
      key: "updatedAt",
      sorter: true,
      sortOrder:
        sortField === "updatedAt"
          ? sortDirection === "ascending"
            ? "ascend"
            : "descend"
          : null,
      render: (timestamp: number | null) => formatDate(timestamp),
    },
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      render: (id: string) => <Typography.Text code>{id}</Typography.Text>,
    },
    {
      title: "Protection/status",
      key: "protection",
      render: (_, conversation) => {
        if (view === "projects") {
          return <Tag color="blue">Project protected</Tag>;
        }
        return props.protectedConversationIds.has(conversation.id) ? (
          <Tag color="blue">Protected</Tag>
        ) : (
          <Tag>Unprotected</Tag>
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      render: (_, conversation) => {
        const protectedConversation =
          view === "standalone" &&
          props.protectedConversationIds.has(conversation.id);
        return (
          <Space>
            <Button size="small" onClick={() => onOpen(conversation.id)}>
              Open
            </Button>
            {view === "standalone" && (
              <Button
                size="small"
                disabled={props.protectionDisabled}
                onClick={() =>
                  protectedConversation
                    ? props.onUnprotect(conversation.id)
                    : props.onProtect(conversation.id)
                }
              >
                {protectedConversation ? "Unprotect" : "Protect"}
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  const handleChange: TableProps<Conversation>["onChange"] = (
    pagination,
    _filters,
    sorter,
    extra,
  ) => {
    if (extra.action === "paginate") {
      onPageChange(pagination.current ?? 1, pagination.pageSize ?? pageSize);
      return;
    }

    if (Array.isArray(sorter) || sorter.order === undefined) return;
    if (
      sorter.columnKey !== "title" &&
      sorter.columnKey !== "createdAt" &&
      sorter.columnKey !== "updatedAt"
    ) {
      return;
    }
    onSort(
      sorter.columnKey,
      sorter.order === "ascend" ? "ascending" : "descending",
    );
  };

  return (
    <div data-testid="conversation-table">
      <Table<Conversation>
        aria-label={
          view === "standalone"
            ? "Standalone conversations"
            : "Project conversations"
        }
        rowKey="id"
        dataSource={conversations}
        columns={columns}
        sortDirections={["ascend", "descend", "ascend"]}
        onChange={handleChange}
        {...(view === "standalone"
          ? {
              rowSelection: {
                type: "checkbox",
                columnTitle: "Selection",
                hideSelectAll: true,
                selectedRowKeys: [...props.selectedConversationIds],
                preserveSelectedRowKeys: true,
                getCheckboxProps: (conversation) => ({
                  disabled:
                    props.selectionDisabled ||
                    props.protectedConversationIds.has(conversation.id),
                  "aria-label": `Select ${conversation.title}`,
                }),
                onChange: (selectedRowKeys) => {
                  props.onSelectionChange(
                    new Set(
                      selectedRowKeys.filter(
                        (key): key is string => typeof key === "string",
                      ),
                    ),
                  );
                },
              },
            }
          : {})}
        pagination={{
          current: page,
          pageSize,
          defaultPageSize: CONVERSATION_TABLE_PAGINATION.defaultPageSize,
          pageSizeOptions: [...CONVERSATION_TABLE_PAGINATION.pageSizeOptions],
          showSizeChanger: true,
          showTotal: (total) => `${total} conversations`,
        }}
        scroll={{ x: 980 }}
      />
    </div>
  );
}
