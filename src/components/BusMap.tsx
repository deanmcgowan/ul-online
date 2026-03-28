import { useRef, useEffect, useState, useCallback, useMemo, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import OSM from "ol/source/OSM";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { fromLonLat } from "ol/proj";
import {
  Style,
  Fill,
  Stroke,
  Text,
  Icon,
  Circle as CircleStyle,
} from "ol/style";
import Overlay from "ol/Overlay";
import ClusterSource from "ol/source/Cluster";
import { circular } from "ol/geom/Polygon";
import { boundingExtent } from "ol/extent";
import { fromLonLat, transformExtent } from "ol/proj";
import { createBusCanvas, bearingTowardStop } from "@/lib/busIcon";
import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import "ol/ol.css";

const BusPopup = lazy(() => import("@/components/BusPopup"));
const VEHICLE_ICON_BUCKET = 15;

function padExtent(extent: [number, number, number, number], factor: number): [number, number, number, number] {
  const width = extent[2] - extent[0];
  const height = extent[3] - extent[1];
  const padX = width * factor;
  const padY = height * factor;
  return [extent[0] - padX, extent[1] - padY, extent[2] + padX, extent[3] + padY];
}

function stopIsInExtent(stop: TransitStop, extent: [number, number, number, number]): boolean {
  return (
    stop.stop_lon >= extent[0] &&
    stop.stop_lon <= extent[2] &&
    stop.stop_lat >= extent[1] &&
    stop.stop_lat <= extent[3]
  );
}

export interface Vehicle {
  id: string;
  tripId: string;
  routeId: string;
  directionId: number;
  lat: number;
  lon: number;
  bearing: number;
  speed: number;
  stopId: string;
  currentStopSequence: number;
  vehicleId: string;
  vehicleLabel: string;
  timestamp: number;
}

export interface TransitStop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
}

interface BusMapProps {
  vehicles: Vehicle[];
  stops: TransitStop[];
  routeMap: Record<string, string>;
  userLocation: [number, number] | null;
  walkSpeed: number;
  runSpeed: number;
  bufferMinutes: number;
  filteredStop: TransitStop | null;
  onStopClick: (stop: TransitStop) => void;
  onBusClick: (vehicle: Vehicle & { lineNumber: string }) => void;
  onMapReady?: (map: Map) => void;
  isFavorite?: (stopId: string) => boolean;
  onToggleFavorite?: (stop: TransitStop) => void;
  showSkolskjuts?: boolean;
}

/** Deduplicate stops using a grid-based O(n) approach. ~50m threshold. */
function deduplicateStops(stops: TransitStop[]): TransitStop[] {
  const CELL = 0.0005; // ~50m
  const grid: Record<string, TransitStop> = {};
  for (const s of stops) {
    const key = `${Math.round(s.stop_lat / CELL)},${Math.round(s.stop_lon / CELL)}`;
    if (!grid[key]) grid[key] = s;
  }
  return Object.values(grid);
}

/** Check if a stop name indicates skolskjuts */
function isSkolskjuts(name: string): boolean {
  const lower = name.toLowerCase();
  return /(skolskjuts|skolhållplats|skolhallplats|skolhpl|skolan|skola|\bskol\b)/.test(lower);
}

