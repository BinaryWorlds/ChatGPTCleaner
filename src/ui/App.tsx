import { Alert, Layout, Space, Typography } from "antd";

const { Content, Header } = Layout;

function hasSourceTab(): boolean {
  const sourceTabId = new URLSearchParams(window.location.search).get(
    "sourceTabId",
  );

  return sourceTabId !== null && /^\d+$/.test(sourceTabId);
}

export function App() {
  const sourceTabAvailable = hasSourceTab();

  return (
    <Layout className="manager-shell">
      <Header className="manager-header">
        <Typography.Title level={2}>ChatGPTCleaner</Typography.Title>
      </Header>
      <Content className="manager-content">
        <Space direction="vertical" size="large" className="manager-panel">
          <Typography.Paragraph>
            Review and delete standalone conversations with explicit safety
            checks.
          </Typography.Paragraph>
          {sourceTabAvailable ? (
            <Alert
              type="info"
              showIcon
              message="Extension bootstrap is ready"
              description="Conversation inventory and deletion remain disabled until the safety workflow is implemented."
            />
          ) : (
            <Alert
              type="warning"
              showIcon
              message="Open ChatGPT in a tab and launch ChatGPTCleaner from that tab."
            />
          )}
        </Space>
      </Content>
    </Layout>
  );
}
