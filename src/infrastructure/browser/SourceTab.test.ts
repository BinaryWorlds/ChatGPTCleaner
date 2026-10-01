import { describe, expect, it, vi } from "vitest";
import {
  BoundSourceTabLifecycle,
  hasExactChatGptOrigin,
  parseSourceTabId,
  SourceTabBinding,
  type SourceTabBrowser,
  type SourceTabEvents,
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

  it.each([
    {
      name: "an empty scripting result array",
      probeResult: [],
    },
    {
      name: "a scripting result entry without a result",
      probeResult: [{}],
    },
    {
      name: "a structurally valid result with a non-ChatGPT origin",
      probeResult: [{ result: { origin: "https://example.com" } }],
    },
  ])("rejects a fulfilled probe with $name", async ({ probeResult }) => {
    const browser = sourceBrowser("https://chatgpt.com/");
    browser.probePage = vi.fn().mockResolvedValue(probeResult);

    await expect(new SourceTabBinding(42, browser).validate()).resolves.toEqual(
      { kind: "invalid" },
    );
  });

  it("parses only positive safe integer source-tab IDs", () => {
    expect(parseSourceTabId("42")).toBe(42);
    expect(parseSourceTabId(null)).toBeNull();
    expect(parseSourceTabId("0")).toBeNull();
    expect(parseSourceTabId("1e2")).toBeNull();
    expect(parseSourceTabId("9007199254740992")).toBeNull();
  });

  it("notifies only for removal or completed updates of the bound tab", () => {
    let removedListener: ((tabId: number) => void) | undefined;
    let updatedListener:
      ((tabId: number, status: string | undefined) => void) | undefined;
    const events: SourceTabEvents = {
      subscribeToRemoved: (listener) => {
        removedListener = listener;
        return () => undefined;
      },
      subscribeToUpdated: (listener) => {
        updatedListener = listener;
        return () => undefined;
      },
    };
    const notify = vi.fn();
    new BoundSourceTabLifecycle(
      42,
      new SourceTabBinding(42, sourceBrowser("https://chatgpt.com/")),
      events,
    ).subscribe(notify);

    removedListener?.(41);
    updatedListener?.(42, "loading");
    updatedListener?.(41, "complete");
    expect(notify).not.toHaveBeenCalled();

    updatedListener?.(42, "complete");
    removedListener?.(42);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
