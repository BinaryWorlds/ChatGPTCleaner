import { useCallback, useState } from "react";
import type { CopyConversationIdFeedback } from "../copyConversationIdFeedback";

interface ActiveCopyFeedback {
  readonly conversationId: string;
  readonly kind: Exclude<CopyConversationIdFeedback, null>;
}

interface CopyConversationIdFeedbackProcess {
  readonly copyConversationId: (conversationId: string) => void;
  readonly copyFeedbackFor: (
    conversationId: string,
  ) => CopyConversationIdFeedback;
}

export function useCopyConversationIdFeedback(
  onCopyId: (conversationId: string) => Promise<void>,
): CopyConversationIdFeedbackProcess {
  const [activeFeedback, setActiveFeedback] =
    useState<ActiveCopyFeedback | null>(null);

  const copyConversationId = useCallback(
    (conversationId: string): void => {
      onCopyId(conversationId)
        .then(() => {
          setActiveFeedback({ conversationId, kind: "copied" });
        })
        .catch(() => {
          setActiveFeedback({ conversationId, kind: "failed" });
        });
    },
    [onCopyId],
  );

  const copyFeedbackFor = useCallback(
    (conversationId: string): CopyConversationIdFeedback =>
      activeFeedback?.conversationId === conversationId
        ? activeFeedback.kind
        : null,
    [activeFeedback],
  );

  return { copyConversationId, copyFeedbackFor };
}
