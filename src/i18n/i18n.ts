import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { detectBrowserLanguage, type AppLanguage } from "./detectLanguage";
import en from "./locales/en.json";
import pl from "./locales/pl.json";

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    pl: { translation: pl },
  },
  lng: detectBrowserLanguage(),
  fallbackLng: "en",
  supportedLngs: ["en", "pl"],
  interpolation: { escapeValue: false },
  initAsync: false,
});

export function activeAppLanguage(
  language = i18n.resolvedLanguage,
): AppLanguage {
  return language?.toLowerCase().startsWith("pl") ? "pl" : "en";
}

export default i18n;
