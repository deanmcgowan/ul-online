import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TransitStop } from "@/components/BusMap";

const CACHE_KEY_STOPS = "cache_stops";
const CACHE_KEY_ROUTES = "cache_routes";
const CACHE_KEY_STOP_ROUTES = "cache_stopRoutes";
const CACHE_KEY_HASH = "cache_hash";

interface StaticData {
  stops: TransitStop[];
  routeMap: Record<string, string>;
  stopRoutes: Record<string, string[]>;
  loading: boolean;
  progress: string;
}

function loadCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useStaticData(): StaticData {
  const [stops, setStops] = useState<TransitStop[]>([]);
  const [routeMap, setRouteMap] = useState<Record<string, string>>({});
  const [stopRoutes, setStopRoutes] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState("Initializing…");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // 1) Load from cache immediately
      const cachedStops = loadCached<TransitStop[]>(CACHE_KEY_STOPS);
      const cachedRoutes = loadCached<Record<string, string>>(CACHE_KEY_ROUTES);
      const cachedStopRoutes = loadCached<Record<string, string[]>>(CACHE_KEY_STOP_ROUTES);
      const cachedHash = localStorage.getItem(CACHE_KEY_HASH) || "";

      if (cachedStops && cachedRoutes && cachedStopRoutes) {
        setProgress("Loading cached data…");
        setStops(cachedStops);
        setRouteMap(cachedRoutes);
        setStopRoutes(cachedStopRoutes);
        setLoading(false);
      }

      // 2) Check server for updates
      try {
        setProgress(cachedHash ? "Checking for updates…" : "Downloading stop data…");
        
        const { data, error } = await supabase.functions.invoke("static-data", {
          body: { hash: cachedHash },
        });

        if (error) throw error;
        if (cancelled) return;

        if (data.unchanged && cachedStops) {
          // Data unchanged, we're good
          setProgress("");
          setLoading(false);
          return;
        }

        // 3) Process and cache new data
        if (data.stops) {
          setProgress("Processing stops…");
          localStorage.setItem(CACHE_KEY_STOPS, JSON.stringify(data.stops));
          setStops(data.stops);
        }

        if (data.routes) {
          setProgress("Processing routes…");
          const map: Record<string, string> = {};
          data.routes.forEach((r: any) => {
            map[r.route_id] = r.route_short_name || r.route_id;
          });
          localStorage.setItem(CACHE_KEY_ROUTES, JSON.stringify(map));
          setRouteMap(map);
        }

        if (data.stopRoutes) {
          setProgress("Processing stop routes…");
          const map: Record<string, string[]> = {};
          data.stopRoutes.forEach((sr: any) => {
            if (!map[sr.stop_id]) map[sr.stop_id] = [];
            map[sr.stop_id].push(sr.route_id);
          });
          localStorage.setItem(CACHE_KEY_STOP_ROUTES, JSON.stringify(map));
          setStopRoutes(map);
        }

        if (data.hash) {
          localStorage.setItem(CACHE_KEY_HASH, data.hash);
        }
      } catch (err) {
        console.error("Static data fetch error:", err);
        // If we have cached data, that's fine - use it
      }

      if (!cancelled) {
        setProgress("");
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { stops, routeMap, stopRoutes, loading, progress };
}
