import { Button, Space, Table, Tag, Typography, type TableProps } from "antd";
import type {
  Conversation,
  ConversationSortField,
  SortDirection,
} from "../domain/conversation";

export interface ConversationTableProps {
  readonly view: "standalone" | "projects";
  readonly conversations: readonly Conversation[];
  readonly protectedConversationIds: ReadonlySet<string>;
  readonly selectedConversationIds: ReadonlySet<string>;
  readonly selectionDisabled: boolean;
  readonly protectionDisabled: boolean;
  readonly sortField: ConversationSortField;
  readonly sortDirection: SortDirection;
  readonly page: number;
  readonly pageSize: number;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
  readonly onProtect: (conversationId: string) => void;
  readonly onUnprotect: (conversationId: string) => void;
  readonly onOpen: (conversationId: string) => void;
  readonly onSort: (
    field: ConversationSortField,
    direction: SortDirection,
  ) => void;
  readonly onPageChange: (page: number, pageSize: number) => void;
}

function formatDate(timestamp: number | null): string {
  if (timestamp === null) return "Unknown";
  return new Date(timestamp).toLocaleString();
}

export function ConversationTable({
  view,
  conversations,
  protectedConversationIds,
  selectedConversationIds,
  selectionDisabled,
  protectionDisabled,
  sortField,
  sortDirection,
  page,
  pageSize,
  onSelectionChange,
  onProtect,
  onUnprotect,
  onOpen,
  onSort,
  onPageChange,
}: ConversationTableProps) {
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
        return protectedConversationIds.has(conversation.id) ? (
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
        const protectedConversation = protectedConversationIds.has(
          conversation.id,
        );
        return (
          <Space>
            <Button size="small" onClick={() => onOpen(conversation.id)}>
              Open
            </Button>
            {view === "standalone" && (
              <Button
                size="small"
                disabled={protectionDisabled}
                onClick={() =>
                  protectedConversation
                    ? onUnprotect(conversation.id)
                    : onProtect(conversation.id)
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
        dataSource={[...conversations]}
        columns={columns}
        onChange={handleChange}
        {...(view === "standalone"
          ? {
              rowSelection: {
                type: "checkbox",
                columnTitle: "Selection",
                hideSelectAll: true,
                selectedRowKeys: [...selectedConversationIds],
                preserveSelectedRowKeys: true,
                getCheckboxProps: (conversation) => ({
                  disabled:
                    selectionDisabled ||
                    protectedConversationIds.has(conversation.id),
                  "aria-label": `Select ${conversation.title}`,
                }),
                onChange: (selectedRowKeys) => {
                  onSelectionChange(
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
          defaultPageSize: 50,
          pageSizeOptions: [25, 50, 100],
          showSizeChanger: true,
          showTotal: (total) => `${total} conversations`,
        }}
        scroll={{ x: 980 }}
      />
    </div>
  );
}
