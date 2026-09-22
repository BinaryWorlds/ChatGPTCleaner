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
  protectedConversationIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const nextSelection = new Set(selectedConversationIds);

  for (const conversation of matchingConversations) {
    if (!protectedConversationIds.has(conversation.id)) {
      nextSelection.add(conversation.id);
    }
  }

  return nextSelection;
}

export function invertMatchingSelection(
  selectedConversationIds: ReadonlySet<string>,
  matchingConversations: readonly Conversation[],
  protectedConversationIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const nextSelection = new Set(selectedConversationIds);

  for (const conversation of matchingConversations) {
    if (protectedConversationIds.has(conversation.id)) continue;

    if (nextSelection.has(conversation.id)) {
      nextSelection.delete(conversation.id);
      continue;
    }

    nextSelection.add(conversation.id);
  }

  return nextSelection;
}

export function protectConversation(
  protectedConversationIds: ReadonlySet<string>,
  selectedConversationIds: ReadonlySet<string>,
  conversationId: string,
): {
  readonly protectedConversationIds: ReadonlySet<string>;
  readonly selectedConversationIds: ReadonlySet<string>;
} {
  const nextProtectedIds = new Set(protectedConversationIds);
  const nextSelection = new Set(selectedConversationIds);
  nextProtectedIds.add(conversationId);
  nextSelection.delete(conversationId);

  return {
    protectedConversationIds: nextProtectedIds,
    selectedConversationIds: nextSelection,
  };
}
