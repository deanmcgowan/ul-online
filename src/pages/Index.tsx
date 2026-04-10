import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import BusMap, { Vehicle, TransitStop } from "@/components/BusMap";
import CommuteDashboard from "@/components/CommuteDashboard";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import { fetchVehicles } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useCommutePlans, getTrafficQueryForPlan } from "@/hooks/useCommutePlans";
import { useRoadSituations } from "@/hooks/useRoadSituations";
import { useToast } from "@/hooks/use-toast";
import { Settings, X, Locate, Star, Loader2, Check, Circle, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import RefreshTimer from "@/components/RefreshTimer";
import { useFavoriteStops } from "@/hooks/useFavoriteStops";
import { useSavedPlaces } from "@/hooks/useSavedPlaces";
import { useStaticData } from "@/hooks/useStaticData";
import { useTripUpdates } from "@/hooks/useTripUpdates";
import { useServiceAlerts } from "@/hooks/useServiceAlerts";
import { buildStopGroups, findStopGroupForStop, type TransitStopGroup } from "@/lib/stopGroups";
import Map from "ol/Map";
import { fromLonLat, toLonLat } from "ol/proj";

const ACTIVE_VEHICLE_REFRESH_MS = 10000;
const DEFAULT_TRAFFIC_RADIUS_METERS = 5000;

function isSameTrafficQuery(
  left: { lat: number; lon: number; radiusMeters: number; limit: number } | null,
  right: { lat: number; lon: number; radiusMeters: number; limit: number } | null,
) {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.lat === right.lat &&
    left.lon === right.lon &&
    left.radiusMeters === right.radiusMeters &&
    left.limit === right.limit
  );
}

