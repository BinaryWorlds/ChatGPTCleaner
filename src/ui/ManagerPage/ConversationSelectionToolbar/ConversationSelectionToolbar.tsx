import { CheckSquareOutlined } from "@ant-design/icons";
import { Space, theme, Typography } from "antd";
import { useTranslation } from "react-i18next";
import SectionHeading from "../SectionHeading";
import ConversationBulkActions from "./ConversationBulkActions";
import ConversationSelectionActions from "./ConversationSelectionActions";

interface ConversationSelectionToolbarProps {
  readonly selectedCount: number;
  readonly protectableCount: number;
  readonly unprotectableCount: number;
  readonly selectionActionsDisabled: boolean;
  readonly protectDisabled: boolean;
  readonly unprotectDisabled: boolean;
  readonly deleteDisabled: boolean;
  readonly onSelectCurrentPage: () => void;
  readonly onSelectAllMatching: () => void;
  readonly onInvertMatchingSelection: () => void;
  readonly onClearSelection: () => void;
  readonly onProtect: () => void;
  readonly onUnprotect: () => void;
  readonly onDelete: () => void;
}

export default function ConversationSelectionToolbar({
  selectedCount,
  protectableCount,
  unprotectableCount,
  selectionActionsDisabled,
  protectDisabled,
  unprotectDisabled,
  deleteDisabled,
  onSelectCurrentPage,
  onSelectAllMatching,
  onInvertMatchingSelection,
  onClearSelection,
  onProtect,
  onUnprotect,
  onDelete,
}: ConversationSelectionToolbarProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  return (
    <section aria-labelledby="selection-heading">
      <Space
        orientation="vertical"
        size={token.marginSM}
        className="full-width"
      >
        <SectionHeading
          id="selection-heading"
          icon={
            <CheckSquareOutlined
              aria-hidden
              style={{ color: token.colorPrimary }}
            />
          }
        >
          {t("selection.title")}
        </SectionHeading>
        <div className="selection-toolbar">
          <ConversationSelectionActions
            disabled={selectionActionsDisabled}
            onSelectCurrentPage={onSelectCurrentPage}
            onSelectAllMatching={onSelectAllMatching}
            onInvertMatchingSelection={onInvertMatchingSelection}
            onClearSelection={onClearSelection}
          />
          <Typography.Text
            className="selection-summary"
            strong
            data-testid="selection-summary"
          >
            {t("selection.summary", { count: selectedCount })}
          </Typography.Text>
          <ConversationBulkActions
            protectableCount={protectableCount}
            unprotectableCount={unprotectableCount}
            protectDisabled={protectDisabled}
            unprotectDisabled={unprotectDisabled}
            deleteDisabled={deleteDisabled}
            onProtect={onProtect}
            onUnprotect={onUnprotect}
            onDelete={onDelete}
          />
        </div>
      </Space>
    </section>
  );
}
