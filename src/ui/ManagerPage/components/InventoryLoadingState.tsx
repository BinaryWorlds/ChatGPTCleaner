import { Flex, Spin } from "antd";

interface InventoryLoadingStateProps {
  readonly text: string | null;
}

export default function InventoryLoadingState({
  text,
}: InventoryLoadingStateProps) {
  return (
    <div className="inventory-loading-surface">
      <Flex align="center" gap="small" role="status">
        <Spin size="small" />
        <span>{text}</span>
      </Flex>
      <div className="inventory-loading-track" aria-hidden />
    </div>
  );
}
