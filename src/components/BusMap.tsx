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
import { fromLonLat, transformExtent } from "ol/proj";
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
import { createBusCanvas, bearingTowardStop } from "@/lib/busIcon";
import { Button } from "@/components/ui/button";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import StopPopup from "@/components/StopPopup";
import { buildStopGroups, findStopGroupForStop, type TransitStopGroup } from "@/lib/stopGroups";
import "ol/ol.css";

const BusPopup = lazy(() => import("@/components/BusPopup"));
const VEHICLE_ICON_BUCKET = 15;
const STOP_CLUSTER_DISTANCE = 34;
const CLUSTER_SPLIT_PIXEL_BUFFER = 8;

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
  runSpeed: number;
  bufferMinutes: number;
  filteredStop: TransitStopGroup | null;
  onStopClick: (stopGroup: TransitStopGroup) => void;
  onBusClick: (vehicle: Vehicle & { lineNumber: string }) => void;
  onMapReady?: (map: Map) => void;
  isFavorite?: (stopId: string) => boolean;
  onToggleFavorite?: (stop: TransitStop) => void;
  stopVisibilityZoom?: number;
  stopRoutes?: Record<string, string[]>;
  highlightedStop?: TransitStop | null;
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
  stopVisibilityZoom = 14,
  stopRoutes = {},
  highlightedStop = null,
}: BusMapProps) => {
  const { strings } = useAppPreferences();
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
      distance: STOP_CLUSTER_DISTANCE,
      source: stopsRawSourceRef.current,
    });

    const stopsLayer = new VectorLayer({
      source: stopsCluster,
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

    const overlay = new Overlay({
      element: popupEl,
      positioning: "bottom-center",
      offset: [0, -15],
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
              const busCoord = fromLonLat([props.lon, props.lat]);
              setPopup({ type: "bus", data: props });
              overlay.setPosition(busCoord);
              // Center the bus in the lower third of the map so the popup
              // (which extends upward) has room above.
              const mapSize = map.getSize();
              if (mapSize) {
                const targetPixel = [mapSize[0] / 2, mapSize[1] * 0.65];
                const busPixel = map.getPixelFromCoordinate(busCoord);
                if (busPixel) {
                  const currentCenter = map.getView().getCenter()!;
                  const centerPixel = map.getPixelFromCoordinate(currentCenter)!;
                  const newCenter = map.getCoordinateFromPixel([
                    centerPixel[0] + (busPixel[0] - targetPixel[0]),
                    centerPixel[1] + (busPixel[1] - targetPixel[1]),
                  ]);
                  if (newCenter) {
                    map.getView().animate({ center: newCenter, duration: 400 });
                  }
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
                  setPopup({ type: "stop", data: merged });
                  overlay.setPosition(e.coordinate);
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

            setPopup({ type: "stop", data: stopGroup });
            overlay.setPosition(e.coordinate);
            handled = true;
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

    if (visibleStopGroups.length === 0) {
      return () => {
        stopRenderTokenRef.current++;
      };
    }

    const CHUNK = 120;
    let i = 0;

    function addChunk() {
      if (stopRenderTokenRef.current !== renderToken) return;

      const end = Math.min(i + CHUNK, visibleStopGroups.length);
      const features: Feature[] = [];

      for (; i < end; i++) {
        const stopGroup = visibleStopGroups[i];
        features.push(new Feature({
          geometry: new Point(fromLonLat([stopGroup.stop_lon, stopGroup.stop_lat])),
          featureType: "stop",
          stopGroup,
          stopGroupSize: stopGroup.stops.length,
        }));
      }

      if (features.length > 0) {
        source.addFeatures(features);
      }

      if (i < visibleStopGroups.length) {
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

  useEffect(() => {
    if (!highlightedStop || !mapRef.current || !overlayRef.current) {
      return;
    }

    const highlightedGroup = findStopGroupForStop(highlightedStop, processedStopGroups);
    if (!highlightedGroup) {
      return;
    }

    const coordinate = fromLonLat([highlightedGroup.stop_lon, highlightedGroup.stop_lat]);
    setPopup({ type: "stop", data: highlightedGroup });
    overlayRef.current.setPosition(coordinate);
    mapRef.current.getView().animate({
      center: coordinate,
      zoom: Math.max(mapRef.current.getView().getZoom() ?? 13, 15),
      duration: 400,
    });
  }, [highlightedStop, processedStopGroups]);

  // Derive the live vehicle from the vehicles array when a bus popup is open.
  // popup.data stores the initial click data (with lineNumber); liveVehicle
  // always reflects the latest position without triggering popup state changes.
  const liveVehicle = useMemo(() => {
    if (!popup || popup.type !== "bus") return null;
    const orig = popup.data as Vehicle & { lineNumber: string };
    const updated = vehicles.find((veh) => veh.id === orig.id);
    if (!updated) return orig;
    return { ...updated, lineNumber: orig.lineNumber };
  }, [popup, vehicles]);

  // Track the live bus position: move overlay + shift map so popup stays stable.
  // Uses a ref to compare previous position, avoiding state updates entirely.
  const prevBusPosRef = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    if (!liveVehicle || !mapRef.current || !overlayRef.current) {
      prevBusPosRef.current = null;
      return;
    }

    const map = mapRef.current;
    const overlay = overlayRef.current;
    const newCoord = fromLonLat([liveVehicle.lon, liveVehicle.lat]);
    const prev = prevBusPosRef.current;

    if (prev && (prev.lat !== liveVehicle.lat || prev.lon !== liveVehicle.lon)) {
      const oldCoord = fromLonLat([prev.lon, prev.lat]);
      const oldPx = map.getPixelFromCoordinate(oldCoord);
      const newPx = map.getPixelFromCoordinate(newCoord);
      if (oldPx && newPx) {
        const dx = newPx[0] - oldPx[0];
        const dy = newPx[1] - oldPx[1];
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          const centerPx = map.getPixelFromCoordinate(map.getView().getCenter()!);
          if (centerPx) {
            const newCenter = map.getCoordinateFromPixel([centerPx[0] + dx, centerPx[1] + dy]);
            if (newCenter) map.getView().setCenter(newCenter);
          }
        }
      }
    }

    overlay.setPosition(newCoord);
    prevBusPosRef.current = { lat: liveVehicle.lat, lon: liveVehicle.lon };
  }, [liveVehicle?.lat, liveVehicle?.lon]);

  // After a popup opens, pan the map so the full popup is visible.
  // Uses ResizeObserver to re-pan when the popup grows (e.g. async data loads).
  // Depends on a stable key so it only runs when a NEW popup opens, not on
  // every liveVehicle position update.
  const popupKey = popup
    ? `${popup.type}-${popup.type === "bus" ? (popup.data as Vehicle).id : "stop"}`
    : null;
  useEffect(() => {
    if (!popup || !mapRef.current || !overlayRef.current) return;

    const map = mapRef.current;
    const overlay = overlayRef.current;
    const isBus = popup.type === "bus";

    function panToFitPopup() {
      const el = overlay.getElement();
      const anchorPos = overlay.getPosition();
      if (!el || !anchorPos) return;

      // Measure the actual content child, not the portal container
      const content = el.firstElementChild as HTMLElement | null;
      if (!content) return;

      const mapSize = map.getSize();
      if (!mapSize) return;

      const [mapW, mapH] = mapSize;

      const contentRect = content.getBoundingClientRect();
      const mapRect = map.getTargetElement()!.getBoundingClientRect();

      // Convert popup's viewport-relative rect to map-relative pixels
      const popupTop = contentRect.top - mapRect.top;
      const popupLeft = contentRect.left - mapRect.left;
      const popupRight = contentRect.right - mapRect.left;
      const popupBottom = contentRect.bottom - mapRect.top;

      const margin = 12;
      let dx = 0;
      let dy = 0;

      if (popupTop - margin < 0) dy = popupTop - margin;
      if (popupBottom + margin > mapH) dy = popupBottom + margin - mapH;
      if (popupLeft - margin < 0) dx = popupLeft - margin;
      if (popupRight + margin > mapW) dx = popupRight + margin - mapW;

      if (dx !== 0 || dy !== 0) {
        const currentCenter = map.getView().getCenter();
        if (!currentCenter) return;
        const currentPixel = map.getPixelFromCoordinate(currentCenter);
        if (!currentPixel) return;
        const newCenter = map.getCoordinateFromPixel([
          currentPixel[0] + dx,
          currentPixel[1] + dy,
        ]);
        if (newCenter) {
          // For bus popups use instant correction to avoid fighting the centering animation
          if (isBus) {
            map.getView().setCenter(newCenter);
          } else {
            map.getView().animate({ center: newCenter, duration: 250 });
          }
        }
      }
    }

    // Observe the portal container's subtree for size changes
    const el = overlay.getElement();
    if (!el) return;

    const observer = new ResizeObserver(() => panToFitPopup());
    // Observe the content child once it appears
    const content = el.firstElementChild as HTMLElement | null;
    if (content) {
      observer.observe(content);
    }
    // Also observe container in case child mounts later
    observer.observe(el);

    // For bus popups, delay initial pan to let centering animation finish
    const delay = isBus ? 450 : 0;
    let frameId: number | undefined;
    const timerId = window.setTimeout(() => {
      frameId = requestAnimationFrame(() => panToFitPopup());
    }, delay);

    return () => {
      window.clearTimeout(timerId);
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [popupKey]);

  const popupContent = popup ? (
    <div className="bg-background rounded-lg shadow-lg border p-3 min-w-[200px] max-w-[280px] relative">
      {popup.type === "stop" ? (
        <StopPopup
          stopGroup={popup.data as TransitStopGroup}
          stops={stops}
          vehicles={vehicles}
          routeMap={routeMap}
          stopRoutes={stopRoutes}
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
          onFilter={(selectedStopGroup) => {
            onStopClick(selectedStopGroup);
            setPopup(null);
            overlayRef.current?.setPosition(undefined);
          }}
        />
      ) : liveVehicle ? (
        <Suspense fallback={<div className="text-xs text-muted-foreground">{strings.loadingBusDetails}</div>}>
          <BusPopup
            vehicle={liveVehicle}
            userLocation={userLocation}
            walkSpeed={walkSpeed}
            runSpeed={runSpeed}
            stops={stops}
            routeMap={routeMap}
          />
        </Suspense>
      ) : null}
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
