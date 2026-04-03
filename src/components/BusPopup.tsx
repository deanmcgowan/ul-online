import { useEffect, useState, useMemo } from "react";
import { Loader2, MapPin } from "lucide-react";
import type { Vehicle, TransitStop } from "@/components/BusMap";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import { supabase } from "@/integrations/supabase/client";

interface BusPopupProps {
  vehicle: Vehicle & { lineNumber: string };
  userLocation: [number, number] | null;
  walkSpeed: number;
  runSpeed: number;
  stops: TransitStop[];
  routeMap: Record<string, string>;
}

interface NextStopEntry {
  stopName: string;
  scheduledTime: string | null;
  isTerminal: boolean;
}

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
  const [nextStops, setNextStops] = useState<NextStopEntry[]>([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const stopNameById = useMemo(() => new Map(stops.map((s) => [s.stop_id, s.stop_name])), [stops]);

  const distToVehicle = userLocation
    ? haversineDistance(userLocation[1], userLocation[0], vehicle.lat, vehicle.lon)
    : null;

  const walkTimeMin = distToVehicle !== null ? distToVehicle / (walkSpeed / 3.6) / 60 : null;
  const runTimeMin = distToVehicle !== null ? distToVehicle / (runSpeed / 3.6) / 60 : null;

  const destination = nextStops.length > 0
    ? nextStops[nextStops.length - 1]?.stopName ?? null
    : null;

  useEffect(() => {
    if (!vehicle.tripId) {
      setNextStops([]);
      return;
    }

    let cancelled = false;
    setLoadingStops(true);

    supabase
      .from("stop_times")
      .select("stop_id, stop_sequence, arrival_time, departure_time")
      .eq("trip_id", vehicle.tripId)
      .gte("stop_sequence", vehicle.currentStopSequence)
      .order("stop_sequence", { ascending: true })
      .limit(20)
      .then(({ data, error }) => {
        if (cancelled || error || !data) {
          setLoadingStops(false);
          return;
        }

        const upcoming = data
          .filter((row) => row.stop_sequence >= vehicle.currentStopSequence)
          .slice(0, 6)
          .map((row, _index, allRows) => ({
            stopName: stopNameById.get(row.stop_id) ?? row.stop_id,
            scheduledTime: formatGtfsTime(row.arrival_time ?? row.departure_time),
            isTerminal: row.stop_sequence === allRows[allRows.length - 1]?.stop_sequence,
          }));

        setNextStops(upcoming);
        setLoadingStops(false);
      });

    return () => { cancelled = true; };
  }, [vehicle.tripId, vehicle.currentStopSequence, stopNameById]);

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
            {nextStops.map((stop, index) => (
              <div key={index} className="flex items-center gap-1.5 text-xs">
                <MapPin className={`h-3 w-3 shrink-0 ${stop.isTerminal ? "text-primary" : "text-muted-foreground"}`} />
                <span className={`flex-1 truncate ${stop.isTerminal ? "font-semibold" : ""}`}>{stop.stopName}</span>
                {stop.scheduledTime ? (
                  <span className="text-muted-foreground shrink-0">{stop.scheduledTime}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default BusPopup;
