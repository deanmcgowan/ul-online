import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getStrings, resolveAppLanguage, type AppStrings, type SupportedLanguage } from "@/lib/i18n";
import { loadPreferences, savePreferences, type AppPreferences, PREFERENCE_STORAGE_KEYS } from "@/lib/preferences";

interface AppPreferencesContextValue {
  preferences: AppPreferences;
  resolvedLanguage: SupportedLanguage;
  strings: AppStrings;
  updatePreferences: (updates: Partial<AppPreferences>) => void;
}

const AppPreferencesContext = createContext<AppPreferencesContextValue | null>(null);

export function AppPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState(loadPreferences);

  const resolvedLanguage = useMemo(
    () => resolveAppLanguage(preferences.language),
    [preferences.language],
  );

  const strings = useMemo(() => getStrings(resolvedLanguage), [resolvedLanguage]);

  const updatePreferences = useCallback((updates: Partial<AppPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...updates };
      savePreferences(next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = resolvedLanguage;
    document.title = strings.appTitle;
  }, [resolvedLanguage, strings.appTitle]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key && !PREFERENCE_STORAGE_KEYS.includes(event.key)) {
        return;
      }

      setPreferences(loadPreferences());
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value = useMemo(
    () => ({ preferences, resolvedLanguage, strings, updatePreferences }),
    [preferences, resolvedLanguage, strings, updatePreferences],
  );

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>;
}

export function useAppPreferences() {
  const context = useContext(AppPreferencesContext);
  if (!context) {
    throw new Error("useAppPreferences must be used within AppPreferencesProvider");
  }

  return context;
}