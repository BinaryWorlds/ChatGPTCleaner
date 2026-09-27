import type { ThemePreference } from "../themePreference";

export interface ThemePreferenceStore {
  loadThemePreference(): Promise<unknown>;
  saveThemePreference(preference: ThemePreference): Promise<void>;
}
