import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import { Button } from "@/components/ui/button";
import type { TransitStop, Vehicle } from "@/components/BusMap";
import { bearingTowardStop } from "@/lib/busIcon";
import { buildPlatformGroups, type TransitPlatformGroup, type TransitStopGroup } from "@/lib/stopGroups";
import { haversineDistanceMeters, pickBestUpcomingStopMatch, type StopTimeMatch } from "@/lib/transitMatching";
import { buildTripScheduleMap, estimateRemainingTripSeconds, getTripTerminalStopId, parseGtfsTimeToSeconds, type ScheduledStopTimeRow } from "@/lib/tripSchedules";

export { pickBestUpcomingStopMatch } from "@/lib/transitMatching";

interface StopPopupProps {
  stopGroup: TransitStopGroup;
  stops: TransitStop[];
  vehicles: Vehicle[];
  routeMap: Record<string, string>;
  stopRoutes: Record<string, string[]>;
  onFilter: (stopGroup: TransitStopGroup) => void;
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
  scheduledTravelSeconds: number | null;
  destinationName: string | null;
  scheduledTimeText: string | null;
}

interface ArrivalResult {
  etaSeconds: number;
  lineNumber: string;
  tripId: string;
  vehicleId: string;
  stopSequence: number;
  rankingScore: number;
  destinationName?: string | null;
  scheduledTimeText?: string | null;
}

interface ArrivalSnapshot extends ArrivalResult {
  calculatedAt: number;
}

const SAME_TRIP_CONTINUITY_BONUS_SECONDS = 75;
const MAX_SAME_TRIP_INCREASE_SECONDS = 45;
const FALLBACK_MAX_DISTANCE_METERS = 5000;
const FALLBACK_ALLOW_NON_APPROACHING_ETA_SECONDS = 300;
const LIVE_PROXIMITY_OVERRIDE_DISTANCE_METERS = 300;
const LIVE_PROXIMITY_OVERRIDE_SEQUENCE_GRACE = 2;

function formatEta(seconds: number, arrivingNow: string): string {
  const adjustedSeconds = Math.max(0, seconds - 60);

  if (adjustedSeconds < 60) {
    return arrivingNow;
  }

  return `${Math.max(1, Math.floor(adjustedSeconds / 60))} min`;
}

function formatArrivalStatus(seconds: number, strings: ReturnType<typeof useAppPreferences>["strings"]) {
  const etaText = formatEta(seconds, strings.arrivingNow);
  return etaText === strings.arrivingNow ? etaText : strings.inMinutes(etaText);
}

