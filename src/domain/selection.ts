import type { Conversation } from "./conversation";

export function excludeProjectConversations(
  conversations: readonly Conversation[],
  projectConversationIds: ReadonlySet<string>,
): readonly Conversation[] {
  return conversations.filter(
    (conversation) => !projectConversationIds.has(conversation.id),
  );
}

export function selectAllMatching(
  selectedConversationIds: ReadonlySet<string>,
  matchingConversations: readonly Conversation[],
): ReadonlySet<string> {
  const nextSelection = new Set(selectedConversationIds);

  for (const conversation of matchingConversations) {
    nextSelection.add(conversation.id);
  }

  return nextSelection;
}

export function invertMatchingSelection(
  selectedConversationIds: ReadonlySet<string>,
  matchingConversations: readonly Conversation[],
): ReadonlySet<string> {
  const nextSelection = new Set(selectedConversationIds);

  for (const conversation of matchingConversations) {
    if (nextSelection.has(conversation.id)) {
      nextSelection.delete(conversation.id);
      continue;
    }

    nextSelection.add(conversation.id);
  }

  return nextSelection;
}
