import { useState, useEffect, useRef } from "react";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import { fetchStaticData } from "@/lib/api";
import type { TransitStop } from "@/components/BusMap";
import { loadStaticDataSnapshot, saveStaticDataSnapshot } from "@/lib/staticDataCache";

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

export function useStaticData(): StaticData {
  const { strings } = useAppPreferences();
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
      const cachedSnapshot = await loadStaticDataSnapshot();
      const cachedHash = cachedSnapshot?.hash || "";
      const hasCachedSnapshot = !!(
        cachedSnapshot?.stops?.length &&
        cachedSnapshot.routeMap &&
        cachedSnapshot.stopRoutes
      );

      // Build checklist
      const items: ChecklistItem[] = hasCachedSnapshot
        ? [
            { id: "cache", label: strings.loadingCachedData, status: "pending" as const },
            { id: "check", label: strings.checkingForUpdates, status: "pending" as const },
          ]
        : [
            { id: "fetch", label: strings.downloadingData, status: "pending" as const },
            { id: "process", label: strings.processingData, status: "pending" as const },
          ];

      setChecklist(items);
      await yieldToUI(); // Let checklist render

      // 1) Load from cache
      if (hasCachedSnapshot && cachedSnapshot) {
        updateItem("cache", "loading");
        await yieldToUI();

        setStops(cachedSnapshot.stops);
        await yieldToUI();

        setRouteMap(cachedSnapshot.routeMap);
        await yieldToUI();

        setStopRoutes(cachedSnapshot.stopRoutes);

        updateItem("cache", "done");
        setLoading(false);
        await yieldToUI();
      }

      // 2) Check server for updates
      try {
        if (hasCachedSnapshot) {
          updateItem("check", "loading");
        } else {
          updateItem("fetch", "loading");
        }
        await yieldToUI();

        const { data, error } = await fetchStaticData({ hash: cachedHash });

        if (error) throw error;
        if (cancelledRef.current) return;

        if (data.unchanged && hasCachedSnapshot) {
          updateItem("check", "done", strings.upToDate);
          setTimeout(() => { if (!cancelledRef.current) setChecklist([]); }, 1500);
          return;
        }

        // Server says unchanged but we have no usable cache — force full refetch
        if (data.unchanged && !hasCachedSnapshot) {
          const { data: freshData, error: freshError } = await fetchStaticData({ hash: "" });
          if (freshError) throw freshError;
          if (cancelledRef.current) return;
          Object.assign(data, freshData);
        }

        // New data arrived — process it
        if (!hasCachedSnapshot) {
          updateItem("fetch", "done");
          updateItem("process", "loading");
          await yieldToUI();
        }

        const nextStops = (data.stops || []) as TransitStop[];
        const nextRouteMap: Record<string, string> = {};
        for (const route of data.routes || []) {
          nextRouteMap[route.route_id] = route.route_short_name || route.route_id;
        }

        const nextStopRoutes: Record<string, string[]> = {};
        for (const stopRoute of data.stopRoutes || []) {
          if (!nextStopRoutes[stopRoute.stop_id]) nextStopRoutes[stopRoute.stop_id] = [];
          nextStopRoutes[stopRoute.stop_id].push(stopRoute.route_id);
        }

        if (data.stops) {
          setStops(nextStops);
          await yieldToUI();
        }

        if (data.routes) {
          setRouteMap(nextRouteMap);
          await yieldToUI();
        }

        if (data.stopRoutes) {
          setStopRoutes(nextStopRoutes);
          await yieldToUI();
        }

        // Only save snapshot if we got actual data
        if (nextStops.length > 0) {
          await saveStaticDataSnapshot({
            hash: data.hash || cachedHash,
            stops: nextStops,
            routeMap: nextRouteMap,
            stopRoutes: nextStopRoutes,
            updatedAt: Date.now(),
          });
        }

        if (hasCachedSnapshot) {
          updateItem("check", "done", strings.updatedToLatest);
        } else {
          updateItem("process", "done");
        }
      } catch (err) {
        console.error("Static data fetch error:", err);
        if (hasCachedSnapshot) {
          updateItem("check", "done", strings.updateCheckFailed);
        } else {
          setChecklist((prev) =>
            prev.map((item) =>
              item.status === "loading"
                ? { ...item, status: "done", label: `${item.label} (${strings.processingFailedSuffix})` }
                : item
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
  }, [strings]);

  return { stops, routeMap, stopRoutes, loading, checklist };
}
