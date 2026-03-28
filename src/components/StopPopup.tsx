import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import { Button } from "@/components/ui/button";
import type { TransitStop, Vehicle } from "@/components/BusMap";
import { bearingTowardStop } from "@/lib/busIcon";
import { haversineDistanceMeters, isSameStopGroup, pickBestUpcomingStopMatch, type StopTimeMatch } from "@/lib/transitMatching";

export { pickBestUpcomingStopMatch } from "@/lib/transitMatching";

interface StopPopupProps {
  stop: TransitStop;
  stops: TransitStop[];
  vehicles: Vehicle[];
  routeMap: Record<string, string>;
  stopRoutes: Record<string, string[]>;
  onFilter: (stop: TransitStop) => void;
  onToggleFavorite?: (stop: TransitStop) => void;
  isFavorite?: (stopId: string) => boolean;
}

interface ArrivalCandidate {
  vehicle: Vehicle;
  stopId: string;
  stopLat: number;
  stopLon: number;
  stopSequence: number;
  lineNumber: string;
  isExactStop: boolean;
  isTowardStop: boolean;
}

interface ArrivalResult {
  etaSeconds: number;
  lineNumber: string;
  tripId: string;
  vehicleId: string;
  stopSequence: number;
  rankingScore: number;
}

interface ArrivalSnapshot extends ArrivalResult {
  calculatedAt: number;
}

const SAME_TRIP_CONTINUITY_BONUS_SECONDS = 75;
const MAX_SAME_TRIP_INCREASE_SECONDS = 45;

function formatEta(seconds: number, arrivingNow: string): string {
  const adjustedSeconds = Math.max(0, seconds - 60);

  if (adjustedSeconds < 60) {
    return arrivingNow;
  }

  return `${Math.max(1, Math.floor(adjustedSeconds / 60))} min`;
}

function getApproximateEtaSeconds(candidate: ArrivalCandidate, selectedStop: TransitStop): number {
  const routeDistance = haversineDistanceMeters(
    candidate.vehicle.lat,
    candidate.vehicle.lon,
    candidate.stopLat,
    candidate.stopLon,
  );
  const assumedSpeed = Math.max(candidate.vehicle.speed || 0, 4);
  const driveSeconds = routeDistance / assumedSpeed;
  const intermediateStops = Math.max(0, candidate.stopSequence - candidate.vehicle.currentStopSequence - 1);
  const dwellPenaltySeconds = intermediateStops * 20;
  const headingPenaltySeconds = candidate.isTowardStop ? 0 : 90;
  const siblingPenaltySeconds = candidate.isExactStop
    ? 0
    : Math.min(
        90,
        Math.round(
          haversineDistanceMeters(
            candidate.stopLat,
            candidate.stopLon,
            selectedStop.stop_lat,
            selectedStop.stop_lon,
          ) / 2,
        ),
      );

  return Math.round(driveSeconds + dwellPenaltySeconds + headingPenaltySeconds + siblingPenaltySeconds);
}

