import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createManagerComposition } from "../composition/demo";
import i18n from "../i18n/i18n";
import { App } from "./App";

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

  it("uses the browser language and switches the visible UI both ways", async () => {
    const user = userEvent.setup();
    setBrowserLanguages(["pl-PL", "en-US"], "pl-PL");
    render(<App composition={createManagerComposition()} />);

    expect(await screen.findByText("Stan bezpieczeństwa")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("pl");

    await user.click(screen.getByTitle("EN"));
    expect(await screen.findByText("Safety status")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");

    await user.click(screen.getByTitle("PL"));
    expect(await screen.findByText("Stan bezpieczeństwa")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("pl");
  });

  it("does not persist a manual choice and detects again on a fresh mount", async () => {
    const user = userEvent.setup();
    setBrowserLanguages(["pl-PL"], "pl-PL");
    const firstRender = render(
      <App composition={createManagerComposition()} />,
    );
    expect(await screen.findByText("Stan bezpieczeństwa")).toBeInTheDocument();

    await user.click(screen.getByTitle("EN"));
    expect(await screen.findByText("Safety status")).toBeInTheDocument();
    firstRender.unmount();

    render(<App composition={createManagerComposition()} />);
    expect(await screen.findByText("Stan bezpieczeństwa")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("pl");
  });

  it("applies the Polish Ant Design pagination locale", async () => {
    setBrowserLanguages(["pl-PL"], "pl-PL");
    render(<App composition={createManagerComposition()} />);

    await screen.findByRole("table", { name: "Rozmowy poza projektami" });
    await waitFor(() =>
      expect(screen.getByTitle("Poprzednia strona")).toBeInTheDocument(),
    );
  });
});
