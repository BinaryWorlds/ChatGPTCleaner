import { Alert, Layout, Space, Typography } from "antd";
import type { ManagerComposition } from "../composition/types";
import { ManagerPage } from "./ManagerPage";

const { Content, Header } = Layout;

interface AppProps {
  readonly composition: ManagerComposition;
}

export function App({ composition }: AppProps) {
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
          {composition.sourceAvailable ? (
            <ManagerPage composition={composition} />
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
