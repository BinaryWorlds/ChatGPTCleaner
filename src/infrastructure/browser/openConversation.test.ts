import { describe, expect, it } from "vitest";
import { buildChatGptConversationUrl } from "./openConversation";

describe("buildChatGptConversationUrl", () => {
  it("builds a fixed ChatGPT conversation URL with one encoded ID segment", () => {
    expect(buildChatGptConversationUrl("conversation/one")).toBe(
      "https://chatgpt.com/c/conversation%2Fone",
    );
    expect(buildChatGptConversationUrl(" ")).toBeNull();
  });
});
