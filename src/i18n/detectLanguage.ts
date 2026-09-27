export const supportedLanguages = ["en", "pl"] as const;

export type AppLanguage = (typeof supportedLanguages)[number];

export function resolveLanguage(
  languages: readonly string[],
  fallbackLanguage?: string,
): AppLanguage {
  const candidates =
    languages.length > 0
      ? languages
      : fallbackLanguage === undefined
        ? []
        : [fallbackLanguage];

  for (const candidate of candidates) {
    const language = candidate.trim().toLowerCase().split("-")[0];
    if (language === "pl" || language === "en") return language;
  }

  return "en";
}

export function detectBrowserLanguage(
  browserNavigator: Pick<Navigator, "language" | "languages"> = navigator,
): AppLanguage {
  return resolveLanguage(
    browserNavigator.languages ?? [],
    browserNavigator.language,
  );
}
