export type SavedPlaceKind = "home" | "work" | "school" | "other";

export interface SavedPlace {
  id: string;
  kind: SavedPlaceKind;
  label: string;
  displayName: string;
  lat: number;
  lon: number;
  createdAt: number;
  updatedAt: number;
}

export type SavedPlaceDraft = Omit<SavedPlace, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export const SAVED_PLACES_STORAGE_KEY = "savedPlaces";

const PLACE_KIND_ORDER: Record<SavedPlaceKind, number> = {
  home: 0,
  work: 1,
  school: 1,
  other: 2,
};

function normalizeSavedPlaces(places: SavedPlace[]): SavedPlace[] {
  const primaryDestination = places
    .filter((place) => place.kind === "work" || place.kind === "school")
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];

  return places.flatMap((place) => {
    if (place.kind === "school") {
      if (primaryDestination?.id !== place.id) {
        return [];
      }

      return [{ ...place, kind: "work" as const }];
    }

    if (place.kind === "work") {
      if (primaryDestination?.id !== place.id) {
        return [];
      }

      return [place];
    }

    return [place];
  });
}

function isSavedPlaceKind(value: unknown): value is SavedPlaceKind {
  return value === "home" || value === "work" || value === "school" || value === "other";
}

function isSavedPlace(value: unknown): value is SavedPlace {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SavedPlace>;
  return (
    typeof candidate.id === "string" &&
    isSavedPlaceKind(candidate.kind) &&
    typeof candidate.label === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.lat === "number" &&
    Number.isFinite(candidate.lat) &&
    typeof candidate.lon === "number" &&
    Number.isFinite(candidate.lon) &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number"
  );
}

export function getDefaultPlaceLabel(kind: SavedPlaceKind): string {
  switch (kind) {
    case "home":
      return "Home";
    case "work":
      return "Work / school";
    case "school":
      return "Work / school";
    default:
      return "Saved place";
  }
}

export function sortSavedPlaces(places: SavedPlace[]): SavedPlace[] {
  return [...places].sort((left, right) => {
    const orderDiff = PLACE_KIND_ORDER[left.kind] - PLACE_KIND_ORDER[right.kind];
    if (orderDiff !== 0) {
      return orderDiff;
    }

    return left.label.localeCompare(right.label);
  });
}

export function loadSavedPlaces(): SavedPlace[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_PLACES_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    return sortSavedPlaces(normalizeSavedPlaces(parsed.filter(isSavedPlace)));
  } catch {
    return [];
  }
}

export function saveSavedPlaces(places: SavedPlace[]): SavedPlace[] {
  const sorted = sortSavedPlaces(normalizeSavedPlaces(places));
  localStorage.setItem(SAVED_PLACES_STORAGE_KEY, JSON.stringify(sorted));
  return sorted;
}

export function upsertSavedPlace(currentPlaces: SavedPlace[], draft: SavedPlaceDraft): SavedPlace[] {
  const existing = draft.id
    ? currentPlaces.find((place) => place.id === draft.id)
    : currentPlaces.find((place) => place.kind === draft.kind && draft.kind !== "other");

  const nextPlace: SavedPlace = {
    id: existing?.id ?? draft.id ?? crypto.randomUUID(),
    kind: draft.kind,
    label: draft.label.trim() || getDefaultPlaceLabel(draft.kind),
    displayName: draft.displayName.trim(),
    lat: draft.lat,
    lon: draft.lon,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };

  const nextPlaces = currentPlaces.filter((place) => {
    if (place.id === nextPlace.id) {
      return false;
    }

    if (nextPlace.kind === "work" && (place.kind === "work" || place.kind === "school")) {
      return false;
    }

    if (nextPlace.kind === "school" && (place.kind === "work" || place.kind === "school")) {
      return false;
    }

    if (nextPlace.kind !== "other" && nextPlace.kind !== "work" && nextPlace.kind !== "school" && place.kind === nextPlace.kind) {
      return false;
    }

    return true;
  });

  return sortSavedPlaces([...nextPlaces, nextPlace]);
}

export function removeSavedPlace(currentPlaces: SavedPlace[], placeId: string): SavedPlace[] {
  return sortSavedPlaces(currentPlaces.filter((place) => place.id !== placeId));
}
