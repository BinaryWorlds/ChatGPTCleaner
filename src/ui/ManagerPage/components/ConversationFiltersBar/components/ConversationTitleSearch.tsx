import { Input } from "antd";
import { useTranslation } from "react-i18next";

interface ConversationTitleSearchProps {
  readonly value: string;
  readonly onChange: (titleQuery: string) => void;
}

function ConversationTitleSearch({
  value,
  onChange,
}: ConversationTitleSearchProps) {
  const { t } = useTranslation();

  return (
    <Input.Search
      className="filter-title-search"
      aria-label={t("filters.searchTitles")}
      allowClear
      placeholder={t("filters.searchTitles")}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export default ConversationTitleSearch;
