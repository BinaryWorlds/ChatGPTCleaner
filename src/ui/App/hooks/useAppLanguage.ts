import dayjs from "dayjs";
import "dayjs/locale/en";
import "dayjs/locale/pl";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { detectBrowserLanguage } from "i18n/detectLanguage";
import appI18n, { activeAppLanguage } from "i18n/i18n";

export function useAppLanguage() {
  const { i18n } = useTranslation();
  const [initialLanguage] = useState(detectBrowserLanguage);
  const appLanguage = activeAppLanguage(i18n.resolvedLanguage);

  useEffect(() => {
    void appI18n.changeLanguage(initialLanguage);
  }, [initialLanguage]);

  useEffect(() => {
    document.documentElement.lang = appLanguage;
    dayjs.locale(appLanguage);
  }, [appLanguage]);

  return appLanguage;
}
