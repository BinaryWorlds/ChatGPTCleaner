export const CHATGPT_ORIGIN = "https://chatgpt.com";

export const ChatGptApiPath = {
  StandaloneConversations: "/backend-api/conversations",
  Projects: "/backend-api/gizmos/snorlax/sidebar",
  ProjectConversations: "/backend-api/gizmos/{project-id}/conversations",
} as const;
