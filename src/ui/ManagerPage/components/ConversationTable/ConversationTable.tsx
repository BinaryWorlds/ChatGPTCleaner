import { Table } from "antd";
import type { Key } from "react";
import { useTranslation } from "react-i18next";
import type { Conversation } from "domain/conversation";
import {
  CONVERSATION_TABLE_PAGINATION,
  type ConversationTableProps,
} from "./conversationTableContract";
import {
  createConversationTableChangeHandler,
  selectedConversationIdsFromRowKeys,
} from "./conversationTableInteractions";
import {
  useConversationTableColumns,
  useCopyConversationIdFeedback,
} from "./hooks";

export default function ConversationTable(props: ConversationTableProps) {
  const { t } = useTranslation();
  const { copyConversationId, copyFeedbackFor } = useCopyConversationIdFeedback(
    props.onCopyId,
  );
  const columns = useConversationTableColumns(
    props,
    copyConversationId,
    copyFeedbackFor,
  );
  const handleChange = createConversationTableChangeHandler(props);

  return (
    <div data-testid="conversation-table">
      <Table<Conversation>
        aria-label={
          props.view === "standalone"
            ? t("view.standalone")
            : t("view.projects")
        }
        rowKey="id"
        dataSource={props.conversations}
        columns={columns}
        tableLayout="fixed"
        sortDirections={["ascend", "descend", "ascend"]}
        onChange={handleChange}
        {...(props.view === "standalone"
          ? {
              rowSelection: {
                type: "checkbox" as const,
                columnTitle: null,
                columnWidth: 44,
                hideSelectAll: true,
                selectedRowKeys: [...props.selectedConversationIds],
                preserveSelectedRowKeys: true,
                getCheckboxProps: (conversation: Conversation) => ({
                  disabled: props.selectionDisabled,
                  "aria-label": t("table.selectConversation", {
                    title: conversation.title,
                  }),
                }),
                onChange: (selectedRowKeys: Key[]) => {
                  props.onSelectionChange(
                    selectedConversationIdsFromRowKeys(selectedRowKeys),
                  );
                },
              },
            }
          : {})}
        pagination={{
          current: props.page,
          pageSize: props.pageSize,
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
