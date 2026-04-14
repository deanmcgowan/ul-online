import { useRef, useEffect, useState, useCallback, useMemo, lazy, Suspense } from "react";
import Map from "ol/Map";
import View from "ol/View";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { apply as applyMapboxStyle } from "ol-mapbox-style";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { fromLonLat, toLonLat, transformExtent } from "ol/proj";
import {
  Style,
  Fill,
  Stroke,
  Text,
  Icon,
  Circle as CircleStyle,
} from "ol/style";
import type { TripDelay } from "@/hooks/useTripUpdates";
import BottomSheet from "@/components/BottomSheet";
import ClusterSource from "ol/source/Cluster";
import { circular } from "ol/geom/Polygon";
import { boundingExtent } from "ol/extent";
import { createBusArrowCanvas, createBusBodyCanvas, bearingTowardStop } from "@/lib/busIcon";
import { Button } from "@/components/ui/button";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import StopPopup from "@/components/StopPopup";
import { buildStopGroups, findStopGroupForStop, type TransitStopGroup } from "@/lib/stopGroups";
import type { SavedPlace, SavedPlaceKind } from "@/lib/savedPlaces";
import { defaults as defaultControls } from "ol/control";
import "ol/ol.css";

const BusPopup = lazy(() => import("@/components/BusPopup"));
const VEHICLE_ICON_BUCKET = 15;
const STOP_CLUSTER_DISTANCE = 34;
const CLUSTER_SPLIT_PIXEL_BUFFER = 8;
const MAP_VIEW_STORAGE_KEY = "ul-online-map-view";

const DEFAULT_CENTER: [number, number] = [17.63, 59.86];
const DEFAULT_ZOOM = 13;

function getSavedMapView(): { center: [number, number]; zoom: number } {
  try {
    const raw = localStorage.getItem(MAP_VIEW_STORAGE_KEY);
    if (raw) {
      const { center, zoom } = JSON.parse(raw);
      if (Array.isArray(center) && center.length === 2 && typeof zoom === "number") {
        return { center: center as [number, number], zoom };
      }
    }
  } catch { /* ignore */ }
  return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
}

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

function getClusterSplitZoom(features: Feature[], view: View): number | null {
  const currentZoom = view.getZoom();
  if (currentZoom === undefined) {
    return null;
  }

  const coordinates = features.map((feature) =>
    (feature.getGeometry() as Point).getCoordinates()
  );

  if (coordinates.length < 2) {
    return Math.min(view.getMaxZoom() ?? 20, currentZoom + 1);
  }

  let minimumPairDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const [leftX, leftY] = coordinates[index];

    for (let compareIndex = index + 1; compareIndex < coordinates.length; compareIndex += 1) {
      const [rightX, rightY] = coordinates[compareIndex];
      const distance = Math.hypot(rightX - leftX, rightY - leftY);

      if (distance > 0) {
        minimumPairDistance = Math.min(minimumPairDistance, distance);
      }
    }
  }

  if (!Number.isFinite(minimumPairDistance)) {
    return Math.min(view.getMaxZoom() ?? 20, currentZoom + 1);
  }

  const targetResolution = minimumPairDistance / (STOP_CLUSTER_DISTANCE + CLUSTER_SPLIT_PIXEL_BUFFER);
  const targetZoom = view.getZoomForResolution(targetResolution);

  if (!Number.isFinite(targetZoom)) {
    return Math.min(view.getMaxZoom() ?? 20, currentZoom + 1);
  }

  return Math.min(view.getMaxZoom() ?? 20, Math.max(currentZoom + 1, targetZoom + 0.5));
}

export interface Vehicle {
  id: string;
  tripId: string;
  routeId: string;
  directionId: number;
  currentStatus: "INCOMING_AT" | "STOPPED_AT" | "IN_TRANSIT_TO" | "";
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
  bufferMinutes: number;
  maxWalkDistanceMeters: number;
  filteredStop: TransitStopGroup | null;
  onStopClick: (stopGroup: TransitStopGroup) => void;
  onBusClick: (vehicle: Vehicle & { lineNumber: string }) => void;
  onMapReady?: (map: Map) => void;
  isFavorite?: (stopId: string) => boolean;
  onToggleFavorite?: (stop: TransitStop) => void;
  stopVisibilityZoom?: number;
  stopRoutes?: Record<string, string[]>;
  highlightedStop?: TransitStop | null;
  tripDelayMap?: Map<string, TripDelay>;
  savedPlaces?: SavedPlace[];
  lastRefresh?: number;
  refreshIntervalMs?: number;
}

