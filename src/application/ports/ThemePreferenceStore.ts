import type { ThemePreference } from "application/themePreference";

export interface ThemePreferenceStore {
  loadThemePreference(): Promise<unknown>;
  saveThemePreference(preference: ThemePreference): Promise<void>;
}
