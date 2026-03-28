import type { Vehicle } from "@/components/BusMap";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";

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
  const { strings } = useAppPreferences();
  const distToVehicle = userLocation
    ? haversineDistance(userLocation[1], userLocation[0], vehicle.lat, vehicle.lon)
    : null;

  const walkTimeMin = distToVehicle !== null ? distToVehicle / (walkSpeed / 3.6) / 60 : null;
  const runTimeMin = distToVehicle !== null ? distToVehicle / (runSpeed / 3.6) / 60 : null;

  return (
    <div>
      <h3 className="font-semibold text-sm">{strings.line} {vehicle.lineNumber}</h3>
      <p className="text-xs text-muted-foreground mt-1">
        {((vehicle.speed || 0) * 3.6).toFixed(0)} km/h · {(vehicle.bearing || 0).toFixed(0)}°
      </p>

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
    </div>
  );
};

export default BusPopup;
