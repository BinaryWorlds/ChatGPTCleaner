import { CHATGPT_ORIGIN } from "infrastructure/api/chatGptApiContract";

interface ActionSourceTab {
  readonly id?: number | undefined;
  readonly url?: string | undefined;
}

function isChatGptActionSource(url: string): boolean {
  try {
    return new URL(url).origin === CHATGPT_ORIGIN;
  } catch {
    return false;
  }
}

export function buildManagerLaunchUrl(
  managerPageUrl: string,
  sourceTab: ActionSourceTab,
): string {
  const managerUrl = new URL(managerPageUrl);
  if (
    sourceTab.url === undefined ||
    !isChatGptActionSource(sourceTab.url) ||
    sourceTab.id === undefined ||
    !Number.isSafeInteger(sourceTab.id) ||
    sourceTab.id <= 0
  ) {
    return managerUrl.href;
  }

  managerUrl.searchParams.set("sourceTabId", String(sourceTab.id));
  return managerUrl.href;
}
