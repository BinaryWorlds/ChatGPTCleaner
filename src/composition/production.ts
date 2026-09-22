import { ProductionConversationGateway } from "../infrastructure/api/ProductionConversationGateway";
import {
  createChromePageContextReadExecutor,
  PageContextReadTransport,
  type PageContextReadExecutor,
} from "../infrastructure/api/PageContextReadTransport";
import {
  createChromeSourceTabBrowser,
  parseSourceTabId,
  SourceTabBinding,
  type SourceTabBrowser,
} from "../infrastructure/browser/SourceTab";
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
import type { ManagerComposition, ManagerDependencies } from "./types";

export interface ProductionRuntime {
  readonly sourceTabBrowser: SourceTabBrowser;
  readonly pageReadExecutor?: PageContextReadExecutor;
  readonly storage: BrowserLocalStorage;
  readonly locks: WebLockManager | null;
}

function createBrowserRuntime(): ProductionRuntime {
  return {
    sourceTabBrowser: createChromeSourceTabBrowser(),
    pageReadExecutor: createChromePageContextReadExecutor(),
    storage: createChromeLocalStorage(),
    locks: currentWebLockManager(),
  };
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
      gateway: new ProductionConversationGateway(transport),
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
    };
  };

  return {
    mode: "production",
    scenarios: [],
    initialScenarioId: "production",
    createDependencies,
    openConversation: () => undefined,
  };
}
