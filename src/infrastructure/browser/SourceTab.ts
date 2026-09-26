import { z } from "zod";
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

export type SourceTabValidationResult =
  | { readonly kind: "valid"; readonly tabId: number }
  | { readonly kind: "invalid" };

export interface SourceTabValidator {
  validate(): Promise<SourceTabValidationResult>;
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
