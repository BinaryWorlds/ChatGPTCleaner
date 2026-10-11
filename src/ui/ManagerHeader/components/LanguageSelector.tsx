import { Segmented } from "antd";
import { useTranslation } from "react-i18next";
import type { AppLanguage } from "i18n/detectLanguage";
import { activeAppLanguage } from "i18n/i18n";

export default function LanguageSelector() {
  const { t, i18n } = useTranslation();
  const language = activeAppLanguage(i18n.resolvedLanguage);

  return (
    <Segmented<AppLanguage>
      aria-label={t("language.label")}
      name="language"
      value={language}
      options={[
        { label: t("language.polish"), value: "pl" },
        { label: t("language.english"), value: "en" },
      ]}
      onChange={(nextLanguage) => void i18n.changeLanguage(nextLanguage)}
    />
  );
}
