import { CloseOutlined } from "@ant-design/icons";
import { Button, Tag } from "antd";
import { useTranslation } from "react-i18next";

interface AppliedDateFilterTagProps {
  readonly description: string;
  readonly onRemove: () => void;
}

function AppliedDateFilterTag({
  description,
  onRemove,
}: AppliedDateFilterTagProps) {
  const { t } = useTranslation();

  return (
    <Tag className="applied-date-filter">
      <span>{description}</span>
      <Button
        type="text"
        size="small"
        icon={<CloseOutlined aria-hidden />}
        aria-label={t("filters.removeDate")}
        onClick={onRemove}
      />
    </Tag>
  );
}

export default AppliedDateFilterTag;
