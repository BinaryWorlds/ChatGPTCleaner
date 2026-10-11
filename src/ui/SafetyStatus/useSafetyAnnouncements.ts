import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type { SafetyBlockReason } from "application/SafetyBlockReason";
import type { DeletionRunState } from "application/deletionRun";
import { safetyBlockReasonLabel } from "./safetyStatusPresentation";
import type { SafetyStatusState } from "./safetyStatusContract";

interface UseSafetyAnnouncementsInput {
  readonly stateKind: SafetyStatusState["kind"];
  readonly operationKind: DeletionRunState["kind"] | null;
  readonly operationReason: SafetyBlockReason | null;
  readonly t: TFunction;
}

export function useSafetyAnnouncements({
  stateKind,
  operationKind,
  operationReason,
  t,
}: UseSafetyAnnouncementsInput) {
  const previousStateKind = useRef(stateKind);
  const previousOperationKind = useRef(operationKind);
  const operationAnnouncementRef = useRef<HTMLDivElement>(null);
  const [readyAnnouncement, setReadyAnnouncement] = useState("");

  useEffect(() => {
    const enteredReady =
      previousStateKind.current !== "ready" && stateKind === "ready";
    previousStateKind.current = stateKind;
    setReadyAnnouncement(enteredReady ? t("safety.readyAnnouncement") : "");
  }, [stateKind, t]);

  useEffect(() => {
    const previousKind = previousOperationKind.current;
    previousOperationKind.current = operationKind;
    const announcementSurface = operationAnnouncementRef.current;
    if (announcementSurface === null) return;

    if (
      operationKind !== "stopped" &&
      operationKind !== "blocked" &&
      operationKind !== "fatal"
    ) {
      announcementSurface.textContent = "";
      return;
    }
    if (previousKind === operationKind) return;

    if (operationKind === "stopped") {
      announcementSurface.textContent = t("deletion.stoppedAnnouncement");
      return;
    }
    if (operationReason === null) return;
    announcementSurface.textContent = t("deletion.failureAnnouncement", {
      reason: safetyBlockReasonLabel(operationReason),
    });
  }, [operationKind, operationReason, t]);

  return { operationAnnouncementRef, readyAnnouncement };
}
