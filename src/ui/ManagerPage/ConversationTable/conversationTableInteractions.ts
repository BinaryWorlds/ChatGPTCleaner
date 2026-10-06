import type { TableProps } from "antd";
import type { Key } from "react";
import type { Conversation } from "../../../domain/conversation";
import type { ConversationTableProps } from "./conversationTableContract";

export function createConversationTableChangeHandler(
  props: ConversationTableProps,
): NonNullable<TableProps<Conversation>["onChange"]> {
  return (pagination, tableFilters, sorter, extra) => {
    if (extra.action === "filter" && props.view === "standalone") {
      const protectionValue = tableFilters.protection?.[0];
      props.onProtectionFilterChange(
        protectionValue === "protected" || protectionValue === "unprotected"
          ? protectionValue
          : null,
      );
      return;
    }
    if (extra.action === "paginate") {
      props.onPageChange(
        pagination.current ?? 1,
        pagination.pageSize ?? props.pageSize,
      );
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
    props.onSort(
      sorter.columnKey,
      sorter.order === "ascend" ? "ascending" : "descending",
    );
  };
}

export function selectedConversationIdsFromRowKeys(
  selectedRowKeys: Key[],
): ReadonlySet<string> {
  return new Set(
    selectedRowKeys.filter(
      (selectedRowKey): selectedRowKey is string =>
        typeof selectedRowKey === "string",
    ),
  );
}
