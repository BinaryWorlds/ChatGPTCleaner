import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import pl from "./locales/pl.json";

const locales = { en, pl } as const;

function collectTextLeaves(
  value: unknown,
  path = "",
): ReadonlyMap<string, string> {
  const leaves = new Map<string, string>();
  if (typeof value === "string") {
    leaves.set(path, value);
    return leaves;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Translation value at ${path || "<root>"} is not text`);
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path.length === 0 ? key : `${path}.${key}`;
    for (const [leafPath, text] of collectTextLeaves(child, childPath)) {
      leaves.set(leafPath, text);
    }
  }
  return leaves;
}

describe("translations", () => {
  it("keeps every locale complete with non-empty text leaves", () => {
    const referenceKeys = [...collectTextLeaves(locales.en).keys()].sort();

    for (const [locale, translations] of Object.entries(locales)) {
      const leaves = collectTextLeaves(translations);
      expect([...leaves.keys()].sort(), locale).toEqual(referenceKeys);
      for (const [key, text] of leaves) {
        expect(text.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("uses the intended localized Actions column label", () => {
    expect(en.table.actions).toBe("Actions");
    expect(pl.table.actions).toBe("Akcje");
  });
});
