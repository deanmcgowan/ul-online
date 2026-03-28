export interface AppPreferences {
  walkSpeed: number;
  runSpeed: number;
  bufferMinutes: number;
  showSkolskjuts: boolean;
  highAccuracyLocation: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  walkSpeed: 4,
  runSpeed: 9,
  bufferMinutes: 5,
  showSkolskjuts: false,
  highAccuracyLocation: false,
};

function readNumber(value: string | null, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadPreferences(): AppPreferences {
  return {
    walkSpeed: readNumber(localStorage.getItem("walkSpeed"), DEFAULT_PREFERENCES.walkSpeed),
    runSpeed: readNumber(localStorage.getItem("runSpeed"), DEFAULT_PREFERENCES.runSpeed),
    bufferMinutes: readNumber(localStorage.getItem("bufferMinutes"), DEFAULT_PREFERENCES.bufferMinutes),
    showSkolskjuts: localStorage.getItem("showSkolskjuts") === "true",
    highAccuracyLocation: localStorage.getItem("highAccuracyLocation") === "true",
  };
}

export function savePreferences(preferences: AppPreferences): void {
  localStorage.setItem("walkSpeed", preferences.walkSpeed.toString());
  localStorage.setItem("runSpeed", preferences.runSpeed.toString());
  localStorage.setItem("bufferMinutes", preferences.bufferMinutes.toString());
  localStorage.setItem("showSkolskjuts", preferences.showSkolskjuts.toString());
  localStorage.setItem("highAccuracyLocation", preferences.highAccuracyLocation.toString());
}