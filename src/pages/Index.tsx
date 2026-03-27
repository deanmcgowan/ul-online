import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import BusMap, { Vehicle, TransitStop } from "@/components/BusMap";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Settings, X, Locate, Star, Loader2 } from "lucide-react";
import RefreshTimer from "@/components/RefreshTimer";
import { useFavoriteStops } from "@/hooks/useFavoriteStops";
import { useStaticData } from "@/hooks/useStaticData";
import Map from "ol/Map";
import { fromLonLat } from "ol/proj";

const Index = () => {
  const navigate = useNavigate();
  const { favorites, addFavorite, removeFavorite, isFavorite } = useFavoriteStops();
  const { stops, routeMap, stopRoutes, loading: staticLoading, checklist } = useStaticData();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [filteredStop, setFilteredStop] = useState<TransitStop | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [mapInstance, setMapInstance] = useState<Map | null>(null);
  const [showFavorites, setShowFavorites] = useState(false);

  const walkSpeed = parseFloat(localStorage.getItem("walkSpeed") || "4");
  const runSpeed = parseFloat(localStorage.getItem("runSpeed") || "9");
  const bufferMinutes = parseFloat(localStorage.getItem("bufferMinutes") || "5");

  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const fetchVehicles = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("trafiklab-vehicles");
        if (error) throw error;
        if (data?.vehicles) setVehicles(data.vehicles);
        setLastRefresh(Date.now());
      } catch (err: any) {
        console.error("Vehicle fetch error:", err);
      }
    };
    fetchVehicles();
    const interval = setInterval(fetchVehicles, 10000);
    return () => clearInterval(interval);
  }, [isVisible]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation([pos.coords.longitude, pos.coords.latitude]),
      (err) => console.warn("Geolocation error:", err),
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const handleStopClick = useCallback((stop: TransitStop) => {
    setFilteredStop(stop);
    setShowFavorites(false);
  }, []);

  const handleClearFilter = useCallback(() => {
    setFilteredStop(null);
  }, []);

  const handleLocate = useCallback(() => {
    if (userLocation && mapInstance) {
      mapInstance.getView().animate({
        center: fromLonLat(userLocation),
        zoom: 15,
        duration: 500,
      });
    }
  }, [userLocation, mapInstance]);

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

  const filteredVehicles = filteredStop
    ? (() => {
        const allowedRoutes = getRoutesForStop(filteredStop);
        if (allowedRoutes.size > 0) {
          return vehicles.filter((v) => allowedRoutes.has(v.routeId));
        }
        return vehicles;
      })()
    : vehicles;

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
      />

      {staticLoading && stops.length === 0 && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
          <p className="text-sm text-muted-foreground">{staticProgress}</p>
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
          disabled={!userLocation}
        >
          <Locate className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};

export default Index;
