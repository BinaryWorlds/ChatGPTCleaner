import { DesktopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Flex, Segmented, Typography } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ThemePreference } from "../application/themePreference";
import { activeAppLanguage } from "../i18n/i18n";
import type { AppLanguage } from "../i18n/detectLanguage";

interface ManagerHeaderProps {
  readonly themePreference: ThemePreference;
  readonly themePreferencePending: boolean;
  readonly onThemePreferenceChange: (preference: ThemePreference) => void;
  readonly status?: ReactNode;
  readonly children?: ReactNode;
}

export function ManagerHeader({
  themePreference,
  themePreferencePending,
  onThemePreferenceChange,
  status,
  children,
}: ManagerHeaderProps) {
  const { t, i18n } = useTranslation();
  const language = activeAppLanguage(i18n.resolvedLanguage);

  return (
    <Flex
      className="manager-page-header"
      justify="space-between"
      align="center"
      wrap
      gap="middle"
    >
      <div className="manager-header-copy">
        <Typography.Title level={2}>{t("app.title")}</Typography.Title>
        <Typography.Text type="secondary">{t("app.subtitle")}</Typography.Text>
      </div>
      <Flex className="manager-header-actions" align="center" gap="middle">
        <div className="manager-header-status">{status}</div>
        <Flex className="manager-header-controls" wrap gap="small">
          {children}
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
          <Segmented<ThemePreference>
            aria-label={t("theme.label")}
            name="theme-preference"
            value={themePreference}
            disabled={themePreferencePending}
            options={[
              {
                label: t("theme.auto"),
                value: "auto",
                icon: <DesktopOutlined aria-hidden />,
              },
              {
                label: t("theme.light"),
                value: "light",
                icon: <SunOutlined aria-hidden />,
              },
              {
                label: t("theme.dark"),
                value: "dark",
                icon: <MoonOutlined aria-hidden />,
              },
            ]}
            onChange={onThemePreferenceChange}
          />
        </Flex>
      </Flex>
    </Flex>
  );
}
