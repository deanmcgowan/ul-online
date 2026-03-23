import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Vehicle } from "@/components/BusMap";

interface NextStop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  stop_sequence: number;
  arrival_time: string;
  departure_time: string;
}

interface BusPopupProps {
  vehicle: Vehicle & { lineNumber: string };
  userLocation: [number, number] | null;
  walkSpeed: number;
  runSpeed: number;
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

const BusPopup = ({
  vehicle,
  userLocation,
  walkSpeed,
  runSpeed,
}: BusPopupProps) => {
  const [nextStops, setNextStops] = useState<NextStop[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNextStops = async () => {
      if (!vehicle.tripId) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await (supabase as any).rpc("get_next_stops", {
          p_trip_id: vehicle.tripId,
          p_current_seq: vehicle.currentStopSequence || 0,
          p_limit: 5,
        });
        if (data) setNextStops(data);
      } catch (e) {
        console.error("Failed to fetch next stops:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchNextStops();
  }, [vehicle.tripId, vehicle.currentStopSequence]);

  // Find closest upcoming stop to user
  const closestStop =
    userLocation && nextStops.length > 0
      ? nextStops.reduce(
          (best, stop) => {
            const dist = haversineDistance(
              userLocation[1],
              userLocation[0],
              stop.stop_lat,
              stop.stop_lon
            );
            return dist < best.dist ? { stop, dist } : best;
          },
          {
            stop: nextStops[0],
            dist: haversineDistance(
              userLocation[1],
              userLocation[0],
              nextStops[0].stop_lat,
              nextStops[0].stop_lon
            ),
          }
        )
      : null;

  const walkTimeMin = closestStop
    ? closestStop.dist / (walkSpeed / 3.6) / 60
    : null;
  const runTimeMin = closestStop
    ? closestStop.dist / (runSpeed / 3.6) / 60
    : null;

  return (
    <div>
      <h3 className="font-semibold text-sm">Line {vehicle.lineNumber}</h3>
      <p className="text-xs text-muted-foreground mt-1">
        {((vehicle.speed || 0) * 3.6).toFixed(0)} km/h ·{" "}
        {(vehicle.bearing || 0).toFixed(0)}°
      </p>

      {loading ? (
        <p className="text-xs text-muted-foreground mt-2 animate-pulse">
          Loading stops...
        </p>
      ) : nextStops.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-medium mb-1">Next stops:</p>
          <div className="space-y-0.5">
            {nextStops.map((stop) => (
              <div
                key={stop.stop_sequence}
                className="text-xs flex justify-between gap-2"
              >
                <span className="truncate">{stop.stop_name}</span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {stop.arrival_time?.slice(0, 5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {closestStop && walkTimeMin !== null && runTimeMin !== null && (
        <div className="mt-2 pt-2 border-t text-xs">
          <p className="font-medium mb-0.5">
            To {closestStop.stop.stop_name}:
          </p>
          <p className="text-muted-foreground">
            🚶 {formatDuration(walkTimeMin)} · 🏃 {formatDuration(runTimeMin)}
          </p>
        </div>
      )}
    </div>
  );
};

export default BusPopup;