function formatScheduledClockTime(value: string | null | undefined): string | null {
  const totalSeconds = parseGtfsTimeToSeconds(value);
  if (totalSeconds === null) {
    return null;
  }

  const normalizedSeconds = ((totalSeconds % 86400) + 86400) % 86400;
  const hours = Math.floor(normalizedSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((normalizedSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");

  return `${hours}:${minutes}`;
}

function getScheduledTimeText(row: ScheduledStopTimeRow | null | undefined) {
  if (!row) {
    return null;
  }

  return formatScheduledClockTime(row.arrival_time) ?? formatScheduledClockTime(row.departure_time);
}

export function getRemainingArrivalSeconds(arrival: ArrivalSnapshot | null, nowMs: number): number | null {
  if (!arrival) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.round((nowMs - arrival.calculatedAt) / 1000));
  return Math.max(0, arrival.etaSeconds - elapsedSeconds);
}

function getSiblingPenaltySeconds(candidate: ArrivalCandidate, selectedStop: TransitStop) {
  return candidate.isExactStop
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
}

function getLiveApproachEtaSeconds(candidate: ArrivalCandidate, selectedStop: TransitStop) {
  const routeDistance = haversineDistanceMeters(
    candidate.vehicle.lat,
    candidate.vehicle.lon,
    candidate.stopLat,
    candidate.stopLon,
  );
  const assumedSpeed = Math.max(candidate.vehicle.speed || 0, 4);
  const driveSeconds = routeDistance / assumedSpeed;
  const headingPenaltySeconds = candidate.isTowardStop ? 0 : 90;

  return Math.round(driveSeconds + headingPenaltySeconds + getSiblingPenaltySeconds(candidate, selectedStop));
}

function getApproximateEtaSeconds(candidate: ArrivalCandidate, selectedStop: TransitStop): number {
  const siblingPenaltySeconds = getSiblingPenaltySeconds(candidate, selectedStop);
  const liveApproachEtaSeconds = getLiveApproachEtaSeconds(candidate, selectedStop);

  if (candidate.scheduledTravelSeconds !== null) {
    const routeDistance = haversineDistanceMeters(
      candidate.vehicle.lat,
      candidate.vehicle.lon,
      candidate.stopLat,
      candidate.stopLon,
    );
    const sequenceDelta = Math.max(0, candidate.stopSequence - candidate.vehicle.currentStopSequence);
    const scheduledEtaSeconds = Math.round(candidate.scheduledTravelSeconds + siblingPenaltySeconds);

    if (
      routeDistance <= LIVE_PROXIMITY_OVERRIDE_DISTANCE_METERS &&
      sequenceDelta <= LIVE_PROXIMITY_OVERRIDE_SEQUENCE_GRACE
    ) {
      return Math.min(scheduledEtaSeconds, liveApproachEtaSeconds);
    }

    return scheduledEtaSeconds;
  }

  const intermediateStops = Math.max(0, candidate.stopSequence - candidate.vehicle.currentStopSequence - 1);
  const dwellPenaltySeconds = intermediateStops * 20;

  return Math.round(liveApproachEtaSeconds + dwellPenaltySeconds);
}

function getClosestPlatformStop(platform: TransitPlatformGroup, vehicle: Vehicle) {
  return platform.stops
    .map((stop) => ({
      stop,
      distanceMeters: haversineDistanceMeters(vehicle.lat, vehicle.lon, stop.stop_lat, stop.stop_lon),
    }))
    .sort((left, right) => left.distanceMeters - right.distanceMeters)[0] ?? null;
}

export function buildFallbackArrivalEstimate(
  platform: TransitPlatformGroup,
  vehicles: Vehicle[],
  routeMap: Record<string, string>,
  tripScheduleMap?: ReadonlyMap<string, ScheduledStopTimeRow[]>,
  stopNameById?: ReadonlyMap<string, string>,
): ArrivalResult | null {
  const platformRouteIds = new Set(platform.routeIds);
  if (platformRouteIds.size === 0) {
    return null;
  }

  const candidates = vehicles
    .filter((vehicle) => vehicle.tripId && platformRouteIds.has(vehicle.routeId))
    .map((vehicle) => {
      const closestPlatformStop = getClosestPlatformStop(platform, vehicle);
      if (!closestPlatformStop || closestPlatformStop.distanceMeters > FALLBACK_MAX_DISTANCE_METERS) {
        return null;
      }

      const isTowardStop = bearingTowardStop(
        vehicle.lat,
        vehicle.lon,
        vehicle.bearing,
        closestPlatformStop.stop.stop_lat,
        closestPlatformStop.stop.stop_lon,
      );

      const assumedSpeed = Math.max(vehicle.speed || 0, 4);
      const directEtaSeconds = Math.round(closestPlatformStop.distanceMeters / assumedSpeed);

      if (!isTowardStop && directEtaSeconds > FALLBACK_ALLOW_NON_APPROACHING_ETA_SECONDS) {
        return null;
      }

      const etaSeconds = Math.round(
        directEtaSeconds + (isTowardStop ? 0 : 120),
      );

      const tripRows = tripScheduleMap?.get(vehicle.tripId) ?? [];
      const terminalStopId = tripRows.length > 0 ? getTripTerminalStopId(tripRows) : null;
      const scheduledStopRow = tripRows
        .filter((row) => platform.stops.some((stop) => stop.stop_id === row.stop_id) && row.stop_sequence >= vehicle.currentStopSequence)
        .sort((left, right) => left.stop_sequence - right.stop_sequence)[0];

      return {
        etaSeconds,
        lineNumber: routeMap[vehicle.routeId] || vehicle.vehicleLabel || "?",
        tripId: vehicle.tripId,
        vehicleId: vehicle.vehicleId,
        stopSequence: vehicle.currentStopSequence + 1,
        rankingScore: etaSeconds,
        destinationName: terminalStopId && stopNameById ? stopNameById.get(terminalStopId) ?? null : null,
        scheduledTimeText: getScheduledTimeText(scheduledStopRow),
      } satisfies ArrivalResult;
    })
    .filter((candidate): candidate is ArrivalResult => candidate !== null)
    .sort((left, right) => left.rankingScore - right.rankingScore);

  return candidates[0] ?? null;
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

export function pickPreferredDestinationName(
  arrivals: Array<Pick<ArrivalResult, "destinationName" | "rankingScore" | "etaSeconds">>,
  platformStopName: string,
) {
  const rankedDestinations = arrivals
    .filter(
      (arrival): arrival is Pick<ArrivalResult, "destinationName" | "rankingScore" | "etaSeconds"> & { destinationName: string } =>
        Boolean(arrival.destinationName) && arrival.destinationName !== platformStopName,
    )
    .sort((left, right) => {
      if (left.rankingScore !== right.rankingScore) {
        return left.rankingScore - right.rankingScore;
      }

      return left.etaSeconds - right.etaSeconds;
    });

  return rankedDestinations[0]?.destinationName ?? null;
}

function getStopCardTitle(
  platform: TransitPlatformGroup,
  strings: ReturnType<typeof useAppPreferences>["strings"],
  destinationName: string | null,
) {
  if (destinationName && destinationName !== platform.stop_name) {
    return `${platform.stop_name} ${strings.headingTo(destinationName)}`;
  }

  return platform.stop_name;
}

function StopDirectionCard({
  platform,
  stops,
  vehicles,
  routeMap,
  stopRoutes,
  onToggleFavorite,
  isFavorite,
}: {
  platform: TransitPlatformGroup;
  stops: TransitStop[];
  vehicles: Vehicle[];
  routeMap: Record<string, string>;
  stopRoutes: Record<string, string[]>;
  onToggleFavorite?: (stop: TransitStop) => void;
  isFavorite?: (stopId: string) => boolean;
}) {
  const { strings } = useAppPreferences();
  const [arrivals, setArrivals] = useState<ArrivalSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const previousArrivalsRef = useRef<Map<string, ArrivalSnapshot>>(new Map());
  const stopNameById = useMemo(() => new Map(stops.map((stop) => [stop.stop_id, stop.stop_name])), [stops]);

  const routeLabels = useMemo(
    () => Array.from(new Set(platform.routeIds.map((routeId) => routeMap[routeId] || routeId))),
    [platform.routeIds, routeMap],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadArrivals() {
      const candidateVehicles = vehicles.filter((vehicle) => vehicle.tripId);

      if (candidateVehicles.length === 0) {
        setArrivals([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const { data, error } = await supabase
          .from("stop_times")
          .select("trip_id, stop_id, stop_sequence, arrival_time, departure_time")
          .in("trip_id", candidateVehicles.map((vehicle) => vehicle.tripId));

        if (error) {
          throw error;
        }

        const tripScheduleMap = buildTripScheduleMap((data ?? []) as ScheduledStopTimeRow[]);
        const relatedStopMap = new Map(platform.stops.map((candidate) => [candidate.stop_id, candidate]));
        const targetByTrip = new Map<string, ArrivalCandidate>();

        for (const vehicle of candidateVehicles) {
          const tripRows = tripScheduleMap.get(vehicle.tripId) ?? [];
          const firstUpcomingStop = pickBestUpcomingStopMatch(
            tripRows.filter((row) => relatedStopMap.has(row.stop_id)) as StopTimeMatch[],
            vehicle,
            platform.representativeStop,
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

          const terminalStopId = getTripTerminalStopId(tripRows);
          const matchedScheduleRow = tripRows.find((row) => row.stop_id === firstUpcomingStop.stop_id && row.stop_sequence === firstUpcomingStop.stop_sequence);

          targetByTrip.set(vehicle.tripId, {
            vehicle,
            stopId: firstUpcomingStop.stop_id,
            stopLat: stopDetails.stop_lat,
            stopLon: stopDetails.stop_lon,
            stopSequence: firstUpcomingStop.stop_sequence,
            lineNumber: routeMap[vehicle.routeId] || vehicle.vehicleLabel || "?",
            isExactStop: platform.stops.some((stop) => stop.stop_id === firstUpcomingStop.stop_id),
            isTowardStop,
            scheduledTravelSeconds: estimateRemainingTripSeconds(vehicle, tripRows, firstUpcomingStop.stop_sequence),
            destinationName: terminalStopId ? stopNameById.get(terminalStopId) ?? null : null,
            scheduledTimeText: getScheduledTimeText(matchedScheduleRow),
          });
        }

        const bestCandidates = Array.from(targetByTrip.values())
          .sort((left, right) => getApproximateEtaSeconds(left, platform.representativeStop) - getApproximateEtaSeconds(right, platform.representativeStop))
          .slice(0, 3);

        const estimates = await Promise.all(
          bestCandidates.map(async (candidate) => {
            const etaSeconds = getApproximateEtaSeconds(candidate, platform.representativeStop);
            const key = `${candidate.vehicle.tripId}-${candidate.vehicle.vehicleId}`;
            const previousArrival = previousArrivalsRef.current.get(key);

            return {
              etaSeconds,
              lineNumber: candidate.lineNumber,
              tripId: candidate.vehicle.tripId,
              vehicleId: candidate.vehicle.vehicleId,
              stopSequence: candidate.stopSequence,
              rankingScore: etaSeconds,
              destinationName: candidate.destinationName,
              scheduledTimeText: candidate.scheduledTimeText,
              calculatedAt: Date.now(),
            } satisfies ArrivalSnapshot;
          }),
        );

        const stabilizedEstimates = estimates.map((estimate) => {
          const key = `${estimate.tripId}-${estimate.vehicleId}`;
          const previous = previousArrivalsRef.current.get(key);
          const stabilized = stabilizeArrivalEstimate(estimate, previous);
          previousArrivalsRef.current.set(key, stabilized);
          return stabilized;
        });

        setArrivals(stabilizedEstimates);
      } catch (error) {
        console.warn("Stop arrivals load failed", error);
        setArrivals([]);
      } finally {
        setLoading(false);
      }
    }

    loadArrivals();

    return () => controller.abort();
  }, [platform, routeMap, vehicles]);

  useEffect(() => {
    if (arrivals.length === 0) {
      return;
    }

    setNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [arrivals]);

  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{platform.stop_name}</p>
          {routeLabels.length > 0 ? (
            <p className="text-[11px] text-muted-foreground">{routeLabels.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base", numeric: true })).join(" • ")}</p>
          ) : null}
        </div>
        {onToggleFavorite && (
          <Button
            size="icon"
            variant={isFavorite?.(platform.representativeStop.stop_id) ? "default" : "outline"}
            className="h-8 w-8 shrink-0"
            onClick={() => onToggleFavorite(platform.representativeStop)}
          >
            <Star className={`h-4 w-4 ${isFavorite?.(platform.representativeStop.stop_id) ? "fill-current" : ""}`} />
          </Button>
        )}
      </div>

      <div className="mt-2 rounded-md border bg-background/70 px-3 py-2 space-y-2">
        {loading && arrivals.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{strings.nextLiveArrivalLoading}</span>
          </div>
        ) : arrivals.length > 0 ? (
          arrivals.map((arrival) => {
            const remainingSeconds = getRemainingArrivalSeconds(arrival, nowMs);
            return (
              <div key={`${arrival.tripId}-${arrival.vehicleId}`} className="flex items-start justify-between gap-2 py-1">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-semibold">{strings.line} {arrival.lineNumber}</span>
                  </p>
                  {arrival.destinationName ? (
                    <p className="text-xs text-muted-foreground truncate">{strings.headingTo(arrival.destinationName)}</p>
                  ) : null}
                </div>
                <div className="text-right shrink-0">
                  {remainingSeconds !== null ? (
                    <p className="text-sm font-semibold text-foreground whitespace-nowrap">
                      {formatEta(remainingSeconds, strings.arrivingNow)}
                    </p>
                  ) : null}
                  {arrival.scheduledTimeText ? (
                    <p className="text-xs text-muted-foreground whitespace-nowrap">{arrival.scheduledTimeText}</p>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-xs text-muted-foreground">{strings.nextLiveArrivalUnavailable}</p>
        )}
      </div>
    </div>
  );
}

export default function StopPopup({
  stopGroup,
  stops,
  vehicles,
  routeMap,
  stopRoutes,
  onFilter,
  onToggleFavorite,
  isFavorite,
}: StopPopupProps) {
  const { strings } = useAppPreferences();
  const platformGroups = useMemo(() => buildPlatformGroups(stopGroup, stopRoutes), [stopGroup, stopRoutes]);

  return (
    <div>
      <h3 className="font-semibold text-sm">{stopGroup.stop_name}</h3>
      <div className="mt-2 space-y-2">
        {platformGroups.map((platform) => (
          <StopDirectionCard
            key={platform.platform_id}
            platform={platform}
            stops={stops}
            vehicles={vehicles}
            routeMap={routeMap}
            stopRoutes={stopRoutes}
            onToggleFavorite={onToggleFavorite}
            isFavorite={isFavorite}
          />
        ))}
      </div>

      <Button size="sm" className="mt-3 w-full" onClick={() => onFilter(stopGroup)}>
        {strings.filterBuses}
      </Button>
    </div>
  );
}