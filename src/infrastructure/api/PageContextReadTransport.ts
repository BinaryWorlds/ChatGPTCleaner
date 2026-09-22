import { z } from "zod";
import type { Clock } from "../../application/ports/Clock";
import type { ReadResult } from "../../application/ports/ConversationGateway";
import type { SourceTabValidator } from "./ProductionConversationGateway";
import { executeReadWithRetry, type ReadAttemptResult } from "./readRetry";

const READ_PAGE_SIZE = 100;

export interface FixedReadRequest {
  readonly pathname: string;
  readonly query: Readonly<Record<string, string>>;
}

export interface PageContextReadExecutor {
  execute(tabId: number, request: FixedReadRequest): Promise<unknown>;
}

const executionResultSchema = z
  .array(
    z.object({
      result: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("network-error") }),
        z.object({
          kind: z.literal("response"),
          status: z.number().int().min(100).max(599),
          body: z.unknown(),
          retryAfter: z.string().nullable(),
        }),
      ]),
    }),
  )
  .length(1);

function sourceFailure(): ReadAttemptResult {
  return { kind: "failure", reason: "source-unavailable" };
}

export class PageContextReadTransport {
  public constructor(
    private readonly sourceTab: SourceTabValidator,
    private readonly executor: PageContextReadExecutor,
    private readonly clock: Clock,
  ) {}

  public readStandalonePage(offset: number): Promise<ReadResult<unknown>> {
    return this.read({
      pathname: "/backend-api/conversations",
      query: {
        offset: String(offset),
        limit: String(READ_PAGE_SIZE),
        order: "updated",
        is_archived: "false",
        is_starred: "false",
      },
    });
  }

  public readProjectsPage(cursor: string | null): Promise<ReadResult<unknown>> {
    return this.read({
      pathname: "/backend-api/gizmos/snorlax/sidebar",
      query: {
        owned_only: "false",
        conversations_per_gizmo: "0",
        limit: String(READ_PAGE_SIZE),
        ...(cursor === null ? {} : { cursor }),
      },
    });
  }

  public readProjectConversationPage(
    projectId: string,
    cursor: string | null,
  ): Promise<ReadResult<unknown>> {
    return this.read({
      pathname: `/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations`,
      query: {
        cursor: cursor ?? "0",
        limit: String(READ_PAGE_SIZE),
        owned_only: "false",
      },
    });
  }

  private read(request: FixedReadRequest): Promise<ReadResult<unknown>> {
    return executeReadWithRetry({
      clock: this.clock,
      attempt: async () => {
        const source = await this.sourceTab.validate();
        if (source.kind !== "valid") return sourceFailure();

        let rawResult: unknown;
        try {
          rawResult = await this.executor.execute(source.tabId, request);
        } catch {
          return { kind: "network-error" };
        }
        const parsed = executionResultSchema.safeParse(rawResult);
        if (!parsed.success || parsed.data[0]?.result === undefined) {
          return { kind: "failure", reason: "compatibility" };
        }
        return parsed.data[0].result;
      },
    });
  }
}

export function createChromePageContextReadExecutor(): PageContextReadExecutor {
  return {
    execute: (tabId, request) =>
      browser.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        args: [request],
        func: async (fixedRequest: FixedReadRequest) => {
          const targetOrigin = "https://chatgpt.com";
          const url = new URL(fixedRequest.pathname, targetOrigin);
          if (url.origin !== targetOrigin) return { kind: "network-error" };
          for (const [key, value] of Object.entries(fixedRequest.query)) {
            url.searchParams.set(key, value);
          }
          try {
            const response = await fetch(url.href, {
              method: "GET",
              credentials: "include",
              headers: { Accept: "application/json" },
            });
            let body: unknown = null;
            try {
              body = (await response.json()) as unknown;
            } catch {
              body = null;
            }
            return {
              kind: "response",
              status: response.status,
              body,
              retryAfter: response.headers.get("Retry-After"),
            };
          } catch {
            return { kind: "network-error" };
          }
        },
      }),
  };
}
