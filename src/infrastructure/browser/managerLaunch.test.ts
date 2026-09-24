import { describe, expect, it } from "vitest";
import { buildManagerLaunchUrl } from "./managerLaunch";

describe("manager launch binding", () => {
  it("preserves the ChatGPT action tab ID in the manager URL", () => {
    const managerUrl = buildManagerLaunchUrl(
      "chrome-extension://extension-id/manager.html",
      { id: 42, url: "https://chatgpt.com/c/example" },
    );

    expect(new URL(managerUrl).searchParams.get("sourceTabId")).toBe("42");
  });

  it("never treats the manager extension tab as the source tab", () => {
    const managerUrl = buildManagerLaunchUrl(
      "chrome-extension://extension-id/manager.html",
      {
        id: 99,
        url: "chrome-extension://extension-id/manager.html?sourceTabId=42",
      },
    );

    expect(new URL(managerUrl).searchParams.has("sourceTabId")).toBe(false);
  });
});
