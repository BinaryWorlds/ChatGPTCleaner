import { ProductionConversationGateway } from "../infrastructure/api/ProductionConversationGateway";
import {
  createChromePageContextReadExecutor,
  PageContextReadTransport,
  type PageContextReadExecutor,
} from "../infrastructure/api/PageContextReadTransport";
import {
  createChromePageContextDeleteExecutor,
  PageContextDeleteTransport,
  type PageContextDeleteExecutor,
} from "../infrastructure/api/PageContextDeleteTransport";
import {
  createChromeSourceTabBrowser,
  parseSourceTabId,
  SourceTabBinding,
  type SourceTabBrowser,
} from "../infrastructure/browser/SourceTab";
import { buildChatGptConversationUrl } from "../infrastructure/browser/openConversation";
import {
  currentWebLockManager,
  WebLocksDestructiveRunLock,
  type WebLockManager,
} from "../infrastructure/locking/WebLocksDestructiveRunLock";
import {
  BrowserProtectedConversationStore,
  BrowserSettingsStore,
  createChromeLocalStorage,
  TrustedStorageAccess,
  type BrowserLocalStorage,
} from "../infrastructure/storage/BrowserStores";
import { SystemClock } from "../infrastructure/time/SystemClock";
import {
  logger,
  summarizeUnknownError,
} from "../infrastructure/observability/logger";
import { createApplicationObservability } from "../infrastructure/observability/applicationObservability";
import type { ManagerComposition, ManagerDependencies } from "./types";

export interface ProductionRuntime {
  readonly sourceTabBrowser: SourceTabBrowser;
  readonly pageReadExecutor?: PageContextReadExecutor;
  readonly pageDeleteExecutor?: PageContextDeleteExecutor;
  readonly storage: BrowserLocalStorage;
  readonly locks: WebLockManager | null;
}

function createBrowserRuntime(): ProductionRuntime {
  return {
    sourceTabBrowser: createChromeSourceTabBrowser(),
    pageReadExecutor: createChromePageContextReadExecutor(),
    pageDeleteExecutor: createChromePageContextDeleteExecutor(),
    storage: createChromeLocalStorage(),
    locks: currentWebLockManager(),
  };
}

function reportConversationOpenFailure(error: unknown): void {
  logger.error("application.operation.failed", summarizeUnknownError(error), {
    operation: "conversation.open",
  });
}

function openProductionConversation(conversationId: string): void {
  const url = buildChatGptConversationUrl(conversationId);
  if (url === null) return;
  void browser.tabs.create({ url }).catch(reportConversationOpenFailure);
}

export function createManagerComposition(
  runtime?: ProductionRuntime,
): ManagerComposition {
  const sourceTabId = parseSourceTabId(
    new URLSearchParams(window.location.search).get("sourceTabId"),
  );

  const createDependencies = (): ManagerDependencies | null => {
    if (sourceTabId === null) return null;
    const activeRuntime = runtime ?? createBrowserRuntime();
    const trustedStorage = new TrustedStorageAccess(activeRuntime.storage);
    const clock = new SystemClock();
    const sourceTab = new SourceTabBinding(
      sourceTabId,
      activeRuntime.sourceTabBrowser,
    );
    const transport = new PageContextReadTransport(
      sourceTab,
      activeRuntime.pageReadExecutor ?? createChromePageContextReadExecutor(),
      clock,
    );
    return {
      gateway: new ProductionConversationGateway(
        transport,
        new PageContextDeleteTransport(
          sourceTab,
          activeRuntime.pageDeleteExecutor ??
            createChromePageContextDeleteExecutor(),
          clock,
        ),
      ),
      protectedConversationStore: new BrowserProtectedConversationStore(
        activeRuntime.storage,
        trustedStorage,
      ),
      settingsStore: new BrowserSettingsStore(
        activeRuntime.storage,
        trustedStorage,
      ),
      clock,
      destructiveRunLock: new WebLocksDestructiveRunLock(activeRuntime.locks),
      observability: createApplicationObservability(),
    };
  };

  return {
    mode: "production",
    scenarios: [],
    initialScenarioId: "production",
    createDependencies,
    openConversation: openProductionConversation,
  };
}
