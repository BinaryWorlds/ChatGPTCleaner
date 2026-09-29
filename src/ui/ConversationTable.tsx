import {
  CheckOutlined,
  CopyOutlined,
  LockFilled,
  UnlockOutlined,
} from "@ant-design/icons";
import { Button, Space, Table, theme, Tooltip, type TableProps } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Conversation,
  ConversationSortField,
  SortDirection,
} from "../domain/conversation";

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
  const { token } = theme.useToken();
  const [copyFeedback, setCopyFeedback] = useState<{
    readonly conversationId: string;
    readonly kind: "copied" | "failed";
  } | null>(null);
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
    onCopyId,
    onSort,
    onPageChange,
  } = props;
  const columns: TableProps<Conversation>["columns"] = [
    {
      title: t("table.protectionStatus"),
      key: "protection",
      width: 100,
      align: "center",
      ...(view === "standalone"
        ? {
            filters: [
              { text: t("table.protected"), value: "protected" },
              { text: t("table.unprotected"), value: "unprotected" },
            ],
            filterMultiple: false,
            filteredValue:
              props.protectionFilter === null ? null : [props.protectionFilter],
          }
        : {}),
      render: (_, conversation) => {
        if (view === "projects") {
          return (
            <Tooltip title={t("table.projectProtectedTooltip")}>
              <span
                className="protection-icon protection-icon-protected"
                aria-label={t("table.projectProtected")}
              >
                <LockFilled aria-hidden />
              </span>
            </Tooltip>
          );
        }
        const protectedConversation = props.protectedConversationIds.has(
          conversation.id,
        );
        const label = protectedConversation
          ? t("table.protectedTooltip")
          : t("table.unprotectedTooltip");
        return (
          <Tooltip title={label}>
            {protectedConversation ? (
              <span
                className="protection-icon protection-icon-protected"
                aria-label={label}
              >
                <LockFilled aria-hidden />
              </span>
            ) : (
              <span
                className="protection-icon protection-icon-unprotected"
                aria-label={label}
              >
                <UnlockOutlined aria-hidden />
              </span>
            )}
          </Tooltip>
        );
      },
    },
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
      render: (title: string) => (
        <span className="conversation-title">{title}</span>
      ),
    },
    {
      title: t("table.created"),
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      sorter: true,
      sortOrder:
        sortField === "createdAt"
          ? sortDirection === "ascending"
            ? "ascend"
            : "descend"
          : null,
      render: (timestamp: number | null) => (
        <span className="conversation-date">{formatDate(timestamp)}</span>
      ),
    },
    {
      title: t("table.updated"),
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      sorter: true,
      sortOrder:
        sortField === "updatedAt"
          ? sortDirection === "ascending"
            ? "ascend"
            : "descend"
          : null,
      render: (timestamp: number | null) => (
        <span className="conversation-date">{formatDate(timestamp)}</span>
      ),
    },
    {
      title: t("table.actions"),
      key: "actions",
      width: 250,
      render: (_, conversation) => {
        const protectedConversation =
          view === "standalone" &&
          props.protectedConversationIds.has(conversation.id);
        const copyLabel = t("table.copyId", { id: conversation.id });
        const currentCopyFeedback =
          copyFeedback?.conversationId === conversation.id
            ? copyFeedback.kind
            : null;
        const copyFeedbackLabel =
          currentCopyFeedback === "copied"
            ? t("table.copySuccess")
            : currentCopyFeedback === "failed"
              ? t("table.copyFailure")
              : copyLabel;
        return (
          <Space size="small">
            <Tooltip title={copyFeedbackLabel}>
              <Button
                type="text"
                aria-label={copyFeedbackLabel}
                icon={
                  currentCopyFeedback === "copied" ? (
                    <CheckOutlined
                      aria-hidden
                      style={{ color: token.colorSuccess }}
                    />
                  ) : (
                    <CopyOutlined aria-hidden />
                  )
                }
                size="small"
                onClick={() => {
                  onCopyId(conversation.id)
                    .then(() =>
                      setCopyFeedback({
                        conversationId: conversation.id,
                        kind: "copied",
                      }),
                    )
                    .catch(() =>
                      setCopyFeedback({
                        conversationId: conversation.id,
                        kind: "failed",
                      }),
                    );
                }}
              />
            </Tooltip>
            <Button
              type="text"
              size="small"
              onClick={() => onOpen(conversation.id)}
            >
              {t("table.open")}
            </Button>
            {view === "standalone" && (
              <Button
                type="text"
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
    tableFilters,
    sorter,
    extra,
  ) => {
    if (extra.action === "filter" && view === "standalone") {
      const protectionValue = tableFilters.protection?.[0];
      props.onProtectionFilterChange(
        protectionValue === "protected" || protectionValue === "unprotected"
          ? protectionValue
          : null,
      );
      return;
    }
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
        tableLayout="fixed"
        sortDirections={["ascend", "descend", "ascend"]}
        onChange={handleChange}
        {...(view === "standalone"
          ? {
              rowSelection: {
                type: "checkbox",
                columnTitle: null,
                columnWidth: 44,
                hideSelectAll: true,
                selectedRowKeys: [...props.selectedConversationIds],
                preserveSelectedRowKeys: true,
                getCheckboxProps: (conversation) => ({
                  disabled: props.selectionDisabled,
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
        scroll={{ x: 1050 }}
      />
    </div>
  );
}
