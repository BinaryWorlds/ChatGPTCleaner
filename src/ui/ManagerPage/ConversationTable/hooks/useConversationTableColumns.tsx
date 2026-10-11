import type { TableProps } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Conversation } from "../../../../domain/conversation";
import ConversationProtectionStatus from "../ConversationProtectionStatus";
import ConversationRowActions from "../ConversationRowActions";
import type { ConversationTableProps } from "../conversationTableContract";
import type { CopyConversationIdFeedback } from "../copyConversationIdFeedback";

const NO_PROTECTED_CONVERSATIONS: ReadonlySet<string> = new Set();
const ignoreProtectionAction = () => undefined;

export function useConversationTableColumns(
  props: ConversationTableProps,
  copyConversationId: (conversationId: string) => void,
  copyFeedbackFor: (conversationId: string) => CopyConversationIdFeedback,
): NonNullable<TableProps<Conversation>["columns"]> {
  const { t, i18n } = useTranslation();
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        dateStyle: "short",
        timeStyle: "medium",
      }),
    [i18n.resolvedLanguage],
  );
  const { view, sortField, sortDirection, onOpen } = props;
  const protectedConversationIds =
    props.view === "standalone"
      ? props.protectedConversationIds
      : NO_PROTECTED_CONVERSATIONS;
  const protectionDisabled =
    props.view === "standalone" ? props.protectionDisabled : true;
  const protectionFilter =
    props.view === "standalone" ? props.protectionFilter : null;
  const onProtect =
    props.view === "standalone" ? props.onProtect : ignoreProtectionAction;
  const onUnprotect =
    props.view === "standalone" ? props.onUnprotect : ignoreProtectionAction;

  return useMemo(
    () => [
      {
        title: t("table.protectionStatus"),
        key: "protection",
        width: 120,
        align: "center",
        ...(view === "standalone"
          ? {
              filters: [
                { text: t("table.protected"), value: "protected" },
                { text: t("table.unprotected"), value: "unprotected" },
              ],
              filterMultiple: false,
              filteredValue:
                protectionFilter === null ? null : [protectionFilter],
            }
          : {}),
        render: (_: unknown, conversation: Conversation) =>
          view === "projects" ? (
            <ConversationProtectionStatus view="projects" />
          ) : (
            <ConversationProtectionStatus
              view="standalone"
              protectedConversation={protectedConversationIds.has(
                conversation.id,
              )}
            />
          ),
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
          <span className="conversation-date">
            {timestamp === null
              ? t("table.unknownDate")
              : dateTimeFormatter.format(timestamp)}
          </span>
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
          <span className="conversation-date">
            {timestamp === null
              ? t("table.unknownDate")
              : dateTimeFormatter.format(timestamp)}
          </span>
        ),
      },
      {
        title: t("table.actions"),
        key: "actions",
        width: 250,
        render: (_: unknown, conversation: Conversation) => {
          const protectedConversation = protectedConversationIds.has(
            conversation.id,
          );
          return (
            <ConversationRowActions
              conversationId={conversation.id}
              copyFeedback={copyFeedbackFor(conversation.id)}
              onCopy={copyConversationId}
              onOpen={onOpen}
              protectionAction={
                view === "projects"
                  ? null
                  : protectedConversation
                    ? {
                        kind: "unprotect",
                        disabled: protectionDisabled,
                        onInvoke: onUnprotect,
                      }
                    : {
                        kind: "protect",
                        disabled: protectionDisabled,
                        onInvoke: onProtect,
                      }
              }
            />
          );
        },
      },
    ],
    [
      copyConversationId,
      copyFeedbackFor,
      dateTimeFormatter,
      onOpen,
      onProtect,
      onUnprotect,
      protectedConversationIds,
      protectionDisabled,
      protectionFilter,
      sortDirection,
      sortField,
      t,
      view,
    ],
  );
}
