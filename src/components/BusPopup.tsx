import { useEffect, useState, useMemo, useRef } from "react";
import { Loader2, MapPin } from "lucide-react";
import type { Vehicle, TransitStop } from "@/components/BusMap";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import { fetchStopTimes } from "@/lib/api";

interface BusPopupProps {
  vehicle: Vehicle & { lineNumber: string };
  userLocation: [number, number] | null;
  walkSpeed: number;
  runSpeed: number;
  stops: TransitStop[];
  routeMap: Record<string, string>;
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

const BusPopup = ({
  vehicle,
  userLocation,
  walkSpeed,
  runSpeed,
  stops,
  routeMap,
}: BusPopupProps) => {
  const { strings } = useAppPreferences();
  // Full schedule for the trip — fetched once per tripId
  const [schedule, setSchedule] = useState<StopTimeRow[]>([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const fetchedTripRef = useRef<string>("");
  const stopById = useMemo(() => new Map(stops.map((s) => [s.stop_id, s])), [stops]);

  const distToVehicle = userLocation
    ? haversineDistance(userLocation[1], userLocation[0], vehicle.lat, vehicle.lon)
    : null;

  const walkTimeMin = distToVehicle !== null ? distToVehicle / (walkSpeed / 3.6) / 60 : null;
  const runTimeMin = distToVehicle !== null ? distToVehicle / (runSpeed / 3.6) / 60 : null;

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
  // Re-computes whenever the bus moves, without querying the DB.
  const nextStops = useMemo((): NextStopEntry[] => {
    if (schedule.length === 0) return [];

    // Use GPS proximity to find the nearest stop on the route
    let nearestIdx = 0;
    let nearestDist = Infinity;
    if (vehicle.lat && vehicle.lon) {
      for (let i = 0; i < schedule.length; i++) {
        const stop = stopById.get(schedule[i].stop_id);
        if (!stop) continue;
        const d = haversineDistance(vehicle.lat, vehicle.lon, stop.stop_lat, stop.stop_lon);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
    }

    // If bus is within 200m of the nearest stop it's at or just past it;
    // otherwise it's heading toward it.
    let nextIdx = nearestIdx;
    if (nearestDist < 200 && nearestIdx < schedule.length - 1) {
      nextIdx++;
    }

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
        isTerminal: row.stop_sequence === lastSeq,
      };
    });
  }, [schedule, vehicle.lat, vehicle.lon, stopById]);

  const destination = nextStops.length > 0
    ? nextStops[nextStops.length - 1]?.stopName ?? null
    : null;

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

  return (
    <div>
      <h3 className="font-semibold text-sm">{strings.line} {vehicle.lineNumber}</h3>
      {destination ? (
        <p className="text-xs text-muted-foreground mt-0.5">{strings.headingTo(destination)}</p>
      ) : null}

      {distToVehicle !== null && walkTimeMin !== null && runTimeMin !== null && (
        <div className="mt-2 pt-2 border-t text-xs">
          <p className="font-medium mb-0.5">
            {strings.distance}: {distToVehicle < 1000
              ? `${Math.round(distToVehicle)} m`
              : `${(distToVehicle / 1000).toFixed(1)} km`}
          </p>
          <p className="text-muted-foreground">
            🚶 {formatDuration(walkTimeMin)} · 🏃 {formatDuration(runTimeMin)}
          </p>
        </div>
      )}

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
              return (
                <div key={index} className="flex items-center gap-1.5 text-xs">
                  {isClosest ? (
                    <MapPin className="h-3 w-3 shrink-0 text-green-600" />
                  ) : (
                    <MapPin className={`h-3 w-3 shrink-0 ${iconColor}`} />
                  )}
                  <span className={`flex-1 truncate ${nameClass}`}>{stop.stopName}</span>
                  {stop.scheduledTime ? (
                    <span className="text-muted-foreground shrink-0">{stop.scheduledTime}</span>
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
