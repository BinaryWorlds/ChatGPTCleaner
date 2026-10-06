import { Space, theme, Typography } from "antd";
import type { ReactNode } from "react";

interface SectionHeadingProps {
  readonly id: string;
  readonly icon: ReactNode;
  readonly children: ReactNode;
}

export default function SectionHeading({
  id,
  icon,
  children,
}: SectionHeadingProps) {
  const { token } = theme.useToken();

  return (
    <Typography.Title id={id} level={5} style={{ margin: 0 }}>
      <Space size={token.marginXS}>
        {icon}
        <span>{children}</span>
      </Space>
    </Typography.Title>
  );
}
