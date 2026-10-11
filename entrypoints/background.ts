import { buildManagerLaunchUrl } from "infrastructure/browser/managerLaunch";
import {
  logger,
  summarizeUnknownError,
} from "infrastructure/observability/logger";
import { installGlobalErrorHandlers } from "infrastructure/observability/globalErrors";

function reportManagerOpenFailure(error: unknown): void {
  logger.error("application.operation.failed", summarizeUnknownError(error), {
    operation: "manager.open",
  });
}

export default defineBackground(() => {
  installGlobalErrorHandlers(globalThis, logger, "background");
  browser.action.onClicked.addListener((sourceTab) => {
    const openManager = async (): Promise<void> => {
      const managerUrl = buildManagerLaunchUrl(
        browser.runtime.getURL("/manager.html"),
        sourceTab,
      );
      await browser.tabs.create({ url: managerUrl });
    };

    void openManager().catch(reportManagerOpenFailure);
  });
});
