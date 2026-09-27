import { theme, type ThemeConfig } from "antd";
import type { ResolvedThemeMode } from "../application/themePreference";

const lightPalette = {
  colorPrimary: "#1677ff",
  colorBgLayout: "#f4f7fb",
  colorBgContainer: "#ffffff",
  colorBgElevated: "#ffffff",
  colorFillAlter: "#f6f9fd",
  colorText: "#17233a",
  colorTextSecondary: "#596579",
  colorTextTertiary: "#98a2b3",
  colorTextDisabled: "#667085",
  colorBorder: "#d9e2ee",
  colorBorderSecondary: "#e8edf4",
  colorBorderDisabled: "#c2cedd",
  colorBgContainerDisabled: "#eef2f6",
  colorPrimaryBg: "#eaf3ff",
  colorPrimaryBgHover: "#dcecff",
  colorPrimaryBorder: "#91caff",
  colorSuccess: "#237804",
  colorSuccessBg: "#f6ffed",
  colorSuccessBorder: "#95de64",
  colorError: "#a8071a",
  colorErrorBg: "#fff1f0",
  colorErrorBorder: "#ffa39e",
} as const;

const darkPalette = {
  colorPrimary: "#4096ff",
  colorBgLayout: "#0b1420",
  colorBgContainer: "#111d2c",
  colorBgElevated: "#162438",
  colorFillAlter: "#192a40",
  colorText: "#f3f6fb",
  colorTextSecondary: "#b6c3d4",
  colorTextTertiary: "#8795a8",
  colorTextDisabled: "#8795a8",
  colorBorder: "#2d4058",
  colorBorderSecondary: "#23344a",
  colorBorderDisabled: "#3c5069",
  colorBgContainerDisabled: "#1b2a3d",
  colorPrimaryBg: "#102d52",
  colorPrimaryBgHover: "#153b68",
  colorPrimaryBorder: "#356fae",
  colorSuccess: "#95de64",
  colorSuccessBg: "#162312",
  colorSuccessBorder: "#3c8618",
  colorError: "#ff9c9c",
  colorErrorBg: "#2a1215",
  colorErrorBorder: "#a61d24",
} as const;

const lightTableStatePalette = {
  headerSortActiveBg: "#f1f6fc",
  headerSortHoverBg: "#eaf2fb",
  bodySortBg: "#f9fbfe",
  rowSelectedBg: "#edf5ff",
  rowSelectedHoverBg: "#e5f0fd",
} as const;

const darkTableStatePalette = {
  headerSortActiveBg: "#162438",
  headerSortHoverBg: "#192a40",
  bodySortBg: "#142235",
  rowSelectedBg: "#182b43",
  rowSelectedHoverBg: "#1c324d",
} as const;

export function createManagerTheme(mode: ResolvedThemeMode): ThemeConfig {
  const palette = mode === "dark" ? darkPalette : lightPalette;
  const tableStatePalette =
    mode === "dark" ? darkTableStatePalette : lightTableStatePalette;

  return {
    algorithm: mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: palette,
    components: {
      Card: {
        headerBg: palette.colorBgContainer,
      },
      Segmented: {
        itemColor: palette.colorTextSecondary,
        itemHoverColor: palette.colorPrimary,
        itemHoverBg: palette.colorPrimaryBgHover,
        itemActiveBg: palette.colorPrimaryBgHover,
        itemSelectedBg: palette.colorPrimaryBg,
        itemSelectedColor: palette.colorPrimary,
        trackBg: palette.colorFillAlter,
      },
      Table: {
        headerBg: palette.colorFillAlter,
        headerColor: palette.colorText,
        headerSortActiveBg: tableStatePalette.headerSortActiveBg,
        headerSortHoverBg: tableStatePalette.headerSortHoverBg,
        bodySortBg: tableStatePalette.bodySortBg,
        rowHoverBg: palette.colorFillAlter,
        rowSelectedBg: tableStatePalette.rowSelectedBg,
        rowSelectedHoverBg: tableStatePalette.rowSelectedHoverBg,
        borderColor: palette.colorBorderSecondary,
        headerSplitColor: palette.colorBorder,
      },
    },
  };
}
