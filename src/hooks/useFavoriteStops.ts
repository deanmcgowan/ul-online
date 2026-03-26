import { useState, useCallback } from "react";
import type { TransitStop } from "@/components/BusMap";

const STORAGE_KEY = "favoriteStops";

function loadFavorites(): TransitStop[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function useFavoriteStops() {
  const [favorites, setFavorites] = useState<TransitStop[]>(loadFavorites);

  const save = (next: TransitStop[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setFavorites(next);
  };

  const addFavorite = useCallback((stop: TransitStop) => {
    const current = loadFavorites();
    if (current.some((s) => s.stop_id === stop.stop_id)) return;
    save([...current, stop]);
  }, []);

  const removeFavorite = useCallback((stopId: string) => {
    save(loadFavorites().filter((s) => s.stop_id !== stopId));
  }, []);

  const isFavorite = useCallback(
    (stopId: string) => favorites.some((s) => s.stop_id === stopId),
    [favorites]
  );

  const reorderFavorites = useCallback((from: number, to: number) => {
    const current = loadFavorites();
    const [item] = current.splice(from, 1);
    current.splice(to, 0, item);
    save(current);
  }, []);

  return { favorites, addFavorite, removeFavorite, isFavorite, reorderFavorites };
}
