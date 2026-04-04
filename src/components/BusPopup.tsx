import { useEffect, useState, useMemo, useRef } from "react";
import { Loader2, MapPin, AlertTriangle } from "lucide-react";
import type { Vehicle, TransitStop } from "@/components/BusMap";
import type { TripDelay } from "@/hooks/useTripUpdates";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import { fetchStopTimes } from "@/lib/api";

interface BusPopupProps {
  vehicle: Vehicle & { lineNumber: string };
  userLocation: [number, number] | null;
  stops: TransitStop[];
  routeMap: Record<string, string>;
  tripDelay: TripDelay | null;
}

interface StopTimeRow {
  stop_id: string;
  stop_sequence: number;
  arrival_time: string;
  departure_time: string;
}

interface NextStopEntry {
  stopId: string;
  stopName: string;
  stopLat: number;
  stopLon: number;
  scheduledTime: string | null;
  rawTime: string | null;
  stopSequence: number;
  isTerminal: boolean;
}

const MAX_UPCOMING_STOPS = 5;
const CLOSEST_STOP_RADIUS_METERS = 2000;

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return "<1 min";
  return `${Math.round(minutes)} min`;
}

/** Parse "HH:MM:SS" (may exceed 24h) into seconds-since-midnight */
function gtfsTimeToSeconds(value: string): number {
  const parts = value.split(":").map(Number);
  if (parts.length !== 3) return -1;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function formatGtfsTime(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  if (parts.length !== 3) return null;
  const hours = ((parts[0] % 24) + 24) % 24;
  return `${String(hours).padStart(2, "0")}:${String(parts[1]).padStart(2, "0")}`;
}

/** Compute expected time by adding delay seconds to a raw GTFS time string */
function computeExpectedTime(rawTime: string | null, delaySec: number | null): string | null {
  if (!rawTime) return null;
  if (delaySec == null || delaySec === 0) return formatGtfsTime(rawTime);
  const totalSec = gtfsTimeToSeconds(rawTime) + delaySec;
  const hours = ((Math.floor(totalSec / 3600) % 24) + 24) % 24;
  const minutes = Math.floor((totalSec % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Current wall-clock time as seconds since midnight */
function nowSeconds(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

const BusPopup = ({
  vehicle,
  userLocation,
  stops,
  routeMap,
  tripDelay,
}: BusPopupProps) => {
  const { strings } = useAppPreferences();
  // Full schedule for the trip — fetched once per tripId
  const [schedule, setSchedule] = useState<StopTimeRow[]>([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const fetchedTripRef = useRef<string>("");
  const stopById = useMemo(() => new Map(stops.map((s) => [s.stop_id, s])), [stops]);

  // Fetch full schedule ONCE per tripId
  useEffect(() => {
    if (!vehicle.tripId || vehicle.tripId === fetchedTripRef.current) return;
    fetchedTripRef.current = vehicle.tripId;

    let cancelled = false;
    setLoadingStops(true);

    fetchStopTimes(vehicle.tripId)
      .then(({ data, error }) => {
        if (cancelled) return;
        setSchedule(!error && data?.data ? data.data : []);
        setLoadingStops(false);
      });

    return () => { cancelled = true; };
  }, [vehicle.tripId]);

  // Derive upcoming stops from cached schedule + current vehicle position.
  // Re-computes whenever the bus moves or its GTFS RT stop sequence updates.
  const nextStops = useMemo((): NextStopEntry[] => {
    if (schedule.length === 0) return [];

    let nextIdx = -1;

    // Method 1: GTFS RT currentStopSequence — most authoritative
    if (vehicle.currentStopSequence > 0) {
      const idx = schedule.findIndex((row) => row.stop_sequence >= vehicle.currentStopSequence);
      if (idx >= 0) {
        const isExact = schedule[idx].stop_sequence === vehicle.currentStopSequence;
        if (isExact && vehicle.currentStatus === "STOPPED_AT" && idx < schedule.length - 1) {
          nextIdx = idx + 1;
        } else {
          nextIdx = idx;
        }
      }
    }

    // Method 2: GPS proximity fallback
    if (nextIdx < 0 && vehicle.lat && vehicle.lon) {
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < schedule.length; i++) {
        const stop = stopById.get(schedule[i].stop_id);
        if (!stop) continue;
        const d = haversineDistance(vehicle.lat, vehicle.lon, stop.stop_lat, stop.stop_lon);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
      nextIdx = nearestIdx;
      if (nearestDist < 200 && nearestIdx < schedule.length - 1) {
        nextIdx++;
      }
    }

    if (nextIdx < 0) nextIdx = 0;

    // If we're past all stops, show the last few
    if (nextIdx >= schedule.length) {
      nextIdx = Math.max(0, schedule.length - MAX_UPCOMING_STOPS);
    }

    const lastSeq = schedule[schedule.length - 1]?.stop_sequence;
    return schedule.slice(nextIdx, nextIdx + MAX_UPCOMING_STOPS).map((row) => {
      const stop = stopById.get(row.stop_id);
      return {
        stopId: row.stop_id,
        stopName: stop?.stop_name ?? row.stop_id,
        stopLat: stop?.stop_lat ?? 0,
        stopLon: stop?.stop_lon ?? 0,
        scheduledTime: formatGtfsTime(row.arrival_time ?? row.departure_time),
        rawTime: row.arrival_time ?? row.departure_time ?? null,
        stopSequence: row.stop_sequence,
        isTerminal: row.stop_sequence === lastSeq,
      };
    });
  }, [schedule, vehicle.lat, vehicle.lon, vehicle.currentStopSequence, vehicle.currentStatus, stopById]);

  const destination = useMemo(() => {
    if (schedule.length === 0) return null;
    const lastRow = schedule[schedule.length - 1];
    const stop = stopById.get(lastRow.stop_id);
    return stop?.stop_name ?? null;
  }, [schedule, stopById]);

  // Find the stop closest to user among upcoming stops
  const closestStopId = useMemo(() => {
    if (!userLocation || nextStops.length === 0) return null;
    let bestId: string | null = null;
    let bestDist = CLOSEST_STOP_RADIUS_METERS;
    for (const s of nextStops) {
      if (!s.stopLat || !s.stopLon) continue;
      const d = haversineDistance(userLocation[1], userLocation[0], s.stopLat, s.stopLon);
      if (d < bestDist) {
        bestDist = d;
        bestId = s.stopId;
      }
    }
    return bestId;
  }, [userLocation, nextStops]);

  // Compute the effective delay:
  // 1. From GTFS-RT trip update (first upcoming stop), most authoritative
  // 2. Implied from schedule: if the next stop's scheduled time is in the past,
  //    the bus is late by (now - scheduledTime) even without real-time data
  const effectiveDelay = useMemo(() => {
    if (tripDelay?.canceled) return tripDelay.delay;

    // Try real-time data first
    if (tripDelay) {
      if (nextStops.length === 0) return tripDelay.delay;
      for (const stop of nextStops) {
        const su = tripDelay.stopUpdates.find(
          (u) => u.stopSequence === stop.stopSequence || u.stopId === stop.stopId
        );
        const d = su?.arrivalDelay ?? su?.departureDelay ?? null;
        if (d != null) return d;
      }
      return tripDelay.delay;
    }

    // No trip update — infer delay from schedule vs current time
    if (nextStops.length === 0) return null;
    const firstRaw = nextStops[0].rawTime;
    if (!firstRaw) return null;
    const scheduledSec = gtfsTimeToSeconds(firstRaw);
    if (scheduledSec < 0) return null;
    const implied = nowSeconds() - scheduledSec;
    // Only report as delay if >30 seconds behind schedule
    if (implied > 30) return implied;
    return null;
  }, [tripDelay, nextStops]);

  return (
    <div>
      <h3 className="font-semibold text-sm">{strings.line} {vehicle.lineNumber}</h3>
      {destination ? (
        <p className="text-xs text-muted-foreground mt-0.5">{strings.headingTo(destination)}</p>
      ) : null}

      {tripDelay?.canceled ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{strings.tripCanceled}</span>
        </div>
      ) : effectiveDelay != null && Math.abs(effectiveDelay) >= 30 ? (
        <div className={`mt-1.5 flex items-center gap-1.5 text-xs font-medium ${effectiveDelay > 0 ? "text-orange-600" : "text-green-600"}`}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {effectiveDelay > 0
              ? strings.delayedBy(formatDuration(effectiveDelay / 60))
              : strings.aheadOfSchedule(formatDuration(Math.abs(effectiveDelay) / 60))}
          </span>
        </div>
      ) : effectiveDelay != null && Math.abs(effectiveDelay) < 30 ? (
        <p className="mt-1 text-xs text-green-600">{strings.onTime}</p>
      ) : null}

      {loadingStops ? (
        <div className="mt-2 pt-2 border-t flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{strings.loading}</span>
        </div>
      ) : nextStops.length > 0 ? (
        <div className="mt-2 pt-2 border-t">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">{strings.nextStops}</p>
          <div className="space-y-0.5">
            {nextStops.map((stop, index) => {
              const isClosest = stop.stopId === closestStopId;
              const iconColor = stop.isTerminal
                  ? "text-primary"
                  : isClosest
                    ? "text-green-600"
                    : "text-muted-foreground";
              const nameClass = stop.isTerminal ? "font-semibold" : "";

              // Per-stop delay: use real-time data if available, else effective delay
              const stopUpdate = tripDelay?.stopUpdates.find(
                (su) => su.stopSequence === stop.stopSequence || su.stopId === stop.stopId
              );
              const perStopDelay = stopUpdate?.arrivalDelay ?? stopUpdate?.departureDelay ?? null;
              // Use per-stop real-time delay, or fall back to the effective (possibly implied) delay
              const delaySec = perStopDelay ?? (effectiveDelay != null && effectiveDelay > 30 ? effectiveDelay : null);
              const hasDelay = delaySec != null && Math.abs(delaySec) >= 30;
              const expectedTime = hasDelay
                ? computeExpectedTime(stop.rawTime, delaySec)
                : stop.scheduledTime;

              return (
                <div key={index} className="flex items-center gap-1.5 text-xs">
                  {isClosest ? (
                    <MapPin className="h-3 w-3 shrink-0 text-green-600" />
                  ) : (
                    <MapPin className={`h-3 w-3 shrink-0 ${iconColor}`} />
                  )}
                  <span className={`flex-1 truncate ${nameClass}`}>{stop.stopName}</span>
                  {expectedTime ? (
                    <span className="shrink-0 font-medium text-muted-foreground">{expectedTime}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default BusPopup;
