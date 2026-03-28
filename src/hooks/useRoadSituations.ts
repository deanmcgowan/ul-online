import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const ROAD_SITUATION_REFRESH_MS = 120000;

export interface RoadSituation {
  id: string;
  messageType: string;
  header: string;
  locationDescriptor: string;
  roadName: string;
  roadNumber: string;
  startTime: string;
  endTime: string;
  validUntilFurtherNotice: boolean;
  webLink: string;
  lon: number;
  lat: number;
  distanceMeters: number;
}

interface RoadSituationQuery {
  lat: number;
  lon: number;
  radiusMeters: number;
  limit: number;
}

export function useRoadSituations(query: RoadSituationQuery | null, enabled: boolean) {
  const [situations, setSituations] = useState<RoadSituation[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !query) {
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const fetchSituations = async () => {
      if (cancelled) {
        return;
      }

      setLoading(true);

      try {
        const { data, error } = await supabase.functions.invoke("trafikverket-situations", {
          body: query,
        });

        if (error) {
          throw error;
        }

        if (!cancelled) {
          setSituations((data?.situations ?? []) as RoadSituation[]);
        }
      } catch (error) {
        console.warn("Road situation fetch failed", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
          timerId = window.setTimeout(fetchSituations, ROAD_SITUATION_REFRESH_MS);
        }
      }
    };

    fetchSituations();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [enabled, query]);

  return { situations, loading };
}