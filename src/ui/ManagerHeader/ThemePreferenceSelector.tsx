import { DesktopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Segmented } from "antd";
import { useTranslation } from "react-i18next";
import type { ThemePreference } from "../../application/themePreference";

interface ThemePreferenceSelectorProps {
  readonly themePreference: ThemePreference;
  readonly themePreferencePending: boolean;
  readonly onThemePreferenceChange: (preference: ThemePreference) => void;
}

export default function ThemePreferenceSelector({
  themePreference,
  themePreferencePending,
  onThemePreferenceChange,
}: ThemePreferenceSelectorProps) {
  const { t } = useTranslation();

  return (
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
  );
}
