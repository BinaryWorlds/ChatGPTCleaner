import { parseSafetyCriticalIdentifier } from "../api/readValidation";

export function buildChatGptConversationUrl(
  conversationId: string,
): string | null {
  const validConversationId = parseSafetyCriticalIdentifier(conversationId);
  if (validConversationId === null || validConversationId.trim() === "") {
    return null;
  }
  return `https://chatgpt.com/c/${encodeURIComponent(validConversationId)}`;
}
