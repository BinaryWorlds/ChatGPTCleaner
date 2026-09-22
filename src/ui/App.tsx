import { Alert, Layout, Space, Typography } from "antd";
import type { ManagerComposition } from "../composition/types";
import { ManagerPage } from "./ManagerPage";

const { Content, Header } = Layout;

function hasSourceTab(): boolean {
  const sourceTabId = new URLSearchParams(window.location.search).get(
    "sourceTabId",
  );

  return sourceTabId !== null && /^\d+$/.test(sourceTabId);
}

export interface AppProps {
  readonly composition: ManagerComposition;
}

export function App({ composition }: AppProps) {
  const sourceTabAvailable = hasSourceTab();
  const demoMode = composition.mode === "demo";

  return (
    <Layout className="manager-shell">
      <Header className="manager-header">
        <Typography.Title level={2}>ChatGPTCleaner</Typography.Title>
      </Header>
      <Content className="manager-content">
        <Space orientation="vertical" size="large" className="manager-panel">
          <Typography.Paragraph>
            Review and delete standalone conversations with explicit safety
            checks.
          </Typography.Paragraph>
          {demoMode ? (
            <ManagerPage composition={composition} />
          ) : sourceTabAvailable ? (
            <Alert
              type="info"
              showIcon
              title="Extension bootstrap is ready"
              description="Conversation inventory and deletion remain disabled until the safety workflow is implemented."
            />
          ) : (
            <Alert
              type="warning"
              showIcon
              title="Open ChatGPT in a tab and launch ChatGPTCleaner from that tab."
            />
          )}
        </Space>
      </Content>
    </Layout>
  );
}
