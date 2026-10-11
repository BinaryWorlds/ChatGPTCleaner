import { useTranslation } from "react-i18next";
import type { DeletionRunState } from "application/deletionRun";
import { formatDeletionDuration } from "ui/ManagerPage/components/DeletionProgressPanel/deletionProgressPresentation";
import { useDisplayedDeletionElapsedMs } from "ui/ManagerPage/components/DeletionProgressPanel/useDisplayedDeletionElapsedMs";

interface DeletionProgressDetailsProps {
  readonly state: DeletionRunState;
}

export default function DeletionProgressDetails({
  state,
}: DeletionProgressDetailsProps) {
  const { t } = useTranslation();
  const { progress } = state;
  const displayedElapsedMs = useDisplayedDeletionElapsedMs(state);
  const terminal = ["stopped", "finished", "blocked", "fatal"].includes(
    state.kind,
  );
  const hidesEta =
    terminal || state.kind === "pausing" || state.kind === "stopping";

  const eta = (() => {
    if (hidesEta) return null;
    if (state.kind === "paused") return t("deletion.etaPaused");
    if (progress.processed < 3) return t("deletion.etaEstimating");
    if (progress.etaMs === null) return t("deletion.unknown");
    return t("deletion.etaAbout", {
      duration: formatDeletionDuration(progress.etaMs, t),
    });
  })();

  return (
    <div className="deletion-progress-details">
      <dl className="deletion-metric-group">
        <div className="deletion-metric">
          <dt>{t("deletion.deleted")}</dt>
          <dd>{progress.deleted + progress.skipped}</dd>
        </div>
        <div
          className={`deletion-metric${
            progress.failed > 0 ? " deletion-metric-failed" : ""
          }`}
        >
          <dt>{t("deletion.failed")}</dt>
          <dd>{progress.failed}</dd>
        </div>
        {!terminal && (
          <div className="deletion-metric">
            <dt>{t("deletion.inProgress")}</dt>
            <dd>{progress.activeRequestCount}</dd>
          </div>
        )}
        {terminal && (
          <div className="deletion-metric">
            <dt>{t("deletion.deletionTime")}</dt>
            <dd>{formatDeletionDuration(displayedElapsedMs, t)}</dd>
          </div>
        )}
      </dl>

      {!terminal && (
        <dl className="deletion-metric-group">
          <div className="deletion-metric">
            <dt>{t("deletion.deletionTime")}</dt>
            <dd>{formatDeletionDuration(displayedElapsedMs, t)}</dd>
          </div>
          {eta !== null && (
            <div className="deletion-metric">
              <dt>{t("deletion.estimatedTimeRemaining")}</dt>
              <dd>{eta}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
