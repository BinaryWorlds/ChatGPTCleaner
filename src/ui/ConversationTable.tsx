import { Button, Space, Table, Tag, Typography, type TableProps } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
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

export function clampTablePage(
  requestedPage: number,
  recordCount: number,
  pageSize: number,
): number {
  const lastPage = Math.max(1, Math.ceil(recordCount / pageSize));
  return Math.min(Math.max(1, requestedPage), lastPage);
}

export function ConversationTable(props: ConversationTableProps) {
  const { t, i18n } = useTranslation();
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        dateStyle: "short",
        timeStyle: "medium",
      }),
    [i18n.resolvedLanguage],
  );
  const formatDate = (timestamp: number | null): string => {
    if (timestamp === null) return t("table.unknownDate");
    return dateTimeFormatter.format(timestamp);
  };
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
      title: t("table.title"),
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
      title: t("table.created"),
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
      title: t("table.updated"),
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
      title: t("table.id"),
      dataIndex: "id",
      key: "id",
      render: (id: string) => <Typography.Text code>{id}</Typography.Text>,
    },
    {
      title: t("table.protectionStatus"),
      key: "protection",
      render: (_, conversation) => {
        if (view === "projects") {
          return (
            <Tag color="blue" variant="filled">
              {t("table.projectProtected")}
            </Tag>
          );
        }
        return props.protectedConversationIds.has(conversation.id) ? (
          <Tag color="blue" variant="filled">
            {t("table.protected")}
          </Tag>
        ) : (
          <Tag variant="filled">{t("table.unprotected")}</Tag>
        );
      },
    },
    {
      title: t("table.actions"),
      key: "actions",
      render: (_, conversation) => {
        const protectedConversation =
          view === "standalone" &&
          props.protectedConversationIds.has(conversation.id);
        return (
          <Space>
            <Button size="small" onClick={() => onOpen(conversation.id)}>
              {t("table.open")}
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
                {protectedConversation
                  ? t("table.unprotect")
                  : t("table.protect")}
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
          view === "standalone" ? t("view.standalone") : t("view.projects")
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
                columnTitle: t("selection.title"),
                hideSelectAll: true,
                selectedRowKeys: [...props.selectedConversationIds],
                preserveSelectedRowKeys: true,
                getCheckboxProps: (conversation) => ({
                  disabled:
                    props.selectionDisabled ||
                    props.protectedConversationIds.has(conversation.id),
                  "aria-label": t("table.selectConversation", {
                    title: conversation.title,
                  }),
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
          showTotal: (total) => t("table.total", { count: total }),
        }}
        scroll={{ x: 980 }}
      />
    </div>
  );
}
