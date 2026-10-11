import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_CONVERSATION_FILTERS,
  olderThanPreset,
  type ConversationFilters,
} from "domain/conversation";
import i18n from "i18n/i18n";
import ConversationFiltersBar from ".";

const NOW = new Date(2026, 0, 15, 12);

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

function renderFilters(filters: ConversationFilters, onChange = vi.fn()) {
  const result = render(
    <ConversationFiltersBar
      filters={filters}
      onChange={onChange}
      currentDate={() => new Date(NOW)}
    />,
  );
  return { ...result, onChange };
}

describe("ConversationFiltersBar", () => {
  it("disables Clear filters only when every resettable filter is clear", () => {
    const { rerender } = renderFilters(EMPTY_CONVERSATION_FILTERS);
    const clearFilters = screen.getByRole("button", { name: "Clear filters" });

    expect(clearFilters).toBeDisabled();

    rerender(
      <ConversationFiltersBar
        filters={{ ...EMPTY_CONVERSATION_FILTERS, titleQuery: "Alpha" }}
        onChange={vi.fn()}
        currentDate={() => new Date(NOW)}
      />,
    );
    expect(clearFilters).toBeEnabled();

    rerender(
      <ConversationFiltersBar
        filters={{
          titleQuery: "",
          dateField: "updatedAt",
          dateComparison: "before",
          cutoffLocalDay: olderThanPreset(7, NOW),
        }}
        onChange={vi.fn()}
        currentDate={() => new Date(NOW)}
      />,
    );
    expect(clearFilters).toBeEnabled();
  });

  it("keeps date changes in a draft until Apply and restores applied values after Cancel", async () => {
    const user = userEvent.setup();
    const appliedFilters: ConversationFilters = {
      titleQuery: "Alpha",
      dateField: "updatedAt",
      dateComparison: "before",
      cutoffLocalDay: olderThanPreset(7, NOW),
    };
    const { onChange } = renderFilters(appliedFilters);

    expect(
      screen.getByText("Last update: More than 7 days ago"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();

    const dateTrigger = screen.getByRole("button", { name: "Date" });
    await user.click(dateTrigger);
    let dialog = await screen.findByRole("dialog", { name: "Date" });
    expect(
      within(dialog).getByRole("radio", { name: "Last update" }),
    ).toHaveAttribute("checked");
    expect(
      within(dialog).getByRole("radio", { name: "More than 7 days ago" }),
    ).toHaveAttribute("checked");

    await user.click(
      within(dialog).getByRole("radio", { name: "Creation date" }),
    );
    await user.click(
      within(dialog).getByRole("radio", { name: "More than 30 days ago" }),
    );
    expect(onChange).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(dateTrigger).toHaveFocus();

    await user.click(dateTrigger);
    dialog = await screen.findByRole("dialog", { name: "Date" });
    expect(
      within(dialog).getByRole("radio", { name: "Last update" }),
    ).toHaveAttribute("checked");
    expect(
      within(dialog).getByRole("radio", { name: "More than 7 days ago" }),
    ).toHaveAttribute("checked");

    await user.click(
      within(dialog).getByRole("radio", { name: "Creation date" }),
    );
    await user.click(
      within(dialog).getByRole("radio", { name: "More than 30 days ago" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    expect(onChange).toHaveBeenCalledWith({
      ...appliedFilters,
      dateField: "createdAt",
      dateComparison: "before",
      cutoffLocalDay: olderThanPreset(30, NOW),
    });
    expect(dateTrigger).toHaveFocus();
  });

  it("keeps exact-date Before and After filtering available and closes on Escape", async () => {
    const user = userEvent.setup();
    const exactFilters: ConversationFilters = {
      titleQuery: "",
      dateField: "createdAt",
      dateComparison: "after",
      cutoffLocalDay: { year: 2026, month: 1, day: 1 },
    };
    const { onChange } = renderFilters(exactFilters);
    const dateTrigger = screen.getByRole("button", { name: "Date" });

    await user.click(dateTrigger);
    const dialog = await screen.findByRole("dialog", { name: "Date" });
    expect(
      within(dialog).getByRole("radio", { name: "Custom date…" }),
    ).toHaveAttribute("checked");
    expect(
      within(dialog).getByRole("radio", { name: "After date" }),
    ).toHaveAttribute("checked");
    expect(within(dialog).getByLabelText("Cutoff date")).toHaveValue(
      "2026-01-01",
    );

    await user.click(
      within(dialog).getByRole("radio", { name: "Before date" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith({
      ...exactFilters,
      dateComparison: "before",
    });

    await user.click(dateTrigger);
    await screen.findByRole("dialog", { name: "Date" });
    dateTrigger.focus();
    await user.keyboard("{Escape}");
    expect(dateTrigger).toHaveAttribute("aria-expanded", "false");
    expect(dateTrigger).toHaveFocus();
  });

  it("shows the Polish Custom date option copy", async () => {
    await i18n.changeLanguage("pl");
    const user = userEvent.setup();
    renderFilters(EMPTY_CONVERSATION_FILTERS);

    await user.click(screen.getByRole("button", { name: "Data" }));

    expect(
      within(await screen.findByRole("dialog", { name: "Data" })).getByRole(
        "radio",
        { name: "Niestandardowa data…" },
      ),
    ).toBeInTheDocument();
  });

  it("removes only the date criterion and clears all existing filter criteria", async () => {
    const user = userEvent.setup();
    const filters: ConversationFilters = {
      titleQuery: "Alpha",
      dateField: "updatedAt",
      dateComparison: "before",
      cutoffLocalDay: olderThanPreset(90, NOW),
    };
    const { onChange, rerender } = renderFilters(filters);

    await user.click(
      screen.getByRole("button", { name: "Remove date filter" }),
    );
    const filtersWithoutDate: ConversationFilters = {
      titleQuery: "Alpha",
      dateField: null,
      dateComparison: null,
      cutoffLocalDay: null,
    };
    expect(onChange).toHaveBeenLastCalledWith(filtersWithoutDate);

    rerender(
      <ConversationFiltersBar
        filters={filtersWithoutDate}
        onChange={onChange}
        currentDate={() => new Date(NOW)}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Remove date filter" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Date" }));
    const dialog = await screen.findByRole("dialog", { name: "Date" });
    expect(
      within(dialog).getByRole("radio", { name: "Last update" }),
    ).toHaveAttribute("checked");
    expect(
      within(dialog).getByRole("button", { name: "Apply" }),
    ).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onChange).toHaveBeenLastCalledWith(EMPTY_CONVERSATION_FILTERS);
  });
});
