import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SerializedRequestsPerMinuteWriter } from "../../../application/settings";
import type { ManagerDependencies } from "../../../composition/types";

interface UseDeletionRateSettingOptions {
  readonly dependencies: ManagerDependencies;
  readonly runActive: boolean;
  readonly setRequestsPerMinute: (requestsPerMinute: number) => void;
  readonly setNotice: (notice: string | null) => void;
}

export function useDeletionRateSetting({
  dependencies,
  runActive,
  setRequestsPerMinute,
  setNotice,
}: UseDeletionRateSettingOptions) {
  const { t } = useTranslation();
  const rateWriter = useMemo(
    () => new SerializedRequestsPerMinuteWriter(dependencies.settingsStore),
    [dependencies],
  );

  const changeDeletionRate = (value: number | null) => {
    if (value === null || runActive) return;
    rateWriter
      .save(value)
      .then((saved) => {
        if (saved) setRequestsPerMinute(value);
      })
      .catch(() => setNotice(t("rate.saveFailure")));
  };

  return changeDeletionRate;
}
