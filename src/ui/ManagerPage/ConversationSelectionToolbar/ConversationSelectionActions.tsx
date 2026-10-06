import { Button, Flex, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

interface ConversationSelectionActionsProps {
  readonly disabled: boolean;
  readonly onSelectCurrentPage: () => void;
  readonly onSelectAllMatching: () => void;
  readonly onInvertMatchingSelection: () => void;
  readonly onClearSelection: () => void;
}

export default function ConversationSelectionActions({
  disabled,
  onSelectCurrentPage,
  onSelectAllMatching,
  onInvertMatchingSelection,
  onClearSelection,
}: ConversationSelectionActionsProps) {
  const { t } = useTranslation();

  return (
    <Flex className="selection-controls" wrap gap="small">
      <Button disabled={disabled} onClick={onSelectCurrentPage}>
        {t("selection.currentPage")}
      </Button>
      <Tooltip
        title={t("selection.allMatchingHelp")}
        trigger={["hover", "focus"]}
      >
        <Button disabled={disabled} onClick={onSelectAllMatching}>
          {t("selection.allMatching")}
        </Button>
      </Tooltip>
      <Button disabled={disabled} onClick={onInvertMatchingSelection}>
        {t("selection.invert")}
      </Button>
      <Button disabled={disabled} onClick={onClearSelection}>
        {t("selection.clear")}
      </Button>
    </Flex>
  );
}
