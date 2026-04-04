import { useState, useEffect } from "react";
import { fetchServiceAlerts } from "@/lib/api";

export interface ServiceAlert {
  id: string;
  header: string;
  description: string;
  url: string;
  cause: string;
  effect: string;
  routeIds: string[];
  stopIds: string[];
  tripIds: string[];
  activePeriods: { start: number; end: number }[];
}

const REFRESH_MS = 60_000;

export function useServiceAlerts(isActive: boolean, language?: string) {
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    let timerId: number | null = null;

    const run = async () => {
      if (cancelled) return;
      try {
        const { data, error } = await fetchServiceAlerts(language);
        if (error) throw error;
        if (data?.alerts) setAlerts(data.alerts);
      } catch (err) {
        console.error("Service alerts fetch error:", err);
      }
      if (!cancelled) timerId = window.setTimeout(run, REFRESH_MS);
    };

    run();
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [isActive, language]);

  return { alerts };
}
