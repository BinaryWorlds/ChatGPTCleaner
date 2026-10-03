import { useState } from "react";

type ConversationIdCollection = Iterable<string>;

function addConversationIds(
  currentSelection: ReadonlySet<string>,
  conversationIds: ConversationIdCollection,
): ReadonlySet<string> {
  const nextSelection = new Set(currentSelection);

  for (const conversationId of conversationIds) {
    nextSelection.add(conversationId);
  }

  return nextSelection;
}

export function useConversationSelection() {
  const [selectedConversationIds, setSelectedConversationIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const replaceSelection = (conversationIds: ConversationIdCollection) => {
    setSelectedConversationIds(new Set(conversationIds));
  };

  const selectCurrentPage = (
    currentPageConversationIds: ConversationIdCollection,
  ) => {
    const currentPageIdsSnapshot = new Set(currentPageConversationIds);
    setSelectedConversationIds((currentSelection) =>
      addConversationIds(currentSelection, currentPageIdsSnapshot),
    );
  };

  const selectAllMatching = (
    matchingConversationIds: ConversationIdCollection,
  ) => {
    const matchingIdsSnapshot = new Set(matchingConversationIds);
    setSelectedConversationIds((currentSelection) =>
      addConversationIds(currentSelection, matchingIdsSnapshot),
    );
  };

  const invertMatchingSelection = (
    matchingConversationIds: ConversationIdCollection,
  ) => {
    const matchingIdsSnapshot = new Set(matchingConversationIds);
    setSelectedConversationIds((currentSelection) => {
      const nextSelection = new Set(currentSelection);

      for (const conversationId of matchingIdsSnapshot) {
        if (nextSelection.has(conversationId)) {
          nextSelection.delete(conversationId);
          continue;
        }

        nextSelection.add(conversationId);
      }

      return nextSelection;
    });
  };

  const clearSelection = () => {
    setSelectedConversationIds(new Set());
  };

  const removeFromSelection = (conversationIds: ConversationIdCollection) => {
    const conversationIdsSnapshot = new Set(conversationIds);
    setSelectedConversationIds((currentSelection) => {
      const nextSelection = new Set(currentSelection);

      for (const conversationId of conversationIdsSnapshot) {
        nextSelection.delete(conversationId);
      }

      return nextSelection;
    });
  };

  return {
    selectedConversationIds,
    replaceSelection,
    selectCurrentPage,
    selectAllMatching,
    invertMatchingSelection,
    clearSelection,
    removeFromSelection,
  };
}
