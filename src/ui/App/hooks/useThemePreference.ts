import { useEffect, useRef, useState } from "react";
import {
  normalizeThemePreference,
  type ResolvedThemeMode,
  type ThemePreference,
} from "application/themePreference";
import type { ThemePreferenceStore } from "application/ports/ThemePreferenceStore";

interface ThemePreferenceState {
  readonly themePreference: ThemePreference;
  readonly themePreferencePending: boolean;
  readonly resolvedTheme: ResolvedThemeMode;
  readonly handleThemePreferenceChange: (preference: ThemePreference) => void;
}

function currentSystemTheme(): ResolvedThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useThemePreference(
  themePreferenceStore: ThemePreferenceStore,
): ThemePreferenceState {
  const [themePreference, setThemePreference] =
    useState<ThemePreference>("auto");
  const [systemTheme, setSystemTheme] =
    useState<ResolvedThemeMode>(currentSystemTheme);
  const [themePreferencePending, setThemePreferencePending] = useState(true);
  const themePreferencePendingRef = useRef(true);

  useEffect(() => {
    let current = true;
    themePreferenceStore
      .loadThemePreference()
      .then((storedPreference) => {
        if (current) {
          setThemePreference(normalizeThemePreference(storedPreference));
        }
      })
      .catch(() => {
        if (current) setThemePreference("auto");
      })
      .finally(() => {
        if (!current) return;
        themePreferencePendingRef.current = false;
        setThemePreferencePending(false);
      });
    return () => {
      current = false;
    };
  }, [themePreferenceStore]);

  useEffect(() => {
    if (themePreference !== "auto") return;
    const systemPreference = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () =>
      setSystemTheme(systemPreference.matches ? "dark" : "light");
    updateSystemTheme();
    systemPreference.addEventListener("change", updateSystemTheme);
    return () =>
      systemPreference.removeEventListener("change", updateSystemTheme);
  }, [themePreference]);

  const resolvedTheme =
    themePreference === "auto" ? systemTheme : themePreference;

  useEffect(() => {
    const previousColorScheme = document.documentElement.style.colorScheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    return () => {
      document.documentElement.style.colorScheme = previousColorScheme;
    };
  }, [resolvedTheme]);

  const handleThemePreferenceChange = (preference: ThemePreference) => {
    if (themePreferencePendingRef.current) return;
    const previousPreference = themePreference;
    themePreferencePendingRef.current = true;
    setThemePreferencePending(true);
    setThemePreference(preference);
    themePreferenceStore
      .saveThemePreference(preference)
      .catch(() => setThemePreference(previousPreference))
      .finally(() => {
        themePreferencePendingRef.current = false;
        setThemePreferencePending(false);
      });
  };

  return {
    themePreference,
    themePreferencePending,
    resolvedTheme,
    handleThemePreferenceChange,
  };
}
