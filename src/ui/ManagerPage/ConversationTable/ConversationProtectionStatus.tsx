import { LockFilled, UnlockOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

type ConversationProtectionStatusProps =
  | {
      readonly view: "standalone";
      readonly protectedConversation: boolean;
    }
  | {
      readonly view: "projects";
      readonly protectedConversation?: never;
    };

export default function ConversationProtectionStatus(
  props: ConversationProtectionStatusProps,
) {
  const { t } = useTranslation();

  if (props.view === "projects") {
    return (
      <Tooltip title={t("table.projectProtectedTooltip")}>
        <span
          className="protection-icon protection-icon-protected"
          aria-label={t("table.projectProtected")}
        >
          <LockFilled aria-hidden />
        </span>
      </Tooltip>
    );
  }

  const label = props.protectedConversation
    ? t("table.protectedTooltip")
    : t("table.unprotectedTooltip");

  return (
    <Tooltip title={label}>
      {props.protectedConversation ? (
        <span
          className="protection-icon protection-icon-protected"
          aria-label={label}
        >
          <LockFilled aria-hidden />
        </span>
      ) : (
        <span
          className="protection-icon protection-icon-unprotected"
          aria-label={label}
        >
          <UnlockOutlined aria-hidden />
        </span>
      )}
    </Tooltip>
  );
}
