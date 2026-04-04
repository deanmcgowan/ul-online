import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchTripUpdates } from "@/lib/api";

export interface TripDelay {
  tripId: string;
  routeId: string;
  directionId: number;
  canceled: boolean;
  delay: number | null;
  stopUpdates: {
    stopId: string;
    stopSequence: number;
    arrivalDelay: number | null;
    departureDelay: number | null;
  }[];
}

const REFRESH_MS = 15_000;

export function useTripUpdates(isActive: boolean) {
  const [tripUpdates, setTripUpdates] = useState<TripDelay[]>([]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    let timerId: number | null = null;

    const run = async () => {
      if (cancelled) return;
      try {
        const { data, error } = await fetchTripUpdates();
        if (error) throw error;
        if (data?.tripUpdates) setTripUpdates(data.tripUpdates);
      } catch (err) {
        console.error("Trip updates fetch error:", err);
      }
      if (!cancelled) timerId = window.setTimeout(run, REFRESH_MS);
    };

    run();
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [isActive]);

  /** Map from tripId → TripDelay for O(1) lookup */
  const delayByTrip = useMemo(() => {
    const map = new Map<string, TripDelay>();
    for (const tu of tripUpdates) {
      map.set(tu.tripId, tu);
    }
    return map;
  }, [tripUpdates]);

  const getDelay = useCallback(
    (tripId: string) => delayByTrip.get(tripId) ?? null,
    [delayByTrip],
  );

  return { tripUpdates, delayByTrip, getDelay };
}
