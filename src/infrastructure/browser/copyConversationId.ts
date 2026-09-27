export function copyConversationId(conversationId: string): Promise<void> {
  return navigator.clipboard.writeText(conversationId);
}
