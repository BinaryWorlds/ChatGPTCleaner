import { z } from "zod";
import type {
  SourceTabLifecycle,
  SourceTabValidationResult,
  SourceTabValidator,
} from "../../application/ports/SourceTabLifecycle";
import { CHATGPT_ORIGIN } from "../api/chatGptApiContract";

const tabSchema = z.object({
  id: z.number().int().positive(),
  url: z.string(),
});

const pageProbeResultsSchema = z
  .array(
    z.object({
      result: z
        .object({
          origin: z.string(),
        })
        .optional(),
    }),
  )
  .length(1);

export interface SourceTabBrowser {
  getTab(tabId: number): Promise<unknown>;
  probePage(tabId: number): Promise<unknown>;
}

export interface SourceTabEvents {
  subscribeToRemoved(listener: (tabId: number) => void): () => void;
  subscribeToUpdated(
    listener: (tabId: number, status: string | undefined) => void,
  ): () => void;
}

export function parseSourceTabId(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const tabId = Number(value);
  return Number.isSafeInteger(tabId) && tabId > 0 ? tabId : null;
}

export function hasExactChatGptOrigin(url: string): boolean {
  try {
    return new URL(url).origin === CHATGPT_ORIGIN;
  } catch {
    return false;
  }
}

export class SourceTabBinding implements SourceTabValidator {
  public constructor(
    private readonly tabId: number,
    private readonly browser: SourceTabBrowser,
  ) {}

  public async validate(): Promise<SourceTabValidationResult> {
    let rawTab: unknown;
    try {
      rawTab = await this.browser.getTab(this.tabId);
    } catch {
      return { kind: "invalid" };
    }

    const tab = tabSchema.safeParse(rawTab);
    if (!tab.success || tab.data.id !== this.tabId) {
      return { kind: "invalid" };
    }
    if (!hasExactChatGptOrigin(tab.data.url)) {
      return { kind: "invalid" };
    }

    let rawProbe: unknown;
    try {
      rawProbe = await this.browser.probePage(this.tabId);
    } catch {
      return { kind: "invalid" };
    }

    const probe = pageProbeResultsSchema.safeParse(rawProbe);
    if (!probe.success || probe.data[0]?.result === undefined) {
      return { kind: "invalid" };
    }
    if (probe.data[0].result.origin !== CHATGPT_ORIGIN) {
      return { kind: "invalid" };
    }

    return { kind: "valid", tabId: this.tabId };
  }
}

export class BoundSourceTabLifecycle implements SourceTabLifecycle {
  public constructor(
    private readonly tabId: number,
    private readonly validator: SourceTabValidator,
    private readonly events: SourceTabEvents,
  ) {}

  public validate(): Promise<SourceTabValidationResult> {
    return this.validator.validate();
  }

  public subscribe(listener: () => void): () => void {
    const unsubscribeRemoved = this.events.subscribeToRemoved((tabId) => {
      if (tabId === this.tabId) listener();
    });
    const unsubscribeUpdated = this.events.subscribeToUpdated(
      (tabId, status) => {
        if (tabId === this.tabId && status === "complete") listener();
      },
    );
    return () => {
      unsubscribeRemoved();
      unsubscribeUpdated();
    };
  }
}

export function createChromeSourceTabBrowser(): SourceTabBrowser {
  return {
    getTab: (tabId) => browser.tabs.get(tabId),
    probePage: (tabId) =>
      browser.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: () => ({
          origin: window.location.origin,
        }),
      }),
  };
}

export function createChromeSourceTabEvents(): SourceTabEvents {
  return {
    subscribeToRemoved: (listener) => {
      browser.tabs.onRemoved.addListener(listener);
      return () => browser.tabs.onRemoved.removeListener(listener);
    },
    subscribeToUpdated: (listener) => {
      const chromeListener = (
        tabId: number,
        changeInfo: { readonly status?: string },
      ) => listener(tabId, changeInfo.status);
      browser.tabs.onUpdated.addListener(chromeListener);
      return () => browser.tabs.onUpdated.removeListener(chromeListener);
    },
  };
}
