import { parseSafetyCriticalIdentifier } from "infrastructure/api/readValidation";
import { CHATGPT_ORIGIN } from "infrastructure/api/chatGptApiContract";

export function buildChatGptConversationUrl(
  conversationId: string,
): string | null {
  const validConversationId = parseSafetyCriticalIdentifier(conversationId);
  if (validConversationId === null) return null;
  return `${CHATGPT_ORIGIN}/c/${encodeURIComponent(validConversationId)}`;
}
