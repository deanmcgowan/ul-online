import { useState, useEffect, useRef } from "react";
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

/** Yield to browser so UI can repaint between heavy operations */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Parse JSON off main thread via a short yield */
async function parseCached<T>(key: string): Promise<T | null> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    await yieldToUI();
    return JSON.parse(raw);
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
  const cancelledRef = useRef(false);

  const updateItem = (id: string, status: ChecklistItem["status"], label?: string) => {
    setChecklist((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status, ...(label ? { label } : {}) } : item
      )
    );
  };

  useEffect(() => {
    cancelledRef.current = false;

    async function load() {
      const cachedHash = localStorage.getItem(CACHE_KEY_HASH) || "";
      // Quick check if we have cached data keys at all (without parsing yet)
      const hasCachedKeys = !!(
        localStorage.getItem(CACHE_KEY_STOPS) &&
        localStorage.getItem(CACHE_KEY_ROUTES) &&
        localStorage.getItem(CACHE_KEY_STOP_ROUTES)
      );

      // Build checklist
      const items: ChecklistItem[] = hasCachedKeys
        ? [
            { id: "cache", label: "Loading cached data", status: "pending" as const },
            { id: "check", label: "Checking for updates", status: "pending" as const },
          ]
        : [
            { id: "fetch", label: "Downloading data (one-off)", status: "pending" as const },
            { id: "process", label: "Processing data", status: "pending" as const },
          ];

      setChecklist(items);
      await yieldToUI(); // Let checklist render

      // 1) Load from cache with yields between each parse
      if (hasCachedKeys) {
        updateItem("cache", "loading");
        await yieldToUI();

        const cachedStops = await parseCached<TransitStop[]>(CACHE_KEY_STOPS);
        if (cancelledRef.current) return;
        if (cachedStops) setStops(cachedStops);
        await yieldToUI();

        const cachedRoutes = await parseCached<Record<string, string>>(CACHE_KEY_ROUTES);
        if (cancelledRef.current) return;
        if (cachedRoutes) setRouteMap(cachedRoutes);
        await yieldToUI();

        const cachedStopRoutes = await parseCached<Record<string, string[]>>(CACHE_KEY_STOP_ROUTES);
        if (cancelledRef.current) return;
        if (cachedStopRoutes) setStopRoutes(cachedStopRoutes);

        updateItem("cache", "done");
        setLoading(false);
        await yieldToUI();
      }

      // 2) Check server for updates
      try {
        if (hasCachedKeys) {
          updateItem("check", "loading");
        } else {
          updateItem("fetch", "loading");
        }
        await yieldToUI();

        const { data, error } = await supabase.functions.invoke("static-data", {
          body: { hash: cachedHash },
        });

        if (error) throw error;
        if (cancelledRef.current) return;

        if (data.unchanged && hasCachedKeys) {
          updateItem("check", "done", "Already up to date");
          setTimeout(() => { if (!cancelledRef.current) setChecklist([]); }, 1500);
          return;
        }

        // New data arrived — process it
        if (!hasCachedKeys) {
          updateItem("fetch", "done");
          updateItem("process", "loading");
          await yieldToUI();
        }

        if (data.stops) {
          setStops(data.stops);
          await yieldToUI();
          localStorage.setItem(CACHE_KEY_STOPS, JSON.stringify(data.stops));
          await yieldToUI();
        }

        if (data.routes) {
          const map: Record<string, string> = {};
          for (const r of data.routes) {
            map[r.route_id] = r.route_short_name || r.route_id;
          }
          setRouteMap(map);
          await yieldToUI();
          localStorage.setItem(CACHE_KEY_ROUTES, JSON.stringify(map));
          await yieldToUI();
        }

        if (data.stopRoutes) {
          const map: Record<string, string[]> = {};
          for (const sr of data.stopRoutes) {
            if (!map[sr.stop_id]) map[sr.stop_id] = [];
            map[sr.stop_id].push(sr.route_id);
          }
          setStopRoutes(map);
          await yieldToUI();
          localStorage.setItem(CACHE_KEY_STOP_ROUTES, JSON.stringify(map));
          await yieldToUI();
        }

        if (data.hash) {
          localStorage.setItem(CACHE_KEY_HASH, data.hash);
        }

        if (hasCachedKeys) {
          updateItem("check", "done", "Updated to latest data");
        } else {
          updateItem("process", "done");
        }
      } catch (err) {
        console.error("Static data fetch error:", err);
        if (hasCachedKeys) {
          updateItem("check", "done", "Update check failed (using cached data)");
        } else {
          setChecklist((prev) =>
            prev.map((item) =>
              item.status === "loading" ? { ...item, status: "done", label: item.label + " (failed)" } : item
            )
          );
        }
      }

      if (!cancelledRef.current) {
        setLoading(false);
        setTimeout(() => { if (!cancelledRef.current) setChecklist([]); }, 2000);
      }
    }

    load();
    return () => { cancelledRef.current = true; };
  }, []);

  return { stops, routeMap, stopRoutes, loading, checklist };
}
