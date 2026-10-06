import { ConfigProvider, Layout, Space } from "antd";
import enUS from "antd/locale/en_US";
import plPL from "antd/locale/pl_PL";
import { useMemo } from "react";
import type { ManagerComposition } from "../../composition/types";
import ManagerHeader from "../ManagerHeader";
import ManagerPage from "../ManagerPage";
import { createManagerTheme } from "../managerTheme";
import SafetyStatus from "../SafetyStatus";
import { useAppLanguage } from "./hooks/useAppLanguage";
import { useThemePreference } from "./hooks/useThemePreference";

const { Content } = Layout;

interface AppProps {
  readonly composition: ManagerComposition;
}

export default function App({ composition }: AppProps) {
  const appLanguage = useAppLanguage();
  const {
    themePreference,
    themePreferencePending,
    resolvedTheme,
    handleThemePreferenceChange,
  } = useThemePreference(composition.themePreferenceStore);
  const managerTheme = useMemo(
    () => createManagerTheme(resolvedTheme),
    [resolvedTheme],
  );

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
              copyConversationId={composition.copyConversationId}
              {...(composition.sourceTabLifecycle === undefined
                ? {}
                : { sourceTabLifecycle: composition.sourceTabLifecycle })}
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
              <SafetyStatus state={{ kind: "unbound" }} />
            </Space>
          )}
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
