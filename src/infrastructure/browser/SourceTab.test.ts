import { describe, expect, it, vi } from "vitest";
import {
  hasExactChatGptOrigin,
  parseSourceTabId,
  SourceTabBinding,
  type SourceTabBrowser,
} from "./SourceTab";

function sourceBrowser(url: string): SourceTabBrowser {
  return {
    getTab: vi.fn().mockResolvedValue({ id: 42, url }),
    probePage: vi.fn().mockResolvedValue([
      {
        result: {
          origin: "https://chatgpt.com",
        },
      },
    ]),
  };
}

describe("SourceTabBinding", () => {
  it("accepts only an exact ChatGPT origin", async () => {
    expect(hasExactChatGptOrigin("https://chatgpt.com/c/example")).toBe(true);
    expect(hasExactChatGptOrigin("https://chatgpt.com.evil.test/")).toBe(false);
    expect(
      hasExactChatGptOrigin("https://evil.test/?next=https://chatgpt.com"),
    ).toBe(false);
    expect(hasExactChatGptOrigin("http://chatgpt.com/")).toBe(false);
    expect(hasExactChatGptOrigin("not a URL")).toBe(false);

    await expect(
      new SourceTabBinding(
        42,
        sourceBrowser("https://chatgpt.com/c/example"),
      ).validate(),
    ).resolves.toEqual({ kind: "valid", tabId: 42 });
  });

  it("rejects missing, closed, or mismatched source tabs", async () => {
    const closed: SourceTabBrowser = {
      getTab: vi.fn().mockRejectedValue(new Error("closed")),
      probePage: vi.fn(),
    };
    await expect(new SourceTabBinding(42, closed).validate()).resolves.toEqual({
      kind: "invalid",
    });

    const mismatched = sourceBrowser("https://chatgpt.com/");
    mismatched.getTab = vi.fn().mockResolvedValue({
      id: 41,
      url: "https://chatgpt.com/",
    });
    await expect(
      new SourceTabBinding(42, mismatched).validate(),
    ).resolves.toEqual({ kind: "invalid" });
  });

  it("fails closed after source-tab navigation or loss of page access", async () => {
    const navigated = sourceBrowser("https://example.com/");
    await expect(
      new SourceTabBinding(42, navigated).validate(),
    ).resolves.toEqual({ kind: "invalid" });

    const inaccessible = sourceBrowser("https://chatgpt.com/");
    inaccessible.probePage = vi.fn().mockRejectedValue(new Error("no access"));
    await expect(
      new SourceTabBinding(42, inaccessible).validate(),
    ).resolves.toEqual({ kind: "invalid" });
  });

  it("parses only positive safe integer source-tab IDs", () => {
    expect(parseSourceTabId("42")).toBe(42);
    expect(parseSourceTabId(null)).toBeNull();
    expect(parseSourceTabId("0")).toBeNull();
    expect(parseSourceTabId("1e2")).toBeNull();
    expect(parseSourceTabId("9007199254740992")).toBeNull();
  });
});
