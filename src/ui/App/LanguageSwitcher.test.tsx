import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createManagerComposition } from "../../composition/demo";
import i18n from "../../i18n/i18n";
import App from "./App";

function setBrowserLanguages(languages: readonly string[], language: string) {
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: languages,
  });
  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: language,
  });
}

describe("language switching", () => {
  afterEach(async () => {
    setBrowserLanguages(["en-US"], "en-US");
    await i18n.changeLanguage("en");
  });

  it("detects the browser language, switches both ways, and detects again on remount", async () => {
    const user = userEvent.setup();
    setBrowserLanguages(["pl-PL", "en-US"], "pl-PL");
    const firstRender = render(
      <App composition={createManagerComposition()} />,
    );

    // Initial browser-language detection.
    expect(
      await screen.findByRole("button", { name: "Odśwież listę rozmów" }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("pl");

    await user.click(screen.getByTitle("EN"));
    expect(
      await screen.findByRole("button", { name: "Refresh inventory" }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");

    await user.click(screen.getByTitle("PL"));
    expect(
      await screen.findByRole("button", { name: "Odśwież listę rozmów" }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("pl");

    // The manual English choice is intentionally not persisted.
    await user.click(screen.getByTitle("EN"));
    expect(
      await screen.findByRole("button", { name: "Refresh inventory" }),
    ).toBeInTheDocument();
    firstRender.unmount();

    // A fresh mount detects Polish again.
    render(<App composition={createManagerComposition()} />);
    expect(
      await screen.findByRole("button", { name: "Odśwież listę rozmów" }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("pl");
  }, 30_000);

  it("applies the Polish Ant Design pagination locale", async () => {
    setBrowserLanguages(["pl-PL"], "pl-PL");
    render(<App composition={createManagerComposition()} />);

    await screen.findByRole("table", { name: "Rozmowy poza projektami" });
    await waitFor(() =>
      expect(screen.getByTitle("Poprzednia strona")).toBeInTheDocument(),
    );
  });
});
