import { useRef, useEffect, useCallback, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import { fromLonLat, toLonLat } from "ol/proj";
import { defaults as defaultControls } from "ol/control";
import { apply as applyMapboxStyle } from "ol-mapbox-style";
import { Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reverseGeocode } from "@/lib/placeSearch";
import "ol/ol.css";

interface MapLocationPickerProps {
  initialCenter?: [number, number]; // [lon, lat]
  onConfirm: (lat: number, lon: number, displayName: string) => void;
  onCancel: () => void;
  confirmLabel: string;
  cancelLabel: string;
}

const DEFAULT_CENTER: [number, number] = [17.63, 59.86];
const DEFAULT_ZOOM = 15;

export default function MapLocationPicker({
  initialCenter,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
}: MapLocationPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const center = initialCenter ?? DEFAULT_CENTER;
    const map = new Map({
      target: containerRef.current,
      controls: defaultControls({ zoom: false }),
      layers: [],
      view: new View({
        center: fromLonLat(center),
        zoom: DEFAULT_ZOOM,
      }),
    });
    applyMapboxStyle(map, "https://tiles.openfreemap.org/styles/bright").catch(
      (err: unknown) => console.warn("Vector tile style failed", err),
    );
    mapRef.current = map;

    return () => {
      map.setTarget(undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update center if initialCenter changes (e.g. switching to edit an existing place)
  useEffect(() => {
    if (!mapRef.current || !initialCenter) return;
    mapRef.current.getView().animate({
      center: fromLonLat(initialCenter),
      duration: 300,
    });
  }, [initialCenter]);

  const handleConfirm = useCallback(async () => {
    if (!mapRef.current) return;
    setConfirming(true);

    const center = mapRef.current.getView().getCenter();
    if (!center) {
      setConfirming(false);
      return;
    }

    const [lon, lat] = toLonLat(center);

    let displayName = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    try {
      const result = await reverseGeocode(lat, lon);
      if (result) {
        displayName = result.displayName;
      }
    } catch {
      // Keep coordinate-based name
    }

    setConfirming(false);
    onConfirm(lat, lon, displayName);
  }, [onConfirm]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full rounded-lg overflow-hidden border" style={{ height: "min(50dvh, 320px)" }}>
        <div ref={containerRef} className="w-full h-full" />
        {/* Fixed crosshair in centre */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Crosshair className="h-8 w-8 text-primary drop-shadow-md" strokeWidth={2.5} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" onClick={handleConfirm} disabled={confirming}>
          {confirming ? "..." : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
