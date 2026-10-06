import { Flex, Typography } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ThemePreference } from "../../application/themePreference";
import LanguageSelector from "./LanguageSelector";
import ThemePreferenceSelector from "./ThemePreferenceSelector";

interface ManagerHeaderProps {
  readonly themePreference: ThemePreference;
  readonly themePreferencePending: boolean;
  readonly onThemePreferenceChange: (preference: ThemePreference) => void;
  readonly status?: ReactNode;
  readonly children?: ReactNode;
}

export default function ManagerHeader({
  themePreference,
  themePreferencePending,
  onThemePreferenceChange,
  status,
  children,
}: ManagerHeaderProps) {
  const { t } = useTranslation();

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
          <LanguageSelector />
          <ThemePreferenceSelector
            themePreference={themePreference}
            themePreferencePending={themePreferencePending}
            onThemePreferenceChange={onThemePreferenceChange}
          />
        </Flex>
      </Flex>
    </Flex>
  );
}