async function getRoadDurationSeconds(vehicle: Vehicle, stopLon: number, stopLat: number, signal?: AbortSignal) {
  const url = new URL(
    `https://router.project-osrm.org/route/v1/driving/${vehicle.lon},${vehicle.lat};${stopLon},${stopLat}`,
  );
  url.searchParams.set("overview", "false");
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("steps", "false");

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Routing service returned ${response.status}`);
  }

  const data = (await response.json()) as { routes?: Array<{ duration?: number }> };
  return data.routes?.[0]?.duration ?? null;
}

export function stabilizeArrivalEstimate(nextArrival: ArrivalResult, previousArrival: ArrivalSnapshot | null): ArrivalSnapshot {
  const calculatedAt = Date.now();

  if (!previousArrival) {
    return {
      ...nextArrival,
      calculatedAt,
    };
  }

  const isSameVehicle =
    previousArrival.tripId === nextArrival.tripId ||
    (previousArrival.vehicleId !== "" && previousArrival.vehicleId === nextArrival.vehicleId);

  if (!isSameVehicle) {
    return {
      ...nextArrival,
      calculatedAt,
    };
  }

  const elapsedSeconds = Math.max(0, Math.round((calculatedAt - previousArrival.calculatedAt) / 1000));
  const previousRemaining = Math.max(0, previousArrival.etaSeconds - elapsedSeconds);
  const stabilizedEtaSeconds = Math.min(
    nextArrival.etaSeconds,
    previousRemaining + MAX_SAME_TRIP_INCREASE_SECONDS,
  );

  return {
    ...nextArrival,
    etaSeconds: Math.max(0, stabilizedEtaSeconds),
    calculatedAt,
  };
}

export default function StopPopup({
  stop,
  stops,
  vehicles,
  routeMap,
  stopRoutes,
  onFilter,
  onToggleFavorite,
  isFavorite,
}: StopPopupProps) {
  const { strings } = useAppPreferences();
  const [arrival, setArrival] = useState<ArrivalSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const previousArrivalRef = useRef<ArrivalSnapshot | null>(null);

  const relatedStops = useMemo(
    () =>
      stops.filter((candidate) => isSameStopGroup(stop, candidate)),
    [stop, stops],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadArrivalEstimate() {
      const relatedStopIds = relatedStops.map((candidate) => candidate.stop_id);
      const routeIds = new Set<string>();
      for (const relatedStopId of relatedStopIds) {
        stopRoutes[relatedStopId]?.forEach((routeId) => routeIds.add(routeId));
      }

      const candidateVehicles = vehicles.filter((vehicle) => {
        if (!vehicle.tripId || !routeIds.has(vehicle.routeId)) {
          return false;
        }

        return true;
      });

      if (candidateVehicles.length === 0) {
        previousArrivalRef.current = null;
        setArrival(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const { data, error } = await supabase
          .from("stop_times")
          .select("trip_id, stop_id, stop_sequence")
          .in("trip_id", candidateVehicles.map((vehicle) => vehicle.tripId))
          .in("stop_id", relatedStopIds);

        if (error) {
          throw error;
        }

        const relatedStopMap = new Map(relatedStops.map((candidate) => [candidate.stop_id, candidate]));
        const targetByTrip = new Map<string, ArrivalCandidate>();

        for (const vehicle of candidateVehicles) {
          const firstUpcomingStop = pickBestUpcomingStopMatch(
            (data ?? []) as StopTimeMatch[],
            vehicle,
            stop,
            relatedStopMap,
          );
          const stopDetails = firstUpcomingStop ? relatedStopMap.get(firstUpcomingStop.stop_id) : null;

          if (!firstUpcomingStop || !stopDetails) {
            continue;
          }

          const isTowardStop = bearingTowardStop(
            vehicle.lat,
            vehicle.lon,
            vehicle.bearing,
            stopDetails.stop_lat,
            stopDetails.stop_lon,
          );

          targetByTrip.set(vehicle.tripId, {
            vehicle,
            stopId: firstUpcomingStop.stop_id,
            stopLat: stopDetails.stop_lat,
            stopLon: stopDetails.stop_lon,
            stopSequence: firstUpcomingStop.stop_sequence,
            lineNumber: routeMap[vehicle.routeId] || vehicle.vehicleLabel || "?",
            isExactStop: firstUpcomingStop.stop_id === stop.stop_id,
            isTowardStop,
          });
        }

        const bestCandidates = Array.from(targetByTrip.values())
          .sort((left, right) => getApproximateEtaSeconds(left, stop) - getApproximateEtaSeconds(right, stop))
          .slice(0, 6);

        if (bestCandidates.length === 0) {
          setArrival(null);
          return;
        }

        const estimates = await Promise.all(
          bestCandidates.map(async (candidate) => {
            try {
              const driveSeconds = await getRoadDurationSeconds(
                candidate.vehicle,
                candidate.stopLon,
                candidate.stopLat,
                controller.signal,
              );

              if (driveSeconds === null) {
                return null;
              }

              const intermediateStops = Math.max(0, candidate.stopSequence - candidate.vehicle.currentStopSequence - 1);
              const dwellPenaltySeconds = intermediateStops * 20;
              const headingPenaltySeconds = candidate.isTowardStop ? 0 : 90;
              const siblingPenaltySeconds = candidate.isExactStop
                ? 0
                : Math.min(
                    90,
                    Math.round(
                      haversineDistanceMeters(
                        candidate.stopLat,
                        candidate.stopLon,
                        stop.stop_lat,
                        stop.stop_lon,
                      ) / 2,
                    ),
                  );

              return {
                etaSeconds: Math.round(driveSeconds + dwellPenaltySeconds + headingPenaltySeconds + siblingPenaltySeconds),
                lineNumber: candidate.lineNumber,
                tripId: candidate.vehicle.tripId,
                vehicleId: candidate.vehicle.vehicleId,
                stopSequence: candidate.stopSequence,
                rankingScore:
                  Math.round(driveSeconds + dwellPenaltySeconds + headingPenaltySeconds + siblingPenaltySeconds) -
                  (previousArrivalRef.current?.tripId === candidate.vehicle.tripId ? SAME_TRIP_CONTINUITY_BONUS_SECONDS : 0),
              } satisfies ArrivalResult;
            } catch {
              return null;
            }
          }),
        );

        const bestEstimate = estimates
          .filter((estimate): estimate is ArrivalResult => estimate !== null)
          .sort((left, right) => {
            if (left.rankingScore !== right.rankingScore) {
              return left.rankingScore - right.rankingScore;
            }

            return left.etaSeconds - right.etaSeconds;
          })[0] ?? null;

        if (!bestEstimate) {
          previousArrivalRef.current = null;
          setArrival(null);
          return;
        }

        const stabilizedEstimate = stabilizeArrivalEstimate(bestEstimate, previousArrivalRef.current);
        previousArrivalRef.current = stabilizedEstimate;
        setArrival(stabilizedEstimate);
      } catch (error) {
        console.warn("Stop arrival estimate failed", error);
        previousArrivalRef.current = null;
        setArrival(null);
      } finally {
        setLoading(false);
      }
    }

    loadArrivalEstimate();

    return () => controller.abort();
  }, [relatedStops, routeMap, stop, stopRoutes, vehicles]);

  return (
    <div>
      <h3 className="font-semibold text-sm">{stop.stop_name}</h3>

      <div className="mt-2 rounded-md border bg-muted/30 px-3 py-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {strings.nextLiveArrival}
        </p>
        {loading ? (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{strings.nextLiveArrivalLoading}</span>
          </div>
        ) : arrival ? (
          <p className="mt-1 text-sm">
            <span className="font-semibold">{strings.line} {arrival.lineNumber}</span>{" "}
            <span className="text-muted-foreground">{strings.inMinutes(formatEta(arrival.etaSeconds, strings.arrivingNow))}</span>
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">{strings.nextLiveArrivalUnavailable}</p>
        )}
      </div>

      <div className="flex gap-2 mt-2">
        <Button size="sm" className="flex-1" onClick={() => onFilter(stop)}>
          {strings.filterBuses}
        </Button>
        {onToggleFavorite && (
          <Button
            size="sm"
            variant={isFavorite?.(stop.stop_id) ? "default" : "outline"}
            onClick={() => onToggleFavorite(stop)}
          >
            <Star className={`h-4 w-4 ${isFavorite?.(stop.stop_id) ? "fill-current" : ""}`} />
          </Button>
        )}
      </div>
    </div>
  );
}