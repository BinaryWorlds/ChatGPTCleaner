import { Flex } from "antd";
import type { ConversationView } from "../ConversationTable/conversationTableContract";
import ConversationViewSelector from "./ConversationViewSelector";
import DeletionRateControl from "./DeletionRateControl";

interface ConversationViewToolbarProps {
  readonly conversationView: ConversationView;
  readonly requestsPerMinute: number;
  readonly rateControlDisabled: boolean;
  readonly onConversationViewChange: (view: ConversationView) => void;
  readonly onRateChange: (value: number | null) => void;
}

export default function ConversationViewToolbar({
  conversationView,
  requestsPerMinute,
  rateControlDisabled,
  onConversationViewChange,
  onRateChange,
}: ConversationViewToolbarProps) {
  return (
    <Flex
      className="workspace-toolbar"
      justify="space-between"
      align="center"
      wrap
      gap="small"
    >
      <ConversationViewSelector
        value={conversationView}
        onChange={onConversationViewChange}
      />
      {conversationView === "standalone" && (
        <DeletionRateControl
          requestsPerMinute={requestsPerMinute}
          disabled={rateControlDisabled}
          onChange={onRateChange}
        />
      )}
    </Flex>
  );
}