function haversineDistanceMeters(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const earthRadius = 6371000;
  const dLat = ((toLat - fromLat) * Math.PI) / 180;
  const dLon = ((toLon - fromLon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((fromLat * Math.PI) / 180) *
      Math.cos((toLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getTrafficQueryFromMap(map: Map) {
  const view = map.getView();
  const center = view.getCenter();
  const size = map.getSize();

  if (!center || !size) {
    return null;
  }

  const [centerLon, centerLat] = toLonLat(center);
  const extent = view.calculateExtent(size);
  const [edgeLon, edgeLat] = toLonLat([extent[2], extent[3]]);
  const radiusMeters = Math.min(
    12000,
    Math.max(2500, Math.round(haversineDistanceMeters(centerLat, centerLon, edgeLat, edgeLon))),
  );

  return {
    lat: Number(centerLat.toFixed(6)),
    lon: Number(centerLon.toFixed(6)),
    radiusMeters,
    limit: 8,
  };
}

function getInitialAppActiveState(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

const Index = () => {
  const navigate = useNavigate();
  const { preferences, resolvedLanguage, strings } = useAppPreferences();
  const { toast } = useToast();
  const { favorites, addFavorite, removeFavorite, isFavorite } = useFavoriteStops();
  const { savedPlaces } = useSavedPlaces();
  const { stops, routeMap, stopRoutes, loading: staticLoading, checklist } = useStaticData();
  const stopGroups = useMemo(() => buildStopGroups(stops, stopRoutes), [stops, stopRoutes]);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [filteredStop, setFilteredStop] = useState<TransitStopGroup | null>(null);
  const [isPageVisible, setIsPageVisible] = useState(() => document.visibilityState === "visible");
  const [isWindowFocused, setIsWindowFocused] = useState(getInitialAppActiveState);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [mapInstance, setMapInstance] = useState<Map | null>(null);
  const [trafficQuery, setTrafficQuery] = useState({
    lat: 59.8586,
    lon: 17.6389,
    radiusMeters: DEFAULT_TRAFFIC_RADIUS_METERS,
    limit: 8,
  });
  const [showFavorites, setShowFavorites] = useState(false);
  const [activeCommutePlanId, setActiveCommutePlanId] = useState<string | null>(null);
  const [highlightedCommuteStop, setHighlightedCommuteStop] = useState<TransitStop | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const [shouldTrackLocation, setShouldTrackLocation] = useState(false);
  const [locationStatus, setLocationStatus] = useState<"idle" | "requesting" | "ready" | "denied" | "unsupported">("idle");
  const isAppActive = isPageVisible && isWindowFocused;

  const {
    walkSpeed,
    runSpeed,
    bufferMinutes,
    maxWalkDistanceMeters,
    highAccuracyLocation,
    stopVisibilityZoom,
  } = preferences;
  const { situations: roadSituations } = useRoadSituations(trafficQuery, isAppActive);
  const { delayByTrip } = useTripUpdates(isAppActive);
  const { alerts: serviceAlerts } = useServiceAlerts(isAppActive, resolvedLanguage === "sv-SE" ? "sv" : "en");
  const [showAlerts, setShowAlerts] = useState(false);
  const { plans: commutePlans, loading: commuteLoading } = useCommutePlans({
    savedPlaces,
    userLocation,
    stops,
    stopRoutes,
    routeMap,
    vehicles,
    walkSpeed,
    bufferMinutes,
    maxWalkDistanceMeters,
    roadSituations,
  });
  const likelyPlan = useMemo(
    () => commutePlans.find((plan) => plan.activeOrigin && plan.bestOption) ?? commutePlans.find((plan) => plan.bestOption) ?? null,
    [commutePlans],
  );
  const likelyCommuteQuery = useMemo(() => getTrafficQueryForPlan(likelyPlan), [likelyPlan]);
  const hasEnoughPlaces = savedPlaces.length >= 2;

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

    if (!isAppActive || watchIdRef.current !== null) {
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
  }, [highAccuracyLocation, isAppActive, stopLocationTracking]);

  useEffect(() => {
    const handleVisibilityChange = () => setIsPageVisible(document.visibilityState === "visible");
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);
    const handlePageHide = () => {
      setIsPageVisible(false);
      setIsWindowFocused(false);
    };
    const handlePageShow = () => {
      setIsPageVisible(document.visibilityState === "visible");
      setIsWindowFocused(document.hasFocus());
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  useEffect(() => {
    if (!isAppActive) return;
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
        scheduleNextRun(ACTIVE_VEHICLE_REFRESH_MS);
        return;
      }

      try {
        const { data, error } = await fetchVehicles();
        if (error) throw error;
        if (data?.vehicles) setVehicles(data.vehicles as Vehicle[]);
        setLastRefresh(Date.now());
        scheduleNextRun(ACTIVE_VEHICLE_REFRESH_MS);
      } catch (error) {
        console.error("Vehicle fetch error:", error);
        scheduleNextRun(ACTIVE_VEHICLE_REFRESH_MS);
      }
    };

    runFetch();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [isAppActive]);

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
          setShouldTrackLocation(true);
          return;
        }

        if (status.state === "denied") {
          setLocationStatus("denied");
          setShouldTrackLocation(false);
        }
      })
      .catch(() => {
        // Safari may not expose permission status consistently.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => stopLocationTracking();
  }, [stopLocationTracking]);

  useEffect(() => {
    if (likelyCommuteQuery) {
      setTrafficQuery((current) => (isSameTrafficQuery(current, likelyCommuteQuery) ? current : likelyCommuteQuery));
      return;
    }

    if (mapInstance) {
      const updateTrafficQuery = () => {
        const nextQuery = getTrafficQueryFromMap(mapInstance);
        if (nextQuery) {
          setTrafficQuery((current) => (isSameTrafficQuery(current, nextQuery) ? current : nextQuery));
        }
      };

      updateTrafficQuery();
      mapInstance.on("moveend", updateTrafficQuery);

      return () => {
        mapInstance.un("moveend", updateTrafficQuery);
      };
    }

    if (userLocation) {
      const nextQuery = {
        lat: Number(userLocation[1].toFixed(6)),
        lon: Number(userLocation[0].toFixed(6)),
        radiusMeters: DEFAULT_TRAFFIC_RADIUS_METERS,
        limit: 8,
      };
      setTrafficQuery((current) => (isSameTrafficQuery(current, nextQuery) ? current : nextQuery));
    }
  }, [likelyCommuteQuery, mapInstance, userLocation]);

  useEffect(() => {
    if (!shouldTrackLocation || !isAppActive) {
      stopLocationTracking();
      return;
    }

    startLocationTracking();

    return () => stopLocationTracking();
  }, [isAppActive, shouldTrackLocation, startLocationTracking, stopLocationTracking]);

  const resolveStopGroup = useCallback(
    (stop: TransitStop) => findStopGroupForStop(stop, stopGroups),
    [stopGroups],
  );

  const handleStopClick = useCallback((stopGroup: TransitStopGroup) => {
    setFilteredStop(stopGroup);
    setHighlightedCommuteStop(null);
    setShowFavorites(false);
  }, []);

  const handleClearFilter = useCallback(() => {
    setFilteredStop(null);
    setHighlightedCommuteStop(null);
    setActiveCommutePlanId(null);
  }, []);

  const handleLocate = useCallback(() => {
    setShouldTrackLocation(true);

    if (!userLocation) {
      return;
    }

    if (mapInstance) {
      const [lon, lat] = userLocation;
      const runRadiusMeters = (runSpeed / 3.6) * (bufferMinutes * 60);
      const deltaLat = runRadiusMeters / 111320;
      const deltaLon = runRadiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
      const sw = fromLonLat([lon - deltaLon, lat - deltaLat]);
      const ne = fromLonLat([lon + deltaLon, lat + deltaLat]);
      mapInstance.getView().fit([sw[0], sw[1], ne[0], ne[1]], {
        padding: [60, 60, 60, 60],
        duration: 500,
      });
    }
  }, [userLocation, mapInstance, runSpeed, bufferMinutes]);

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
    setFilteredStop(resolveStopGroup(stop));
    setHighlightedCommuteStop(null);
    setActiveCommutePlanId(null);
    setShowFavorites(false);
  }, [resolveStopGroup]);

  const handleCommutePlanSelect = useCallback((plan: Parameters<NonNullable<React.ComponentProps<typeof CommuteDashboard>["onSelectPlan"]>>[0]) => {
    if (!plan.bestOption) {
      return;
    }

    setActiveCommutePlanId(plan.id);
    setFilteredStop(resolveStopGroup(plan.bestOption.originStop));
    setHighlightedCommuteStop({ ...plan.bestOption.originStop });
    setShowFavorites(false);

    toast({
      title: strings.commuteSelectionToastTitle,
      description: strings.commuteSelectionToastDescription(
        plan.bestOption.originStop.stop_name,
        plan.bestOption.lineNumber,
      ),
    });
  }, [resolveStopGroup, strings, toast]);

  const filteredVehicles = useMemo(() => {
    if (!filteredStop) {
      return vehicles;
    }

    if (filteredStop.routeIds.length > 0) {
      const allowedRoutes = new Set(filteredStop.routeIds);
      return vehicles.filter((v) => allowedRoutes.has(v.routeId));
    }

    return vehicles;
  }, [filteredStop, vehicles]);

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
        maxWalkDistanceMeters={maxWalkDistanceMeters}
        filteredStop={filteredStop}
        onStopClick={handleStopClick}
        onBusClick={() => {}}
        onMapReady={setMapInstance}
        isFavorite={isFavorite}
        onToggleFavorite={handleToggleFavorite}
        stopVisibilityZoom={stopVisibilityZoom}
        stopRoutes={stopRoutes}
        highlightedStop={highlightedCommuteStop}
        tripDelayMap={delayByTrip}
        savedPlaces={savedPlaces}
        lastRefresh={lastRefresh}
        refreshIntervalMs={ACTIVE_VEHICLE_REFRESH_MS}
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
            <p className="text-xs text-muted-foreground">{strings.filteringByStop}</p>
            <p className="text-sm font-semibold">{filteredStop.stop_name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClearFilter}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <CommuteDashboard
        plans={commutePlans}
        loading={commuteLoading}
        hasEnoughPlaces={hasEnoughPlaces}
        onOpenSettings={() => navigate("/settings")}
        onSelectPlan={handleCommutePlanSelect}
        activePlanId={activeCommutePlanId}
        offsetTopClassName={filteredStop ? "top-24" : "top-4"}
      />

      {/* Favorites panel */}
      {showFavorites && favorites.length > 0 && (
        <div className={`absolute left-4 z-10 w-[min(19rem,calc(100vw-6rem))] rounded-lg border bg-background/95 shadow-lg backdrop-blur-sm max-h-[50vh] overflow-y-auto ${filteredStop ? "top-24" : "top-4"}`}>
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <p className="text-sm font-semibold">{strings.favouriteStops}</p>
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
                <span className="block font-medium">{fav.stop_name}</span>
                <span className="block text-xs text-muted-foreground">#{fav.stop_id}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="absolute bottom-6 left-4 z-10 flex flex-col gap-2 items-start">
        <RefreshTimer intervalMs={ACTIVE_VEHICLE_REFRESH_MS} lastRefresh={lastRefresh} isActive={isAppActive} />
      </div>

      {/* Service alerts */}
      {serviceAlerts.length > 0 && (
        <div className="absolute bottom-20 left-4 right-16 z-10 max-w-sm">
          <button
            className="flex items-center gap-2 bg-destructive/90 text-destructive-foreground backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg text-xs font-medium w-full text-left"
            onClick={() => setShowAlerts(!showAlerts)}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{strings.serviceAlertCount(serviceAlerts.length)}</span>
            {showAlerts ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronUp className="h-3.5 w-3.5 shrink-0" />}
          </button>
          {showAlerts && (
            <div className="mt-1 rounded-lg border bg-background/95 backdrop-blur-sm shadow-lg max-h-[40vh] overflow-y-auto">
              {serviceAlerts.map((alert) => (
                <div key={alert.id} className="px-3 py-2 border-b last:border-b-0">
                  <p className="text-xs font-semibold">{alert.header}</p>
                  {alert.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-3">{alert.description}</p>
                  )}
                  {alert.url && (
                    <a href={alert.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary mt-0.5 inline-block">
                      {strings.openSourceLink}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="absolute bottom-6 right-4 flex flex-col gap-2 z-10">
        {favorites.length > 0 && (
          <Button
            variant="secondary"
            size="icon"
            className="rounded-full shadow-lg h-11 w-11"
            aria-label={strings.showFavouriteStops}
            onClick={() => setShowFavorites(!showFavorites)}
          >
            <Star className="h-5 w-5" />
          </Button>
        )}
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full shadow-lg h-11 w-11"
          aria-label={strings.openSettings}
          onClick={() => navigate("/settings")}
        >
          <Settings className="h-5 w-5" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full shadow-lg h-11 w-11"
          aria-label={strings.centerOnMyLocation}
          onClick={handleLocate}
        >
          <Locate className={`h-5 w-5 ${locationStatus === "requesting" ? "animate-pulse" : ""}`} />
        </Button>
      </div>
    </div>
  );
};

export default Index;
