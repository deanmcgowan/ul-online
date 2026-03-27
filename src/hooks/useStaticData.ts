import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TransitStop } from "@/components/BusMap";

const CACHE_KEY_STOPS = "cache_stops";
const CACHE_KEY_ROUTES = "cache_routes";
const CACHE_KEY_STOP_ROUTES = "cache_stopRoutes";
const CACHE_KEY_HASH = "cache_hash";

export interface ChecklistItem {
  id: string;
  label: string;
  status: "pending" | "loading" | "done" | "skipped";
}

interface StaticData {
  stops: TransitStop[];
  routeMap: Record<string, string>;
  stopRoutes: Record<string, string[]>;
  loading: boolean;
  checklist: ChecklistItem[];
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
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  const updateItem = (id: string, status: ChecklistItem["status"]) => {
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status } : item))
    );
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const cachedStops = loadCached<TransitStop[]>(CACHE_KEY_STOPS);
      const cachedRoutes = loadCached<Record<string, string>>(CACHE_KEY_ROUTES);
      const cachedStopRoutes = loadCached<Record<string, string[]>>(CACHE_KEY_STOP_ROUTES);
      const cachedHash = localStorage.getItem(CACHE_KEY_HASH) || "";
      const hasCachedData = !!(cachedStops && cachedRoutes && cachedStopRoutes);

      // Build checklist based on whether we have cached data
      const items: ChecklistItem[] = hasCachedData
        ? [
            { id: "cache", label: "Loading cached data", status: "pending" as const },
            { id: "check", label: "Checking for updates", status: "pending" as const },
          ]
        : [
            { id: "stops", label: "Downloading stops (one-off)", status: "pending" as const },
            { id: "routes", label: "Downloading routes (one-off)", status: "pending" as const },
            { id: "stopRoutes", label: "Downloading stop-route links (one-off)", status: "pending" as const },
            { id: "process", label: "Processing data", status: "pending" as const },
          ];

      setChecklist(items);

      // 1) Load from cache immediately
      if (hasCachedData) {
        updateItem("cache", "loading");
        setStops(cachedStops!);
        setRouteMap(cachedRoutes!);
        setStopRoutes(cachedStopRoutes!);
        updateItem("cache", "done");
        setLoading(false);
      }

      // 2) Check server for updates
      try {
        if (hasCachedData) {
          updateItem("check", "loading");
        }

        const { data, error } = await supabase.functions.invoke("static-data", {
          body: { hash: cachedHash },
        });

        if (error) throw error;
        if (cancelled) return;

        if (data.unchanged && hasCachedData) {
          updateItem("check", "done");
          setChecklist((prev) =>
            prev.map((item) =>
              item.id === "check" ? { ...item, label: "Already up to date", status: "done" } : item
            )
          );
          setTimeout(() => { if (!cancelled) setChecklist([]); }, 1500);
          return;
        }

        // New data arrived — process it
        if (!hasCachedData) {
          updateItem("stops", "loading");
        }

        if (data.stops) {
          localStorage.setItem(CACHE_KEY_STOPS, JSON.stringify(data.stops));
          setStops(data.stops);
          if (!hasCachedData) updateItem("stops", "done");
        }

        if (!hasCachedData) updateItem("routes", "loading");
        if (data.routes) {
          const map: Record<string, string> = {};
          data.routes.forEach((r: any) => {
            map[r.route_id] = r.route_short_name || r.route_id;
          });
          localStorage.setItem(CACHE_KEY_ROUTES, JSON.stringify(map));
          setRouteMap(map);
          if (!hasCachedData) updateItem("routes", "done");
        }

        if (!hasCachedData) updateItem("stopRoutes", "loading");
        if (data.stopRoutes) {
          const map: Record<string, string[]> = {};
          data.stopRoutes.forEach((sr: any) => {
            if (!map[sr.stop_id]) map[sr.stop_id] = [];
            map[sr.stop_id].push(sr.route_id);
          });
          localStorage.setItem(CACHE_KEY_STOP_ROUTES, JSON.stringify(map));
          setStopRoutes(map);
          if (!hasCachedData) updateItem("stopRoutes", "done");
        }

        if (!hasCachedData) updateItem("process", "done");

        if (data.hash) {
          localStorage.setItem(CACHE_KEY_HASH, data.hash);
        }

        if (hasCachedData) {
          setChecklist((prev) =>
            prev.map((item) =>
              item.id === "check" ? { ...item, label: "Updated to latest data", status: "done" } : item
            )
          );
        }
      } catch (err) {
        console.error("Static data fetch error:", err);
        if (!hasCachedData) {
          setChecklist((prev) =>
            prev.map((item) =>
              item.status === "loading" ? { ...item, status: "done", label: item.label + " (failed)" } : item
            )
          );
        }
      }

      if (!cancelled) {
        setLoading(false);
        setTimeout(() => { if (!cancelled) setChecklist([]); }, 2000);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { stops, routeMap, stopRoutes, loading, checklist };
}
