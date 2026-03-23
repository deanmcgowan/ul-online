import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import BusMap, { Vehicle, TransitStop } from "@/components/BusMap";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Settings, X, Locate } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import RefreshTimer from "@/components/RefreshTimer";
import Map from "ol/Map";
import { fromLonLat } from "ol/proj";

async function fetchAllRows<T>(table: string): Promise<T[]> {
  const all: T[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data } = await (supabase as any)
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

const Index = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [stops, setStops] = useState<TransitStop[]>([]);
  const [routeMap, setRouteMap] = useState<Record<string, string>>({});
  const [stopRoutes, setStopRoutes] = useState<Record<string, string[]>>({});
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [filteredStop, setFilteredStop] = useState<TransitStop | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [importing, setImporting] = useState(false);
  const [mapInstance, setMapInstance] = useState<Map | null>(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const walkSpeed = parseFloat(localStorage.getItem("walkSpeed") || "4");
  const runSpeed = parseFloat(localStorage.getItem("runSpeed") || "9");
  const bufferMinutes = parseFloat(localStorage.getItem("bufferMinutes") || "5");

  // Page visibility
  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Fetch vehicles every 10s when visible
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

  // Fetch stops from DB (paginated)
  useEffect(() => {
    fetchAllRows<TransitStop>("transit_stops").then(setStops);
  }, []);

  // Fetch routes from DB
  useEffect(() => {
    const fetchRoutes = async () => {
      const data = await fetchAllRows<any>("transit_routes");
      const map: Record<string, string> = {};
      data.forEach((r: any) => {
        map[r.route_id] = r.route_short_name || r.route_id;
      });
      setRouteMap(map);
    };
    fetchRoutes();
  }, []);

  // Fetch stop_routes from DB (paginated)
  useEffect(() => {
    const fetchStopRoutes = async () => {
      const data = await fetchAllRows<any>("stop_routes");
      const map: Record<string, string[]> = {};
      data.forEach((sr: any) => {
        if (!map[sr.stop_id]) map[sr.stop_id] = [];
        map[sr.stop_id].push(sr.route_id);
      });
      setStopRoutes(map);
    };
    fetchStopRoutes();
  }, []);

  // User geolocation
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

  const handleImport = useCallback(async () => {
    setImporting(true);
    toast({ title: "Importing GTFS data...", description: "This may take a few minutes." });
    try {
      const { data, error } = await supabase.functions.invoke("trafiklab-import");
      if (error) throw error;
      toast({
        title: "Import complete",
        description: `${data.stops_imported} stops, ${data.routes_imported} routes imported.`,
      });
      // Refresh data
      const stopsData = await fetchAllRows<TransitStop>("transit_stops");
      setStops(stopsData);
      const routesData = await fetchAllRows<any>("transit_routes");
      const map: Record<string, string> = {};
      routesData.forEach((r: any) => {
        map[r.route_id] = r.route_short_name || r.route_id;
      });
      setRouteMap(map);
      const srData = await fetchAllRows<any>("stop_routes");
      const srMap: Record<string, string[]> = {};
      srData.forEach((sr: any) => {
        if (!srMap[sr.stop_id]) srMap[sr.stop_id] = [];
        srMap[sr.stop_id].push(sr.route_id);
      });
      setStopRoutes(srMap);
    } catch (err: any) {
      toast({
        title: "Import failed",
        description: err.message || "Check edge function logs.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  }, [toast]);

  // Filter vehicles based on stop_routes
  const filteredVehicles = filteredStop
    ? (() => {
        const allowedRoutes = stopRoutes[filteredStop.stop_id];
        if (allowedRoutes && allowedRoutes.length > 0) {
          return vehicles.filter((v) => allowedRoutes.includes(v.routeId));
        }
        const nearStopIds = stops
          .filter((s) => {
            const dlat = s.stop_lat - filteredStop.stop_lat;
            const dlon = s.stop_lon - filteredStop.stop_lon;
            return Math.sqrt(dlat * dlat + dlon * dlon) < 0.003;
          })
          .map((s) => s.stop_id);
        const routeIds = new Set(
          vehicles
            .filter((v) => nearStopIds.includes(v.stopId))
            .map((v) => v.routeId)
        );
        return routeIds.size > 0
          ? vehicles.filter((v) => routeIds.has(v.routeId))
          : vehicles;
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
      />

      {/* Filter bar */}
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

      {/* No stops banner */}
      {stops.length === 0 && (
        <div className="absolute top-4 left-4 right-4 bg-background/95 backdrop-blur-sm rounded-lg px-4 py-3 shadow-lg z-10 border">
          <p className="text-sm mb-2">
            No stop data loaded. Import GTFS data to see bus stops.
          </p>
          <Button size="sm" onClick={handleImport} disabled={importing}>
            <Download className="h-4 w-4 mr-2" />
            {importing ? "Importing..." : "Import GTFS Data"}
          </Button>
        </div>
      )}

      {/* Refresh timer */}
      <div className="absolute bottom-24 left-4 z-10">
        <RefreshTimer intervalMs={10000} lastRefresh={lastRefresh} />
      </div>

      {/* Control buttons */}
      <div className="absolute bottom-6 right-4 flex flex-col gap-2 z-10">
        {stops.length > 0 && (
          <Button
            variant="secondary"
            size="icon"
            className="rounded-full shadow-lg h-11 w-11"
            onClick={handleImport}
            disabled={importing}
            title="Re-import GTFS data"
          >
            <Download className="h-5 w-5" />
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
