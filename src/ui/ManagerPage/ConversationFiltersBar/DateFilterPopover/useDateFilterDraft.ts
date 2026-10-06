import { useRef, useState } from "react";
import type { ConversationDateField } from "../../../../domain/conversation";
import type { ConversationDateFilter } from "../helpers/conversationDateFilter";
import {
  applyDateFilterDraft,
  buildDateFilterDraft,
  canApplyDateFilterDraft,
  EMPTY_DATE_FILTER_DRAFT,
  type ExactDateFilterValue,
} from "./helpers/dateFilterDraft";
import type { DatePeriod } from "../helpers/dateFilterPeriods";

interface UseDateFilterDraftOptions {
  readonly dateFilter: ConversationDateFilter;
  readonly onChange: (dateFilter: ConversationDateFilter) => void;
  readonly currentDate: () => Date;
}

export function useDateFilterDraft({
  dateFilter,
  onChange,
  currentDate,
}: UseDateFilterDraftOptions) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DATE_FILTER_DRAFT);
  const dateTriggerRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);

  const closePopover = () => {
    setPopoverOpen(false);
    dateTriggerRef.current?.focus({ preventScroll: true });
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setDraft(buildDateFilterDraft(dateFilter, currentDate()));
      setPopoverOpen(true);
      return;
    }

    closePopover();
  };

  const applyDraft = () => {
    const nextDateFilter = applyDateFilterDraft(draft, currentDate());
    if (nextDateFilter === null) return;

    onChange(nextDateFilter);
    closePopover();
  };

  const updateDateField = (dateField: ConversationDateField) => {
    setDraft((currentDraft) => ({ ...currentDraft, dateField }));
  };

  const updatePeriod = (period: DatePeriod) => {
    setDraft((currentDraft) => ({ ...currentDraft, period }));
  };

  const updateExactDateFilter = (exactDateFilter: ExactDateFilterValue) => {
    setDraft((currentDraft) => ({ ...currentDraft, ...exactDateFilter }));
  };

  return {
    popoverOpen,
    draft,
    dateTriggerRef,
    canApplyDraft: canApplyDateFilterDraft(draft),
    handleOpenChange,
    cancelDraft: closePopover,
    applyDraft,
    updateDateField,
    updatePeriod,
    updateExactDateFilter,
  };
}
