import { useCallback, useEffect, useState } from "react";
import {
  loadSavedPlaces,
  removeSavedPlace as removeStoredSavedPlace,
  saveSavedPlaces,
  SAVED_PLACES_STORAGE_KEY,
  type SavedPlace,
  type SavedPlaceDraft,
  upsertSavedPlace,
} from "@/lib/savedPlaces";

export function useSavedPlaces() {
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>(loadSavedPlaces);

  const persist = useCallback((nextPlaces: SavedPlace[]) => {
    setSavedPlaces(saveSavedPlaces(nextPlaces));
  }, []);

  const upsertPlace = useCallback((draft: SavedPlaceDraft) => {
    persist(upsertSavedPlace(loadSavedPlaces(), draft));
  }, [persist]);

  const removePlace = useCallback((placeId: string) => {
    persist(removeStoredSavedPlace(loadSavedPlaces(), placeId));
  }, [persist]);

  const getPlaceByKind = useCallback(
    (kind: SavedPlace["kind"]) => savedPlaces.find((place) => place.kind === kind) ?? null,
    [savedPlaces],
  );

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== SAVED_PLACES_STORAGE_KEY) {
        return;
      }

      setSavedPlaces(loadSavedPlaces());
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return {
    savedPlaces,
    upsertPlace,
    removePlace,
    getPlaceByKind,
  };
}
