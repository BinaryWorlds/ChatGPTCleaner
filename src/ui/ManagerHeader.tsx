import { DesktopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Flex, Segmented, Space, Typography } from "antd";
import type { ReactNode } from "react";
import type { ThemePreference } from "../application/themePreference";

interface ManagerHeaderProps {
  readonly themePreference: ThemePreference;
  readonly themePreferencePending: boolean;
  readonly onThemePreferenceChange: (preference: ThemePreference) => void;
  readonly children?: ReactNode;
}

export function ManagerHeader({
  themePreference,
  themePreferencePending,
  onThemePreferenceChange,
  children,
}: ManagerHeaderProps) {
  return (
    <Flex
      className="manager-page-header"
      justify="space-between"
      align="center"
      wrap
      gap="middle"
    >
      <div>
        <Typography.Title level={2}>ChatGPTCleaner</Typography.Title>
        <Typography.Text type="secondary">
          Review and delete standalone conversations with explicit safety
          checks.
        </Typography.Text>
      </div>
      <Space>
        <Segmented<ThemePreference>
          aria-label="Theme preference"
          value={themePreference}
          disabled={themePreferencePending}
          options={[
            {
              label: "Auto",
              value: "auto",
              icon: <DesktopOutlined aria-hidden />,
            },
            {
              label: "Light",
              value: "light",
              icon: <SunOutlined aria-hidden />,
            },
            {
              label: "Dark",
              value: "dark",
              icon: <MoonOutlined aria-hidden />,
            },
          ]}
          onChange={onThemePreferenceChange}
        />
        {children}
      </Space>
    </Flex>
  );
}