const BusMap = ({
  vehicles,
  stops,
  routeMap,
  userLocation,
  walkSpeed,
  runSpeed,
  bufferMinutes,
  filteredStop,
  onStopClick,
  onBusClick,
  onMapReady,
  isFavorite,
  onToggleFavorite,
  showSkolskjuts = false,
}: BusMapProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const stopRenderFrameRef = useRef<number | null>(null);
  const stopRenderTokenRef = useRef(0);
  const [popupEl] = useState(() => {
    const el = document.createElement("div");
    el.className = "ol-popup-container";
    return el;
  });

  const vehicleSourceRef = useRef(new VectorSource());
  const stopsRawSourceRef = useRef(new VectorSource());
  const userSourceRef = useRef(new VectorSource());
  const bufferSourceRef = useRef(new VectorSource());
  const vehicleFeaturesRef = useRef(new globalThis.Map<string, Feature<Point>>());
  const vehicleStyleCacheRef = useRef(new globalThis.Map<string, Style>());

  const vehicleLayerRef = useRef<VectorLayer<any> | null>(null);
  const stopsLayerRef = useRef<VectorLayer<ClusterSource> | null>(null);
  const [stopViewportVersion, setStopViewportVersion] = useState(0);

  const [popup, setPopup] = useState<{
    type: "stop" | "bus";
    data: any;
  } | null>(null);

  // Memoize filtered + deduplicated stops
  const processedStops = useMemo(() => {
    const filtered = showSkolskjuts ? stops : stops.filter((s) => !isSkolskjuts(s.stop_name));
    return deduplicateStops(filtered);
  }, [stops, showSkolskjuts]);

  const visibleStops = useMemo(() => {
    const map = mapRef.current;
    const size = map?.getSize();

    if (!map || !size) {
      return processedStops;
    }

    const projectedExtent = map.getView().calculateExtent(size);
    const geographicExtent = transformExtent(projectedExtent, "EPSG:3857", "EPSG:4326") as [number, number, number, number];
    const paddedExtent = padExtent(geographicExtent, 0.25);

    return processedStops.filter((stop) => stopIsInExtent(stop, paddedExtent));
  }, [processedStops, stopViewportVersion]);

  const getVehicleStyle = useCallback((lineNumber: string, bearing: number, isToward?: boolean) => {
    const bearingBucket = ((Math.round(bearing / VEHICLE_ICON_BUCKET) * VEHICLE_ICON_BUCKET) % 360 + 360) % 360;
    const styleKey = `${lineNumber}|${bearingBucket}|${isToward ?? "unknown"}`;
    const cached = vehicleStyleCacheRef.current.get(styleKey);
    if (cached) {
      return { style: cached, styleKey };
    }

    const style = new Style({
      image: new Icon({
        img: createBusCanvas(lineNumber, bearingBucket, isToward),
        size: [64, 64],
        anchor: [0.5, 0.5],
      }),
    });

    vehicleStyleCacheRef.current.set(styleKey, style);
    return { style, styleKey };
  }, []);

  // Map initialization
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const stopsCluster = new ClusterSource({
      distance: 50,
      minDistance: 25,
      source: stopsRawSourceRef.current,
    });

    const stopsLayer = new VectorLayer({
      source: stopsCluster,
      style: (feature) => {
        const features = feature.get("features");
        const size = features?.length || 1;
        if (size > 1) {
          return new Style({
            image: new CircleStyle({
              radius: 14,
              fill: new Fill({ color: "rgba(59, 130, 246, 0.7)" }),
              stroke: new Stroke({ color: "#1e40af", width: 1.5 }),
            }),
            text: new Text({
              text: size.toString(),
              fill: new Fill({ color: "#ffffff" }),
              font: "bold 11px system-ui",
            }),
          });
        }
        return new Style({
          image: new CircleStyle({
            radius: 6,
            fill: new Fill({ color: "rgba(59, 130, 246, 0.6)" }),
            stroke: new Stroke({ color: "#1e40af", width: 1.5 }),
          }),
        });
      },
    });
    stopsLayerRef.current = stopsLayer;

    const vehicleCluster = new ClusterSource({
      distance: 35,
      source: vehicleSourceRef.current,
    });

    const vehicleLayer = new VectorLayer({
      source: vehicleCluster,
      zIndex: 10,
      style: (feature) => {
        const features = feature.get("features");
        if (!features) return undefined;
        if (features.length > 1) {
          return new Style({
            image: new CircleStyle({
              radius: 16,
              fill: new Fill({ color: "rgba(30, 41, 59, 0.85)" }),
              stroke: new Stroke({ color: "#ffffff", width: 2 }),
            }),
            text: new Text({
              text: features.length.toString(),
              fill: new Fill({ color: "#ffffff" }),
              font: "bold 12px system-ui",
            }),
          });
        }
        return features[0].getStyle() as Style;
      },
    });
    vehicleLayerRef.current = vehicleLayer;

    const bufferLayer = new VectorLayer({
      source: bufferSourceRef.current,
      zIndex: 1,
    });

    const userLayer = new VectorLayer({
      source: userSourceRef.current,
      zIndex: 20,
    });

    const overlay = new Overlay({
      element: popupEl,
      positioning: "bottom-center",
      offset: [0, -15],
      autoPan: { animation: { duration: 250 } },
    });
    overlayRef.current = overlay;

    const map = new Map({
      target: mapContainerRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        bufferLayer,
        stopsLayer,
        vehicleLayer,
        userLayer,
      ],
      overlays: [overlay],
      view: new View({
        center: fromLonLat([17.63, 59.86]),
        zoom: 13,
      }),
    });
    mapRef.current = map;
    onMapReady?.(map);
    setStopViewportVersion((value) => value + 1);

    map.on("singleclick", (e) => {
      let handled = false;

      map.forEachFeatureAtPixel(
        e.pixel,
        (feature) => {
          if (handled) return;
          const clusterFeatures = feature.get("features");
          if (!clusterFeatures) return;

          if (clusterFeatures.length > 1) {
            const extent = boundingExtent(
              clusterFeatures.map((f: Feature) =>
                (f.getGeometry() as Point).getCoordinates()
              )
            );
            map.getView().fit(extent, { padding: [80, 80, 80, 80], duration: 300 });
            handled = true;
          } else {
            const vf = clusterFeatures[0];
            if (vf.get("featureType") === "vehicle") {
              const props = vf.getProperties();
              delete props.geometry;
              setPopup({ type: "bus", data: props });
              overlay.setPosition(e.coordinate);
              onBusClick(props as any);
              handled = true;
            }
          }
        },
        { layerFilter: (l) => l === vehicleLayer }
      );

      if (!handled) {
        map.forEachFeatureAtPixel(
          e.pixel,
          (feature) => {
            if (handled) return;
            const features = feature.get("features");
            if (features) {
              if (features.length > 1) {
                const extent = boundingExtent(
                  features.map((f: Feature) =>
                    (f.getGeometry() as Point).getCoordinates()
                  )
                );
                map.getView().fit(extent, { padding: [80, 80, 80, 80], duration: 300 });
                handled = true;
              } else {
                const stopFeature = features[0];
                const props = stopFeature.getProperties();
                delete props.geometry;
                setPopup({ type: "stop", data: props });
                overlay.setPosition(e.coordinate);
                handled = true;
              }
            }
          },
          { layerFilter: (l) => l === stopsLayer }
        );
      }

      if (!handled) {
        setPopup(null);
        overlay.setPosition(undefined);
      }
    });

    const handleMoveEnd = () => setStopViewportVersion((value) => value + 1);
    map.on("moveend", handleMoveEnd);

    return () => {
      if (stopRenderFrameRef.current !== null) {
        cancelAnimationFrame(stopRenderFrameRef.current);
      }
      map.un("moveend", handleMoveEnd);
      map.setTarget(undefined);
    };
  }, []);

  // Update vehicles
  useEffect(() => {
    const source = vehicleSourceRef.current;
    const featureMap = vehicleFeaturesRef.current;
    const nextIds = new Set<string>();

    vehicles.forEach((v) => {
      const lineNumber = routeMap[v.routeId] || v.vehicleLabel || "?";

      let isToward: boolean | undefined;
      if (filteredStop) {
        isToward = bearingTowardStop(
          v.lat,
          v.lon,
          v.bearing,
          filteredStop.stop_lat,
          filteredStop.stop_lon
        );
      }

      const coordinate = fromLonLat([v.lon, v.lat]);
      let feature = featureMap.get(v.id);

      if (!feature) {
        feature = new Feature({
          geometry: new Point(coordinate),
        });
        featureMap.set(v.id, feature);
        source.addFeature(feature);
      } else {
        const geometry = feature.getGeometry();
        if (geometry) {
          geometry.setCoordinates(coordinate);
        } else {
          feature.setGeometry(new Point(coordinate));
        }
      }

      feature.setProperties(
        {
          featureType: "vehicle",
          lineNumber,
          ...v,
        },
        true
      );

      const { style, styleKey } = getVehicleStyle(lineNumber, v.bearing, isToward);
      if (feature.get("styleKey") !== styleKey) {
        feature.set("styleKey", styleKey, true);
        feature.setStyle(style);
      }

      nextIds.add(v.id);
    });

    for (const [vehicleId, feature] of featureMap.entries()) {
      if (!nextIds.has(vehicleId)) {
        source.removeFeature(feature);
        featureMap.delete(vehicleId);
      }
    }
  }, [vehicles, routeMap, filteredStop, getVehicleStyle]);

  // Update stops in chunks to avoid blocking main thread
  useEffect(() => {
    const source = stopsRawSourceRef.current;
    const renderToken = ++stopRenderTokenRef.current;

    if (stopRenderFrameRef.current !== null) {
      cancelAnimationFrame(stopRenderFrameRef.current);
      stopRenderFrameRef.current = null;
    }

    source.clear(true);

    if (visibleStops.length === 0) {
      return () => {
        stopRenderTokenRef.current++;
      };
    }

    const CHUNK = 120;
    let i = 0;

    function addChunk() {
      if (stopRenderTokenRef.current !== renderToken) return;

      const end = Math.min(i + CHUNK, visibleStops.length);
      const features: Feature[] = [];

      for (; i < end; i++) {
        const s = visibleStops[i];
        features.push(new Feature({
          geometry: new Point(fromLonLat([s.stop_lon, s.stop_lat])),
          featureType: "stop",
          ...s,
        }));
      }

      if (features.length > 0) {
        source.addFeatures(features);
      }

      if (i < visibleStops.length) {
        stopRenderFrameRef.current = requestAnimationFrame(addChunk);
      } else {
        stopRenderFrameRef.current = null;
      }
    }

    stopRenderFrameRef.current = requestAnimationFrame(addChunk);

    return () => {
      stopRenderTokenRef.current++;
      if (stopRenderFrameRef.current !== null) {
        cancelAnimationFrame(stopRenderFrameRef.current);
        stopRenderFrameRef.current = null;
      }
    };
  }, [visibleStops]);

  // Update user location + buffers
  useEffect(() => {
    userSourceRef.current.clear();
    bufferSourceRef.current.clear();

    if (!userLocation) return;
    const [lon, lat] = userLocation;

    const userFeature = new Feature({
      geometry: new Point(fromLonLat([lon, lat])),
    });
    userFeature.setStyle(
      new Style({
        image: new CircleStyle({
          radius: 8,
          fill: new Fill({ color: "rgba(37, 99, 235, 0.9)" }),
          stroke: new Stroke({ color: "#ffffff", width: 2.5 }),
        }),
      })
    );
    userSourceRef.current.addFeature(userFeature);

    const walkRadius = (walkSpeed / 3.6) * (bufferMinutes * 60);
    const walkCircle = circular([lon, lat], walkRadius, 64);
    walkCircle.transform("EPSG:4326", "EPSG:3857");
    const walkFeature = new Feature(walkCircle);
    walkFeature.setStyle(
      new Style({
        fill: new Fill({ color: "rgba(34, 197, 94, 0.08)" }),
        stroke: new Stroke({
          color: "rgba(34, 197, 94, 0.5)",
          width: 2,
          lineDash: [8, 4],
        }),
      })
    );
    bufferSourceRef.current.addFeature(walkFeature);

    const runRadius = (runSpeed / 3.6) * (bufferMinutes * 60);
    const runCircle = circular([lon, lat], runRadius, 64);
    runCircle.transform("EPSG:4326", "EPSG:3857");
    const runFeature = new Feature(runCircle);
    runFeature.setStyle(
      new Style({
        fill: new Fill({ color: "rgba(249, 115, 22, 0.06)" }),
        stroke: new Stroke({
          color: "rgba(249, 115, 22, 0.5)",
          width: 2,
          lineDash: [8, 4],
        }),
      })
    );
    bufferSourceRef.current.addFeature(runFeature);
  }, [userLocation, walkSpeed, runSpeed, bufferMinutes]);

  const popupContent = popup ? (
    <div className="bg-background rounded-lg shadow-lg border p-3 min-w-[200px] max-w-[280px] relative">
      {popup.type === "stop" ? (
        <div>
          <h3 className="font-semibold text-sm">{popup.data.stop_name}</h3>
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => {
                onStopClick(popup.data as TransitStop);
                setPopup(null);
                overlayRef.current?.setPosition(undefined);
              }}
            >
              Filter buses
            </Button>
            {onToggleFavorite && (
              <Button
                size="sm"
                variant={isFavorite?.(popup.data.stop_id) ? "default" : "outline"}
                onClick={() => {
                  onToggleFavorite(popup.data as TransitStop);
                }}
              >
                <Star
                  className={`h-4 w-4 ${isFavorite?.(popup.data.stop_id) ? "fill-current" : ""}`}
                />
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Suspense fallback={<div className="text-xs text-muted-foreground">Loading bus details...</div>}>
          <BusPopup
            vehicle={popup.data as Vehicle & { lineNumber: string }}
            userLocation={userLocation}
            walkSpeed={walkSpeed}
            runSpeed={runSpeed}
          />
        </Suspense>
      )}
      <button
        className="absolute top-1 right-2 text-muted-foreground hover:text-foreground text-lg leading-none"
        onClick={() => {
          setPopup(null);
          overlayRef.current?.setPosition(undefined);
        }}
      >
        ×
      </button>
    </div>
  ) : null;

  return (
    <>
      <div ref={mapContainerRef} className="w-full h-full" />
      {createPortal(popupContent, popupEl)}
    </>
  );
};

export default BusMap;