const BusMap = ({
  vehicles,
  stops,
  routeMap,
  userLocation,
  walkSpeed,
  bufferMinutes,
  maxWalkDistanceMeters,
  filteredStop,
  onStopClick,
  onBusClick,
  onMapReady,
  isFavorite,
  onToggleFavorite,
  stopVisibilityZoom = 12,
  stopRoutes = {},
  highlightedStop = null,
  tripDelayMap,
  savedPlaces = [],
  lastRefresh,
  refreshIntervalMs,
}: BusMapProps) => {
  const { strings } = useAppPreferences();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const vehicleSourceRef = useRef(new VectorSource());
  const stopsRawSourceRef = useRef(new VectorSource());
  const userSourceRef = useRef(new VectorSource());
  const bufferSourceRef = useRef(new VectorSource());
  const savedPlacesSourceRef = useRef(new VectorSource());
  const vehicleFeaturesRef = useRef(new globalThis.Map<string, Feature<Point>>());
  const vehicleStyleCacheRef = useRef(new globalThis.Map<string, Style[]>());

  const vehicleLayerRef = useRef<VectorLayer<any> | null>(null);
  const stopsLayerRef = useRef<VectorLayer<ClusterSource> | null>(null);
  const [stopViewportVersion, setStopViewportVersion] = useState(0);

  const [popup, setPopup] = useState<{
    type: "stop" | "bus";
    data: any;
  } | null>(null);
  const [isTrackingBus, setIsTrackingBus] = useState(true);
  const isAnimatingRef = useRef(false);
  const closePopupRef = useRef<() => void>(() => {});

  // Build a set of known route short names so we can recognise when a raw RT
  // routeId already IS the display-ready short name (e.g. "2" for bus 2).
  const knownShortNames = useMemo(() => new Set(Object.values(routeMap)), [routeMap]);

  // Memoize filtered + deduplicated stops
  const processedStopGroups = useMemo(() => {
    return buildStopGroups(stops, stopRoutes);
  }, [stops, stopRoutes]);

  const visibleStopGroups = useMemo(() => {
    const map = mapRef.current;
    const size = map?.getSize();

    if (!map || !size) {
      return [];
    }

    const currentZoom = map.getView().getZoom() ?? 0;
    if (currentZoom < stopVisibilityZoom) {
      return [];
    }

    const projectedExtent = map.getView().calculateExtent(size);
    const geographicExtent = transformExtent(projectedExtent, "EPSG:3857", "EPSG:4326") as [number, number, number, number];
    const paddedExtent = padExtent(geographicExtent, 0.25);

    return processedStopGroups.filter((stopGroup) => stopIsInExtent(stopGroup, paddedExtent));
  }, [processedStopGroups, stopViewportVersion, stopVisibilityZoom]);

  const getVehicleStyle = useCallback((lineNumber: string, bearing: number, isToward?: boolean, speed?: number) => {
    const bearingBucket = ((Math.round(bearing / VEHICLE_ICON_BUCKET) * VEHICLE_ICON_BUCKET) % 360 + 360) % 360;
    const speedKey = speed !== undefined ? (speed > 0.5 ? "D" : "S") : "U";
    const styleKey = `${lineNumber}|${bearingBucket}|${isToward ?? "unknown"}|${speedKey}`;
    const cached = vehicleStyleCacheRef.current.get(styleKey);
    if (cached) {
      return { style: cached, styleKey };
    }

    try {
      const style: Style[] = [
        // Arrow layer: rotates with the map so it always points geographically correct
        new Style({
          image: new Icon({
            img: createBusArrowCanvas(bearingBucket, isToward),
            size: [64, 64],
            anchor: [0.5, 0.5],
            rotateWithView: true,
          }),
        }),
        // Body layer: screen-fixed so line numbers are always readable
        new Style({
          image: new Icon({
            img: createBusBodyCanvas(lineNumber, speed),
            size: [64, 64],
            anchor: [0.5, 0.5],
          }),
        }),
      ];

      vehicleStyleCacheRef.current.set(styleKey, style);
      return { style, styleKey };
    } catch (err) {
      console.warn("Failed to create vehicle style for", lineNumber, err);
      // Fallback: text-only style so the bus is still visible on the map
      const fallbackStyle: Style[] = [
        new Style({
          image: new CircleStyle({
            radius: 12,
            fill: new Fill({ color: "#1e293b" }),
            stroke: new Stroke({ color: "#ffffff", width: 1.5 }),
          }),
          text: new Text({
            text: lineNumber,
            fill: new Fill({ color: "#ffffff" }),
            font: "bold 10px system-ui",
          }),
        }),
      ];
      vehicleStyleCacheRef.current.set(styleKey, fallbackStyle);
      return { style: fallbackStyle, styleKey };
    }
  }, []);

  // Map initialization
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const stopsCluster = new ClusterSource({
      distance: STOP_CLUSTER_DISTANCE,
      source: stopsRawSourceRef.current,
    });

    const stopsLayer = new VectorLayer({
      source: stopsCluster,
      zIndex: 5,
      style: (feature) => {
        const clusteredFeatures = feature.get("features") as Feature[] | undefined;
        const clusterSize = clusteredFeatures?.length ?? 1;

        if (clusterSize > 1) {
          return new Style({
            image: new CircleStyle({
              radius: 14,
              fill: new Fill({ color: "rgba(59, 130, 246, 0.72)" }),
              stroke: new Stroke({ color: "#1e40af", width: 1.5 }),
            }),
            text: new Text({
              text: clusterSize.toString(),
              fill: new Fill({ color: "#ffffff" }),
              font: "bold 11px system-ui",
            }),
          });
        }

        return new Style({
          image: new CircleStyle({
            radius: 7,
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

    const savedPlacesLayer = new VectorLayer({
      source: savedPlacesSourceRef.current,
      zIndex: 15,
    });

    const savedView = getSavedMapView();
    const map = new Map({
      target: mapContainerRef.current,
      controls: defaultControls({ zoom: false }),
      layers: [
        bufferLayer,
        stopsLayer,
        savedPlacesLayer,
        vehicleLayer,
        userLayer,
      ],
      view: new View({
        center: fromLonLat(savedView.center),
        zoom: savedView.zoom,
      }),
    });
    mapRef.current = map;

    // Apply OpenFreeMap vector tile base map (labels stay upright when rotated)
    // Helper: ensure all base map layers have zIndex 0 so they render below
    // user layers (stops z:5, vehicles z:10, etc.).
    const enforceBaseLayerZIndex = () => {
      map.getLayers().getArray().forEach((layer) => {
        if (layer.getZIndex() === undefined) {
          layer.setZIndex(0);
        }
      });
    };

    applyMapboxStyle(map, "https://tiles.openfreemap.org/styles/bright")
      .then(() => {
        enforceBaseLayerZIndex();
        // Re-check after a short delay — some tile style resources (sprites,
        // fonts) load asynchronously and may cause new layers to be appended
        // after the Promise resolves.
        const BASE_LAYER_RECHECK_MS = 500;
        setTimeout(enforceBaseLayerZIndex, BASE_LAYER_RECHECK_MS);
      })
      .catch(
        (err: unknown) => console.warn("Vector tile style failed, map will have no base layer", err),
      );

    // Also enforce whenever layers change (new layers added later by tile style updates).
    map.getLayers().on("add", () => {
      enforceBaseLayerZIndex();
    });

    onMapReady?.(map);
    setStopViewportVersion((value) => value + 1);

    map.on("moveend", () => {
      const view = map.getView();
      const center = view.getCenter();
      const zoom = view.getZoom();
      if (center && zoom !== undefined) {
        const lonLat = toLonLat(center);
        localStorage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify({
          center: [lonLat[0], lonLat[1]],
          zoom,
        }));
      }
    });

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
              const busCoord = fromLonLat([props.lon, props.lat]);
              setPopup({ type: "bus", data: props });
              setIsTrackingBus(true);
              // Center the bus away from the panel, zoom in if stops aren't visible
              const mapSize = map.getSize();
              if (mapSize) {
                const currentZoom = map.getView().getZoom() ?? 13;
                const needsZoom = currentZoom < stopVisibilityZoom;
                const targetZoom = needsZoom ? stopVisibilityZoom : currentZoom;
                const isWide = mapSize[0] >= 768;
                const targetPixel = isWide
                  ? [(mapSize[0] + 352) / 2, mapSize[1] / 2]  // offset right for 22rem left panel
                  : [mapSize[0] / 2, mapSize[1] * 0.35];      // offset up for bottom sheet
                const busRotation = -((props.bearing ?? 0) * Math.PI) / 180;

                if (needsZoom) {
                  // Zoom + center in one animation, then adjust for panel offset
                  map.getView().animate(
                    { center: busCoord, zoom: targetZoom, rotation: busRotation, duration: 400 },
                    () => {
                      const busPixelAfter = map.getPixelFromCoordinate(busCoord);
                      const centerAfter = map.getView().getCenter();
                      if (busPixelAfter && centerAfter) {
                        const centerPixelAfter = map.getPixelFromCoordinate(centerAfter);
                        if (centerPixelAfter) {
                          const offsetCenter = map.getCoordinateFromPixel([
                            centerPixelAfter[0] + (busPixelAfter[0] - targetPixel[0]),
                            centerPixelAfter[1] + (busPixelAfter[1] - targetPixel[1]),
                          ]);
                          if (offsetCenter) {
                            map.getView().animate({ center: offsetCenter, duration: 200 });
                          }
                        }
                      }
                    },
                  );
                } else {
                  // Two-step: center + rotate first, then adjust for panel offset
                  map.getView().animate(
                    { center: busCoord, rotation: busRotation, duration: 400 },
                    () => {
                      const busPixelAfter = map.getPixelFromCoordinate(busCoord);
                      const centerAfter = map.getView().getCenter();
                      if (busPixelAfter && centerAfter) {
                        const centerPixelAfter = map.getPixelFromCoordinate(centerAfter);
                        if (centerPixelAfter) {
                          const offsetCenter = map.getCoordinateFromPixel([
                            centerPixelAfter[0] + (busPixelAfter[0] - targetPixel[0]),
                            centerPixelAfter[1] + (busPixelAfter[1] - targetPixel[1]),
                          ]);
                          if (offsetCenter) {
                            map.getView().animate({ center: offsetCenter, duration: 200 });
                          }
                        }
                      }
                    },
                  );
                }
              }
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
            const clusteredFeatures = feature.get("features") as Feature[] | undefined;
            if (!clusteredFeatures || clusteredFeatures.length === 0) {
              return;
            }

            if (clusteredFeatures.length > 1) {
              // Check if all features are co-located (identical coordinates, can't be split)
              const coords = clusteredFeatures.map((f) => (f.getGeometry() as Point).getCoordinates());
              const allColocated = coords.every(
                (c) => Math.abs(c[0] - coords[0][0]) < 1 && Math.abs(c[1] - coords[0][1]) < 1
              );

              if (allColocated) {
                // Merge co-located stop groups into one combined group
                const allStops: TransitStop[] = [];
                const allRouteIds = new Set<string>();
                let groupName = "";
                for (const f of clusteredFeatures) {
                  const sg = f.get("stopGroup") as TransitStopGroup | undefined;
                  if (sg) {
                    if (!groupName) groupName = sg.stop_name;
                    allStops.push(...sg.stops);
                    sg.routeIds.forEach((r) => allRouteIds.add(r));
                  }
                }
                if (allStops.length > 0) {
                  const merged: TransitStopGroup = {
                    group_id: allStops.map((s) => s.stop_id).join("|"),
                    stop_name: groupName,
                    stop_lat: allStops[0].stop_lat,
                    stop_lon: allStops[0].stop_lon,
                    stops: allStops,
                    routeIds: Array.from(allRouteIds).sort(),
                  };
                  if (Math.abs(map.getView().getRotation()) > 0.01) {
                    isAnimatingRef.current = true;
                    map.getView().animate({ rotation: 0, duration: 300 }, () => { isAnimatingRef.current = false; });
                  }
                  setPopup({ type: "stop", data: merged });
                  handled = true;
                  return;
                }
              }

              const targetZoom = getClusterSplitZoom(clusteredFeatures, map.getView());

              if (targetZoom !== null) {
                map.getView().animate({
                  center: e.coordinate,
                  zoom: targetZoom,
                  duration: 300,
                });
              }

              handled = true;
              return;
            }

            const stopGroup = clusteredFeatures[0].get("stopGroup") as TransitStopGroup | undefined;
            if (!stopGroup) {
              return;
            }

            if (Math.abs(map.getView().getRotation()) > 0.01) {
              isAnimatingRef.current = true;
              map.getView().animate({ rotation: 0, duration: 300 }, () => { isAnimatingRef.current = false; });
            }
            setPopup({ type: "stop", data: stopGroup });
            handled = true;
          },
          { layerFilter: (l) => l === stopsLayer }
        );
      }

      if (!handled) {
        closePopupRef.current();
      }
    });

    const handleMoveEnd = () => setStopViewportVersion((value) => value + 1);
    map.on("moveend", handleMoveEnd);

    // Detect any user-initiated map interaction to stop auto-tracking
    const handleUserInteraction = () => {
      if (!isAnimatingRef.current) {
        setIsTrackingBus(false);
      }
    };
    map.on("pointerdrag", handleUserInteraction);
    map.on("movestart", handleUserInteraction);

    return () => {
      map.un("moveend", handleMoveEnd);
      map.un("pointerdrag", handleUserInteraction);
      map.un("movestart", handleUserInteraction);
      map.setTarget(undefined);
    };
  }, []);

  // Update vehicles
  useEffect(() => {
    const source = vehicleSourceRef.current;
    const featureMap = vehicleFeaturesRef.current;
    const nextIds = new Set<string>();

    vehicles.forEach((v) => {
      // Primary: routeMap from static data. Fallback: use routeId from trip updates (same RT feed).
      // If the RT routeId already IS a known short name (e.g. "2"), use it directly.
      const tripDelayRouteId = tripDelayMap?.get(v.tripId)?.routeId;
      const lineNumber =
        routeMap[v.routeId] ||
        (v.routeId && knownShortNames.has(v.routeId) ? v.routeId : "") ||
        (tripDelayRouteId ? routeMap[tripDelayRouteId] : "") ||
        (tripDelayRouteId && knownShortNames.has(tripDelayRouteId) ? tripDelayRouteId : "") ||
        v.vehicleLabel ||
        "?";

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

      const { style, styleKey } = getVehicleStyle(lineNumber, v.bearing, isToward, v.speed);
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
  }, [vehicles, routeMap, knownShortNames, filteredStop, getVehicleStyle, tripDelayMap]);

  // Update stops — rebuild features when the visible set changes
  useEffect(() => {
    const source = stopsRawSourceRef.current;

    // Use clear() (not clear(true)) so the ClusterSource is notified
    // via the 'change' event and recalculates clusters correctly.
    source.clear();

    if (visibleStopGroups.length === 0) {
      return;
    }

    // Build all features synchronously and add in one batch so the
    // ClusterSource receives a single change notification.
    const features: Feature[] = visibleStopGroups.map((stopGroup) =>
      new Feature({
        geometry: new Point(fromLonLat([stopGroup.stop_lon, stopGroup.stop_lat])),
        featureType: "stop",
        stopGroup,
        stopGroupSize: stopGroup.stops.length,
      }),
    );

    source.addFeatures(features);
  }, [visibleStopGroups]);

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
  }, [userLocation, walkSpeed, bufferMinutes]);

  // Update saved-place markers
  useEffect(() => {
    const source = savedPlacesSourceRef.current;
    source.clear(true);

    if (savedPlaces.length === 0) return;

    const kindEmoji: Record<SavedPlaceKind, string> = {
      home: "\u{1F3E0}",
      work: "\u{1F4BC}",
      school: "\u{1F393}",
      other: "\u{2B50}",
    };

    const features = savedPlaces.map((place) => {
      const feature = new Feature({
        geometry: new Point(fromLonLat([place.lon, place.lat])),
        featureType: "savedPlace",
        placeId: place.id,
        placeKind: place.kind,
        placeLabel: place.label,
      });

      feature.setStyle(
        new Style({
          text: new Text({
            text: kindEmoji[place.kind] ?? "\u{2B50}",
            font: "22px sans-serif",
            offsetY: -2,
            textAlign: "center",
            textBaseline: "middle",
          }),
          image: new CircleStyle({
            radius: 16,
            fill: new Fill({ color: "rgba(255, 255, 255, 0.85)" }),
            stroke: new Stroke({ color: "rgba(100, 116, 139, 0.7)", width: 1.5 }),
          }),
        }),
      );

      return feature;
    });

    source.addFeatures(features);
  }, [savedPlaces]);

  useEffect(() => {
    if (!highlightedStop || !mapRef.current) {
      return;
    }

    const highlightedGroup = findStopGroupForStop(highlightedStop, processedStopGroups);
    if (!highlightedGroup) {
      return;
    }

    const coordinate = fromLonLat([highlightedGroup.stop_lon, highlightedGroup.stop_lat]);
    setPopup({ type: "stop", data: highlightedGroup });
    mapRef.current.getView().animate({
      center: coordinate,
      zoom: Math.max(mapRef.current.getView().getZoom() ?? 13, 15),
      rotation: 0,
      duration: 400,
    });
  }, [highlightedStop, processedStopGroups]);

  // Derive the live vehicle from the vehicles array when a bus popup is open.
  // popup.data stores the initial click data (with lineNumber); liveVehicle
  // always reflects the latest position without triggering popup state changes.
  // Match by tripId (most stable in GTFS-RT), then vehicleId, then entity id.
  const liveVehicle = useMemo(() => {
    if (!popup || popup.type !== "bus") return null;
    const orig = popup.data as Vehicle & { lineNumber: string };
    const updated =
      vehicles.find((veh) => veh.tripId && veh.tripId === orig.tripId) ??
      vehicles.find((veh) => veh.vehicleId && veh.vehicleId === orig.vehicleId) ??
      vehicles.find((veh) => veh.id === orig.id);
    if (!updated) return orig;
    return { ...updated, lineNumber: orig.lineNumber };
  }, [popup, vehicles]);

  // Track the live bus position: smoothly center the map so the bus stays
  // visible away from the panel. Only when isTrackingBus is true.
  useEffect(() => {
    if (!liveVehicle || !mapRef.current || !isTrackingBus) return;

    const map = mapRef.current;
    const coord = fromLonLat([liveVehicle.lon, liveVehicle.lat]);
    const mapSize = map.getSize();
    if (!mapSize) return;

    const isWide = mapSize[0] >= 768;
    const targetPixel = isWide
      ? [(mapSize[0] + 352) / 2, mapSize[1] / 2]
      : [mapSize[0] / 2, mapSize[1] * 0.35];
    const busPixel = map.getPixelFromCoordinate(coord);
    if (!busPixel) return;

    const currentCenter = map.getView().getCenter();
    if (!currentCenter) return;
    const centerPixel = map.getPixelFromCoordinate(currentCenter);
    if (!centerPixel) return;

    const dx = busPixel[0] - targetPixel[0];
    const dy = busPixel[1] - targetPixel[1];

    const targetRotation = -((liveVehicle.bearing ?? 0) * Math.PI) / 180;
    const currentRotation = map.getView().getRotation();
    const rotationDiff = Math.abs(targetRotation - currentRotation);

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || rotationDiff > 0.01) {
      const newCenter = map.getCoordinateFromPixel([centerPixel[0] + dx, centerPixel[1] + dy]);
      if (newCenter) {
        isAnimatingRef.current = true;
        map.getView().animate({ center: newCenter, rotation: targetRotation, duration: 500 }, () => {
          isAnimatingRef.current = false;
        });
      }
    }
  }, [liveVehicle?.lat, liveVehicle?.lon, liveVehicle?.bearing, isTrackingBus]);

  const closePopup = useCallback(() => {
    const busCoord = liveVehicle
      ? fromLonLat([liveVehicle.lon, liveVehicle.lat])
      : null;
    setPopup(null);
    setIsTrackingBus(true);
    // Animate back to north-up, re-center on the bus's last position
    if (mapRef.current) {
      isAnimatingRef.current = true;
      mapRef.current.getView().animate(
        { rotation: 0, ...(busCoord ? { center: busCoord } : {}), duration: 400 },
        () => { isAnimatingRef.current = false; },
      );
    }
  }, [liveVehicle]);
  closePopupRef.current = closePopup;

  const handleRecenterBus = useCallback(() => {
    if (!liveVehicle || !mapRef.current) return;
    const map = mapRef.current;
    const coord = fromLonLat([liveVehicle.lon, liveVehicle.lat]);
    const mapSize = map.getSize();
    if (!mapSize) return;

    const currentZoom = map.getView().getZoom() ?? 13;
    const needsZoom = currentZoom < stopVisibilityZoom;
    const targetZoom = needsZoom ? stopVisibilityZoom : currentZoom;
    const isWide = mapSize[0] >= 768;
    const targetPixel = isWide
      ? [(mapSize[0] + 352) / 2, mapSize[1] / 2]
      : [mapSize[0] / 2, mapSize[1] * 0.35];

    setIsTrackingBus(true);
    const recenterRotation = -((liveVehicle.bearing ?? 0) * Math.PI) / 180;

    if (needsZoom) {
      isAnimatingRef.current = true;
      map.getView().animate(
        { center: coord, zoom: targetZoom, rotation: recenterRotation, duration: 400 },
        () => {
          const busPixelAfter = map.getPixelFromCoordinate(coord);
          const centerAfter = map.getView().getCenter();
          if (busPixelAfter && centerAfter) {
            const centerPixelAfter = map.getPixelFromCoordinate(centerAfter);
            if (centerPixelAfter) {
              const offsetCenter = map.getCoordinateFromPixel([
                centerPixelAfter[0] + (busPixelAfter[0] - targetPixel[0]),
                centerPixelAfter[1] + (busPixelAfter[1] - targetPixel[1]),
              ]);
              if (offsetCenter) {
                map.getView().animate({ center: offsetCenter, duration: 200 }, () => {
                  isAnimatingRef.current = false;
                });
                return;
              }
            }
          }
          isAnimatingRef.current = false;
        },
      );
    } else {
      // Two-step: center + rotate first, then adjust for panel offset
      isAnimatingRef.current = true;
      map.getView().animate(
        { center: coord, rotation: recenterRotation, duration: 400 },
        () => {
          const busPixelAfter = map.getPixelFromCoordinate(coord);
          const centerAfter = map.getView().getCenter();
          if (busPixelAfter && centerAfter) {
            const centerPixelAfter = map.getPixelFromCoordinate(centerAfter);
            if (centerPixelAfter) {
              const offsetCenter = map.getCoordinateFromPixel([
                centerPixelAfter[0] + (busPixelAfter[0] - targetPixel[0]),
                centerPixelAfter[1] + (busPixelAfter[1] - targetPixel[1]),
              ]);
              if (offsetCenter) {
                map.getView().animate({ center: offsetCenter, duration: 200 }, () => {
                  isAnimatingRef.current = false;
                });
                return;
              }
            }
          }
          isAnimatingRef.current = false;
        },
      );
    }
  }, [liveVehicle, stopVisibilityZoom]);

  return (
    <>
      <div ref={mapContainerRef} className="w-full h-full" />
      <BottomSheet open={popup !== null} onClose={closePopup}>
        {popup?.type === "stop" ? (
          <StopPopup
            stopGroup={popup.data as TransitStopGroup}
            stops={stops}
            vehicles={vehicles}
            routeMap={routeMap}
            stopRoutes={stopRoutes}
            userLocation={userLocation}
            walkSpeed={walkSpeed}
            maxWalkDistanceMeters={maxWalkDistanceMeters}
            isFavorite={isFavorite}
            onToggleFavorite={onToggleFavorite}
            lastRefresh={lastRefresh}
            refreshIntervalMs={refreshIntervalMs}
            onFilter={(selectedStopGroup) => {
              onStopClick(selectedStopGroup);
              setPopup(null);
            }}
          />
        ) : liveVehicle ? (
          <Suspense fallback={<div className="text-xs text-muted-foreground">{strings.loadingBusDetails}</div>}>
            <BusPopup
              vehicle={liveVehicle}
              userLocation={userLocation}
              stops={stops}
              routeMap={routeMap}
              tripDelay={tripDelayMap?.get(liveVehicle.tripId) ?? null}
              isTracking={isTrackingBus}
              onRecenter={handleRecenterBus}
              lastRefresh={lastRefresh}
              refreshIntervalMs={refreshIntervalMs}
            />
          </Suspense>
        ) : null}
      </BottomSheet>
    </>
  );
};

export default BusMap;
