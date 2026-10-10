import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SerializedMaximumConcurrentDeleteRequestsWriter,
  SerializedRequestsPerMinuteWriter,
} from "../../../application/settings";
import type { ManagerDependencies } from "../../../composition/types";

interface UseDeletionSchedulingSettingsOptions {
  readonly dependencies: ManagerDependencies;
  readonly runOwnsWorkflow: boolean;
  readonly setRequestsPerMinute: (requestsPerMinute: number) => void;
  readonly setMaximumConcurrentDeleteRequests: (
    maximumConcurrentDeleteRequests: number,
  ) => void;
  readonly setNotice: (notice: string | null) => void;
}

export function useDeletionSchedulingSettings({
  dependencies,
  runOwnsWorkflow,
  setRequestsPerMinute,
  setMaximumConcurrentDeleteRequests,
  setNotice,
}: UseDeletionSchedulingSettingsOptions) {
  const { t } = useTranslation();
  const rateWriter = useMemo(
    () => new SerializedRequestsPerMinuteWriter(dependencies.settingsStore),
    [dependencies],
  );
  const concurrencyWriter = useMemo(
    () =>
      new SerializedMaximumConcurrentDeleteRequestsWriter(
        dependencies.settingsStore,
      ),
    [dependencies],
  );

  const changeDeletionRate = (value: number | null) => {
    if (value === null || runOwnsWorkflow) return;
    rateWriter
      .save(value)
      .then((saved) => {
        if (saved) setRequestsPerMinute(value);
      })
      .catch(() => setNotice(t("scheduling.saveFailure")));
  };

  const changeDeletionConcurrency = (value: number | null) => {
    if (value === null || runOwnsWorkflow) return;
    concurrencyWriter
      .save(value)
      .then((saved) => {
        if (saved) setMaximumConcurrentDeleteRequests(value);
      })
      .catch(() => setNotice(t("scheduling.saveFailure")));
  };

  return { changeDeletionRate, changeDeletionConcurrency } as const;
}
