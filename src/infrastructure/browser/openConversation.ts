import { parseSafetyCriticalIdentifier } from "../api/readValidation";
import { CHATGPT_ORIGIN } from "../api/chatGptApiContract";

export function buildChatGptConversationUrl(
  conversationId: string,
): string | null {
  const validConversationId = parseSafetyCriticalIdentifier(conversationId);
  if (validConversationId === null) return null;
  return `${CHATGPT_ORIGIN}/c/${encodeURIComponent(validConversationId)}`;
}
