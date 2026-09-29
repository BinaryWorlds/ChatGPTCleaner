import { theme, type ThemeConfig } from "antd";
import type { ResolvedThemeMode } from "../application/themePreference";

const lightPalette = {
  colorPrimary: "#286fd6",
  colorPrimaryHover: "#3d80df",
  colorBgLayout: "#f8fafc",
  colorBgContainer: "#ffffff",
  colorBgElevated: "#ffffff",
  colorBgSpotlight: "#18212c",
  colorFillAlter: "#fafbfc",
  colorFillSecondary: "#f5f7fa",
  colorFillTertiary: "#fafbfc",
  colorText: "#182230",
  colorTextLightSolid: "#ffffff",
  colorTextSecondary: "#5f6b7a",
  colorTextTertiary: "#7b8796",
  colorTextDisabled: "#7f8a99",
  colorTextPlaceholder: "#7a8594",
  colorBorder: "#dfe5ec",
  colorBorderSecondary: "#e6ebf1",
  colorBorderDisabled: "#dce2e9",
  colorBgContainerDisabled: "#f5f7fa",
  colorPrimaryBg: "#eaf2ff",
  colorPrimaryBgHover: "#e2edff",
  colorPrimaryBorder: "#8fb7ee",
  colorSuccess: "#238653",
  colorSuccessBg: "#edf8f2",
  colorSuccessBorder: "#a6d8bb",
  colorWarning: "#ad6f17",
  colorError: "#c43d4d",
  colorErrorBg: "#fff1f2",
  colorErrorBorder: "#efb0b7",
} as const;

const darkPalette = {
  colorPrimary: "#4d8dff",
  colorPrimaryHover: "#67a0ff",
  colorBgLayout: "#090d12",
  colorBgContainer: "#0f151d",
  colorBgElevated: "#141c26",
  colorBgSpotlight: "#141c26",
  colorFillAlter: "#141c26",
  colorFillSecondary: "rgba(255, 255, 255, 0.055)",
  colorFillTertiary: "rgba(255, 255, 255, 0.035)",
  colorText: "#f2f5f9",
  colorTextLightSolid: "#ffffff",
  colorTextSecondary: "#a4afbd",
  colorTextTertiary: "#6f7b8b",
  colorTextDisabled: "#687484",
  colorTextPlaceholder: "#6f7b8b",
  colorBorder: "rgba(255, 255, 255, 0.12)",
  colorBorderSecondary: "rgba(255, 255, 255, 0.07)",
  colorBorderDisabled: "rgba(255, 255, 255, 0.09)",
  colorBgContainerDisabled: "#121922",
  colorPrimaryBg: "rgba(77, 141, 255, 0.10)",
  colorPrimaryBgHover: "rgba(77, 141, 255, 0.16)",
  colorPrimaryBorder: "rgba(77, 141, 255, 0.42)",
  colorSuccess: "#49c980",
  colorSuccessBg: "rgba(73, 201, 128, 0.09)",
  colorSuccessBorder: "rgba(73, 201, 128, 0.30)",
  colorWarning: "#e8af58",
  colorError: "#e66774",
  colorErrorBg: "rgba(230, 103, 116, 0.10)",
  colorErrorBorder: "rgba(230, 103, 116, 0.38)",
} as const;

const lightTableStatePalette = {
  headerSortActiveBg: "#f1f6fc",
  headerSortHoverBg: "#eaf2fb",
  bodySortBg: "#f9fbfe",
  rowSelectedBg: "#edf5ff",
  rowSelectedHoverBg: "#e5f0fd",
} as const;

const darkTableStatePalette = {
  headerSortActiveBg: "#18212c",
  headerSortHoverBg: "#1b2531",
  bodySortBg: "#111922",
  rowSelectedBg: "rgba(77, 141, 255, 0.10)",
  rowSelectedHoverBg: "rgba(77, 141, 255, 0.14)",
} as const;

export function createManagerTheme(mode: ResolvedThemeMode): ThemeConfig {
  const palette = mode === "dark" ? darkPalette : lightPalette;
  const tableStatePalette =
    mode === "dark" ? darkTableStatePalette : lightTableStatePalette;

  return {
    algorithm: mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      ...palette,
      borderRadius: 8,
      borderRadiusLG: 11,
      controlHeight: 34,
      controlHeightSM: 28,
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: 14,
      lineWidth: 1,
      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.12)",
      boxShadowSecondary: "0 8px 24px rgba(0, 0, 0, 0.10)",
    },
    components: {
      Button: {
        defaultBg: "transparent",
        defaultBorderColor: palette.colorBorder,
        defaultHoverBg: palette.colorFillAlter,
        defaultShadow: "none",
        primaryShadow: "none",
        dangerShadow: "none",
        fontWeight: 500,
      },
      Card: {
        headerBg: palette.colorBgContainer,
        headerFontSizeSM: 15,
        headerHeightSM: 44,
        headerPaddingSM: 16,
        bodyPaddingSM: 16,
      },
      Segmented: {
        itemColor: palette.colorTextSecondary,
        itemHoverColor:
          mode === "dark" ? palette.colorPrimary : palette.colorText,
        itemHoverBg:
          mode === "dark"
            ? palette.colorPrimaryBgHover
            : palette.colorFillSecondary,
        itemActiveBg: palette.colorPrimaryBgHover,
        itemSelectedBg: palette.colorPrimaryBg,
        itemSelectedColor: palette.colorPrimary,
        trackBg: palette.colorFillAlter,
      },
      Table: {
        headerBg:
          mode === "dark" ? palette.colorFillAlter : palette.colorBgContainer,
        headerColor: palette.colorText,
        headerSortActiveBg: tableStatePalette.headerSortActiveBg,
        headerSortHoverBg: tableStatePalette.headerSortHoverBg,
        bodySortBg: tableStatePalette.bodySortBg,
        rowHoverBg: palette.colorFillAlter,
        rowSelectedBg: tableStatePalette.rowSelectedBg,
        rowSelectedHoverBg: tableStatePalette.rowSelectedHoverBg,
        borderColor: palette.colorBorderSecondary,
        headerSplitColor: palette.colorBorder,
        cellPaddingBlock: 12,
        cellPaddingInline: 14,
        cellFontSize: 13,
        headerBorderRadius: 8,
      },
      Pagination: {
        itemBg: "transparent",
        itemLinkBg: "transparent",
        itemActiveBg: palette.colorPrimaryBg,
        itemActiveColor: palette.colorPrimary,
        itemActiveColorHover: palette.colorPrimaryHover,
      },
      Statistic: {
        contentFontSize: 24,
        titleFontSize: 12,
      },
    },
  };
}
