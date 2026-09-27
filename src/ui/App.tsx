import { Alert, ConfigProvider, Layout, Space } from "antd";
import enUS from "antd/locale/en_US";
import plPL from "antd/locale/pl_PL";
import dayjs from "dayjs";
import "dayjs/locale/en";
import "dayjs/locale/pl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  normalizeThemePreference,
  type ResolvedThemeMode,
  type ThemePreference,
} from "../application/themePreference";
import type { ManagerComposition } from "../composition/types";
import { detectBrowserLanguage } from "../i18n/detectLanguage";
import appI18n, { activeAppLanguage } from "../i18n/i18n";
import { ManagerHeader } from "./ManagerHeader";
import { ManagerPage } from "./ManagerPage";
import { createManagerTheme } from "./managerTheme";

const { Content } = Layout;

interface AppProps {
  readonly composition: ManagerComposition;
}

export function App({ composition }: AppProps) {
  const { t, i18n } = useTranslation();
  const [initialLanguage] = useState(detectBrowserLanguage);
  const appLanguage = activeAppLanguage(i18n.resolvedLanguage);
  const [themePreference, setThemePreference] =
    useState<ThemePreference>("auto");
  const [systemTheme, setSystemTheme] = useState<ResolvedThemeMode>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );
  const [themePreferencePending, setThemePreferencePending] = useState(true);
  const themePreferencePendingRef = useRef(true);

  useEffect(() => {
    void appI18n.changeLanguage(initialLanguage);
  }, [initialLanguage]);

  useEffect(() => {
    let current = true;
    composition.themePreferenceStore
      .loadThemePreference()
      .then((storedPreference) => {
        if (current) {
          setThemePreference(normalizeThemePreference(storedPreference));
        }
      })
      .catch(() => {
        if (current) setThemePreference("auto");
      })
      .finally(() => {
        if (!current) return;
        themePreferencePendingRef.current = false;
        setThemePreferencePending(false);
      });
    return () => {
      current = false;
    };
  }, [composition.themePreferenceStore]);

  useEffect(() => {
    if (themePreference !== "auto") return;
    const systemPreference = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () =>
      setSystemTheme(systemPreference.matches ? "dark" : "light");
    updateSystemTheme();
    systemPreference.addEventListener("change", updateSystemTheme);
    return () =>
      systemPreference.removeEventListener("change", updateSystemTheme);
  }, [themePreference]);

  const resolvedTheme =
    themePreference === "auto" ? systemTheme : themePreference;
  const managerTheme = useMemo(
    () => createManagerTheme(resolvedTheme),
    [resolvedTheme],
  );

  useEffect(() => {
    const previousColorScheme = document.documentElement.style.colorScheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    return () => {
      document.documentElement.style.colorScheme = previousColorScheme;
    };
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.lang = appLanguage;
    dayjs.locale(appLanguage);
  }, [appLanguage]);

  const handleThemePreferenceChange = (preference: ThemePreference) => {
    if (themePreferencePendingRef.current) return;
    const previousPreference = themePreference;
    themePreferencePendingRef.current = true;
    setThemePreferencePending(true);
    setThemePreference(preference);
    composition.themePreferenceStore
      .saveThemePreference(preference)
      .catch(() => setThemePreference(previousPreference))
      .finally(() => {
        themePreferencePendingRef.current = false;
        setThemePreferencePending(false);
      });
  };

  return (
    <ConfigProvider
      locale={appLanguage === "pl" ? plPL : enUS}
      theme={managerTheme}
    >
      <Layout className="manager-shell">
        <Content className="manager-content">
          {composition.dependencies !== null ? (
            <ManagerPage
              mode={composition.mode}
              dependencies={composition.dependencies}
              themePreference={themePreference}
              themePreferencePending={themePreferencePending}
              onThemePreferenceChange={handleThemePreferenceChange}
              openConversation={composition.openConversation}
            />
          ) : (
            <Space
              orientation="vertical"
              size="large"
              className="manager-panel"
            >
              <ManagerHeader
                themePreference={themePreference}
                themePreferencePending={themePreferencePending}
                onThemePreferenceChange={handleThemePreferenceChange}
              />
              <Alert type="warning" showIcon title={t("app.openChatGpt")} />
            </Space>
          )}
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
