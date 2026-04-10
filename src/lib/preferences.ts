export type LanguagePreference = "system" | "en-GB" | "sv-SE";

export interface AppPreferences {
  walkSpeed: number;
  bufferMinutes: number;
  maxWalkDistanceMeters: number;
  highAccuracyLocation: boolean;
  stopVisibilityZoom: number;
  language: LanguagePreference;
}

export const PREFERENCE_STORAGE_KEYS = [
  "walkSpeed",
  "bufferMinutes",
  "maxWalkDistanceMeters",
  "highAccuracyLocation",
  "stopVisibilityZoom",
  "language",
] as const;

export const DEFAULT_PREFERENCES: AppPreferences = {
  walkSpeed: 4,
  bufferMinutes: 5,
  maxWalkDistanceMeters: 1000,
  highAccuracyLocation: false,
  stopVisibilityZoom: 12,
  language: "system",
};

function readNumber(value: string | null, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readLanguagePreference(value: string | null): LanguagePreference {
  if (value === "en-GB" || value === "sv-SE" || value === "system") {
    return value;
  }

  return DEFAULT_PREFERENCES.language;
}

export function loadPreferences(): AppPreferences {
  return {
    walkSpeed: readNumber(localStorage.getItem("walkSpeed"), DEFAULT_PREFERENCES.walkSpeed),
    bufferMinutes: readNumber(localStorage.getItem("bufferMinutes"), DEFAULT_PREFERENCES.bufferMinutes),
    maxWalkDistanceMeters: readNumber(localStorage.getItem("maxWalkDistanceMeters"), DEFAULT_PREFERENCES.maxWalkDistanceMeters),
    highAccuracyLocation: localStorage.getItem("highAccuracyLocation") === "true",
    stopVisibilityZoom: readNumber(localStorage.getItem("stopVisibilityZoom"), DEFAULT_PREFERENCES.stopVisibilityZoom),
    language: readLanguagePreference(localStorage.getItem("language")),
  };
}

export function savePreferences(preferences: AppPreferences): void {
  localStorage.setItem("walkSpeed", preferences.walkSpeed.toString());
  localStorage.setItem("bufferMinutes", preferences.bufferMinutes.toString());
  localStorage.setItem("maxWalkDistanceMeters", preferences.maxWalkDistanceMeters.toString());
  localStorage.setItem("highAccuracyLocation", preferences.highAccuracyLocation.toString());
  localStorage.setItem("stopVisibilityZoom", preferences.stopVisibilityZoom.toString());
  localStorage.setItem("language", preferences.language);
}