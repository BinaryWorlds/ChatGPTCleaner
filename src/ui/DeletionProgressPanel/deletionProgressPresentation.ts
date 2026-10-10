import type { TFunction } from "i18next";
import type {
  DeletionRunProgress,
  DeletionRunState,
} from "../../application/deletionRun";

const FAILED_CONVERSATION_PREVIEW_LIMIT = 20;

export function deletionProgressPercent(progress: DeletionRunProgress): number {
  if (progress.total === 0) return 0;
  const percentage = Math.round((progress.processed / progress.total) * 100);
  return progress.remaining > 0 ? Math.min(99, percentage) : percentage;
}

export function showsActiveDeletionTime(
  kind: DeletionRunState["kind"],
): boolean {
  return kind === "running" || kind === "pausing" || kind === "stopping";
}

export function failedConversationPreview(
  failedConversationIds: readonly string[],
): {
  readonly conversationIds: readonly string[];
  readonly hiddenCount: number;
} {
  const conversationIds = failedConversationIds.slice(
    0,
    FAILED_CONVERSATION_PREVIEW_LIMIT,
  );
  return {
    conversationIds,
    hiddenCount: failedConversationIds.length - conversationIds.length,
  };
}

export function formatDeletionDuration(
  milliseconds: number,
  t: TFunction,
): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0
    ? t("deletion.durationMinutesSeconds", {
        minutes,
        seconds: remainingSeconds,
      })
    : t("deletion.durationSeconds", { seconds });
}
