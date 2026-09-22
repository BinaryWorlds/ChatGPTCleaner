const CHATGPT_ORIGIN = "https://chatgpt.com";

function isChatGptSourceTab(url: string | undefined): boolean {
  if (url === undefined) {
    return false;
  }

  try {
    return new URL(url).origin === CHATGPT_ORIGIN;
  } catch {
    return false;
  }
}

function reportManagerOpenFailure(): void {
  console.error("ChatGPTCleaner could not open its manager page.");
}

export default defineBackground(() => {
  browser.action.onClicked.addListener((sourceTab) => {
    const openManager = async (): Promise<void> => {
      const managerUrl = new URL(browser.runtime.getURL("/manager.html"));

      if (isChatGptSourceTab(sourceTab.url) && sourceTab.id !== undefined) {
        managerUrl.searchParams.set("sourceTabId", String(sourceTab.id));
      }

      await browser.tabs.create({ url: managerUrl.href });
    };

    void openManager().catch(reportManagerOpenFailure);
  });
});
