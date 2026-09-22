import { ProductionConversationGateway } from "../infrastructure/api/ProductionConversationGateway";
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
  readonly storage: BrowserLocalStorage;
  readonly locks: WebLockManager | null;
}

function createBrowserRuntime(): ProductionRuntime {
  return {
    sourceTabBrowser: createChromeSourceTabBrowser(),
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
    return {
      gateway: new ProductionConversationGateway(
        new SourceTabBinding(sourceTabId, activeRuntime.sourceTabBrowser),
      ),
      protectedConversationStore: new BrowserProtectedConversationStore(
        activeRuntime.storage,
        trustedStorage,
      ),
      settingsStore: new BrowserSettingsStore(
        activeRuntime.storage,
        trustedStorage,
      ),
      clock: new SystemClock(),
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
