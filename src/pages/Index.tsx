import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import BusMap, { Vehicle, TransitStop } from "@/components/BusMap";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Settings, X, Locate, Star, Loader2, Check, Circle } from "lucide-react";
import RefreshTimer from "@/components/RefreshTimer";
import { useFavoriteStops } from "@/hooks/useFavoriteStops";
import { useStaticData } from "@/hooks/useStaticData";
import Map from "ol/Map";
import { fromLonLat } from "ol/proj";
import { loadPreferences } from "@/lib/preferences";

const DEFAULT_VEHICLE_REFRESH_MS = 10000;
const SLOW_VEHICLE_REFRESH_MS = 20000;
const OFFLINE_REFRESH_MS = 30000;

function getVehicleRefreshDelay(): number {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;

  if (connection?.saveData || connection?.effectiveType === "2g") {
    return SLOW_VEHICLE_REFRESH_MS;
  }

  return DEFAULT_VEHICLE_REFRESH_MS;
}

const Index = () => {
  const navigate = useNavigate();
  const { favorites, addFavorite, removeFavorite, isFavorite } = useFavoriteStops();
  const { stops, routeMap, stopRoutes, loading: staticLoading, checklist } = useStaticData();
  const [preferences] = useState(loadPreferences);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [filteredStop, setFilteredStop] = useState<TransitStop | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [mapInstance, setMapInstance] = useState<Map | null>(null);
  const [showFavorites, setShowFavorites] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "requesting" | "ready" | "denied" | "unsupported">("idle");

  const { walkSpeed, runSpeed, bufferMinutes, showSkolskjuts, highAccuracyLocation } = preferences;

  const stopLocationTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const startLocationTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus("unsupported");
      return;
    }

    if (watchIdRef.current !== null) {
      return;
    }

    setLocationStatus("requesting");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation([pos.coords.longitude, pos.coords.latitude]);
        setLocationStatus("ready");
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setLocationStatus("denied");
          stopLocationTracking();
          return;
        }

        console.warn("Geolocation error:", err);
        setLocationStatus("idle");
      },
      {
        enableHighAccuracy: highAccuracyLocation,
        maximumAge: highAccuracyLocation ? 10000 : 30000,
        timeout: 20000,
      }
    );
  }, [highAccuracyLocation, stopLocationTracking]);

  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    let timerId: number | null = null;

    const scheduleNextRun = (delay: number) => {
      if (!cancelled) {
        timerId = window.setTimeout(runFetch, delay);
      }
    };

    const runFetch = async () => {
      if (cancelled) return;

      if (!navigator.onLine) {
        scheduleNextRun(OFFLINE_REFRESH_MS);
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke("trafiklab-vehicles");
        if (error) throw error;
        if (data?.vehicles) setVehicles(data.vehicles);
        setLastRefresh(Date.now());
        scheduleNextRun(getVehicleRefreshDelay());
      } catch (err: any) {
        console.error("Vehicle fetch error:", err);
        scheduleNextRun(OFFLINE_REFRESH_MS);
      }
    };

    runFetch();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [isVisible]);

  useEffect(() => {
    if (!("permissions" in navigator)) {
      return;
    }

    let cancelled = false;

    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (cancelled) return;
        if (status.state === "granted") {
          startLocationTracking();
          return;
        }

        if (status.state === "denied") {
          setLocationStatus("denied");
        }
      })
      .catch(() => {
        // Safari may not expose permission status consistently.
      });

    return () => {
      cancelled = true;
    };
  }, [startLocationTracking]);

  useEffect(() => {
    return () => stopLocationTracking();
  }, [stopLocationTracking]);

  const handleStopClick = useCallback((stop: TransitStop) => {
    setFilteredStop(stop);
    setShowFavorites(false);
  }, []);

  const handleClearFilter = useCallback(() => {
    setFilteredStop(null);
  }, []);

  const handleLocate = useCallback(() => {
    if (!userLocation) {
      startLocationTracking();
      return;
    }

    if (mapInstance) {
      mapInstance.getView().animate({
        center: fromLonLat(userLocation),
        zoom: 15,
        duration: 500,
      });
    }
  }, [userLocation, mapInstance, startLocationTracking]);

  const handleToggleFavorite = useCallback(
    (stop: TransitStop) => {
      if (isFavorite(stop.stop_id)) {
        removeFavorite(stop.stop_id);
      } else {
        addFavorite(stop);
      }
    },
    [isFavorite, addFavorite, removeFavorite]
  );

  const handleFavoriteSelect = useCallback((stop: TransitStop) => {
    setFilteredStop(stop);
    setShowFavorites(false);
    if (mapInstance) {
      mapInstance.getView().animate({
        center: fromLonLat([stop.stop_lon, stop.stop_lat]),
        zoom: 15,
        duration: 500,
      });
    }
  }, [mapInstance]);

  // Collect all route_ids for a stop AND its nearby siblings (~300m)
  const getRoutesForStop = useCallback((stop: TransitStop): Set<string> => {
    const routes = new Set<string>();
    // Find all stop_ids near this stop (both sides of street, etc.)
    const nearStopIds = stops
      .filter((s) => {
        const dlat = s.stop_lat - stop.stop_lat;
        const dlon = s.stop_lon - stop.stop_lon;
        return Math.abs(dlat) < 0.003 && Math.abs(dlon) < 0.003;
      })
      .map((s) => s.stop_id);
    
    for (const sid of nearStopIds) {
      const r = stopRoutes[sid];
      if (r) r.forEach((id) => routes.add(id));
    }
    return routes;
  }, [stops, stopRoutes]);

  const filteredVehicles = useMemo(() => {
    if (!filteredStop) {
      return vehicles;
    }

        const allowedRoutes = getRoutesForStop(filteredStop);
        if (allowedRoutes.size > 0) {
          return vehicles.filter((v) => allowedRoutes.has(v.routeId));
        }
        return vehicles;
  }, [filteredStop, getRoutesForStop, vehicles]);

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden">
      <BusMap
        vehicles={filteredVehicles}
        stops={stops}
        routeMap={routeMap}
        userLocation={userLocation}
        walkSpeed={walkSpeed}
        runSpeed={runSpeed}
        bufferMinutes={bufferMinutes}
        filteredStop={filteredStop}
        onStopClick={handleStopClick}
        onBusClick={() => {}}
        onMapReady={setMapInstance}
        isFavorite={isFavorite}
        onToggleFavorite={handleToggleFavorite}
        showSkolskjuts={showSkolskjuts}
      />

      {staticLoading && stops.length === 0 && checklist.length > 0 && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <div className="space-y-2 min-w-[240px]">
            {checklist.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                {item.status === "done" ? (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                ) : item.status === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                )}
                <span className={item.status === "done" ? "text-muted-foreground" : "text-foreground"}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {filteredStop && (
        <div className="absolute top-4 left-4 right-4 bg-background/95 backdrop-blur-sm rounded-lg px-4 py-3 shadow-lg flex items-center justify-between z-10 border">
          <div>
            <p className="text-xs text-muted-foreground">Filtering by stop</p>
            <p className="text-sm font-semibold">{filteredStop.stop_name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClearFilter}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Favorites panel */}
      {showFavorites && favorites.length > 0 && (
        <div className="absolute top-4 left-4 right-4 bg-background/95 backdrop-blur-sm rounded-lg shadow-lg z-10 border max-h-[50vh] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <p className="text-sm font-semibold">Favorite Stops</p>
            <Button variant="ghost" size="icon" onClick={() => setShowFavorites(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="py-1">
            {favorites.map((fav) => (
              <button
                key={fav.stop_id}
                className="w-full text-left px-4 py-2.5 hover:bg-accent text-sm transition-colors"
                onClick={() => handleFavoriteSelect(fav)}
              >
                {fav.stop_name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="absolute bottom-6 left-4 z-10">
        <RefreshTimer intervalMs={10000} lastRefresh={lastRefresh} />
      </div>

      <div className="absolute bottom-6 right-4 flex flex-col gap-2 z-10">
        {favorites.length > 0 && (
          <Button
            variant="secondary"
            size="icon"
            className="rounded-full shadow-lg h-11 w-11"
            onClick={() => setShowFavorites(!showFavorites)}
          >
            <Star className="h-5 w-5" />
          </Button>
        )}
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full shadow-lg h-11 w-11"
          onClick={() => navigate("/settings")}
        >
          <Settings className="h-5 w-5" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full shadow-lg h-11 w-11"
          onClick={handleLocate}
        >
          <Locate className={`h-5 w-5 ${locationStatus === "requesting" ? "animate-pulse" : ""}`} />
        </Button>
      </div>
    </div>
  );
};

export default Index;
