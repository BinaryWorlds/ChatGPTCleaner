import { describe, expect, it } from "vitest";
import { normalizeThemePreference } from "./themePreference";

describe("theme preference", () => {
  it.each([
    ["auto", "auto"],
    ["light", "light"],
    ["dark", "dark"],
    ["system", "auto"],
    [null, "auto"],
  ])("normalizes %j to %s", (stored, expected) => {
    expect(normalizeThemePreference(stored)).toBe(expected);
  });
});
