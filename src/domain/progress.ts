export interface DeletionProgressInput {
  readonly total: number;
  readonly deleted: number;
  readonly failed: number;
  readonly skipped: number;
  readonly retries: number;
  readonly requestsPerMinute: number;
  readonly activeElapsedMs: number;
  readonly paused: boolean;
}

const MILLISECONDS_PER_MINUTE = 60_000;
const MINIMUM_PROCESSED_ITEMS_FOR_MEASURED_THROUGHPUT = 3;

export interface DeletionProgress extends DeletionProgressInput {
  readonly processed: number;
  readonly remaining: number;
  readonly etaMs: number | null;
}

export function calculateDeletionProgress(
  input: DeletionProgressInput,
): DeletionProgress {
  const processed = input.deleted + input.failed + input.skipped;
  const remaining = Math.max(0, input.total - processed);

  if (input.paused) {
    return { ...input, processed, remaining, etaMs: null };
  }

  const millisecondsPerItem =
    processed >= MINIMUM_PROCESSED_ITEMS_FOR_MEASURED_THROUGHPUT &&
    input.activeElapsedMs > 0
      ? input.activeElapsedMs / processed
      : MILLISECONDS_PER_MINUTE / input.requestsPerMinute;

  return {
    ...input,
    processed,
    remaining,
    etaMs: Math.ceil(remaining * millisecondsPerItem),
  };
}
