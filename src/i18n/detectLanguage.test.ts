import { describe, expect, it } from "vitest";
import { resolveLanguage } from "./detectLanguage";

describe("resolveLanguage", () => {
  it.each([
    [["pl-PL", "en-US"], "pl"],
    [["en-GB", "pl-PL"], "en"],
    [["de-DE", "pl-PL"], "pl"],
    [["de-DE", "en-US"], "en"],
    [["de-DE", "fr-FR"], "en"],
    [[], "en"],
    [["PL-pl"], "pl"],
    [["EN-us"], "en"],
  ] as const)("resolves %j to %s", (languages, expected) => {
    expect(resolveLanguage(languages)).toBe(expected);
  });

  it("uses the single browser language only when the language list is empty", () => {
    expect(resolveLanguage([], "pl-PL")).toBe("pl");
    expect(resolveLanguage(["de-DE"], "pl-PL")).toBe("en");
  });
});
