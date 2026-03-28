import { useEffect, useMemo, useState } from "react";
import { Briefcase, Home, Loader2, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAppPreferences } from "@/contexts/AppPreferencesContext";
import { useSavedPlaces } from "@/hooks/useSavedPlaces";
import { reverseGeocode, searchPlaces, type PlaceSearchResult } from "@/lib/placeSearch";
import { getDefaultPlaceLabel, type SavedPlace, type SavedPlaceDraft, type SavedPlaceKind } from "@/lib/savedPlaces";

function getPlaceIcon(kind: SavedPlaceKind) {
  switch (kind) {
    case "home":
      return Home;
    case "work":
      return Briefcase;
    default:
      return MapPin;
  }
}

function getKindLabel(kind: SavedPlaceKind, strings: ReturnType<typeof useAppPreferences>["strings"]) {
  switch (kind) {
    case "home":
      return strings.homePlace;
    case "work":
      return strings.workPlace;
    default:
      return strings.otherPlace;
  }
}

function getCurrentLocation(): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve([position.coords.latitude, position.coords.longitude]),
      (error) => reject(error),
      {
        enableHighAccuracy: true,
        timeout: 20000,
      },
    );
  });
}

export default function SavedPlacesManager() {
  const { strings } = useAppPreferences();
  const { savedPlaces, upsertPlace, removePlace, getPlaceByKind } = useSavedPlaces();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [draft, setDraft] = useState<SavedPlaceDraft | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<PlaceSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const primaryKinds = useMemo(() => ["home", "work"] as const, []);

  useEffect(() => {
    if (!isDialogOpen) {
      return;
    }

    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);

      try {
        const nextResults = await searchPlaces(trimmedQuery, controller.signal);
        setSearchResults(nextResults);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("Place search failed", error);
          setSearchError(strings.placeSearchError);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [isDialogOpen, searchQuery, strings.placeSearchError]);

  const openEditor = (kind: SavedPlaceKind, existing?: SavedPlace | null) => {
    const label = existing?.label || getDefaultPlaceLabel(kind);
    setDraft({
      id: existing?.id,
      kind,
      label,
      displayName: existing?.displayName || "",
      lat: existing?.lat || 0,
      lon: existing?.lon || 0,
    });
    setSearchQuery(existing?.displayName || "");
    setSearchResults([]);
    setSelectedResult(
      existing
        ? {
            id: existing.id,
            label: existing.label,
            displayName: existing.displayName,
            lat: existing.lat,
            lon: existing.lon,
          }
        : null,
    );
    setSearchError(null);
    setIsDialogOpen(true);
  };

  const handleSelectResult = (result: PlaceSearchResult) => {
    setSelectedResult(result);
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        displayName: result.displayName,
        lat: result.lat,
        lon: result.lon,
        label: current.label.trim() ? current.label : result.label,
      };
    });
  };

  const handleUseCurrentLocation = async () => {
    setIsLocating(true);
    setSearchError(null);

    try {
      const [lat, lon] = await getCurrentLocation();
      const result = await reverseGeocode(lat, lon);
      const fallbackResult: PlaceSearchResult = result ?? {
        id: crypto.randomUUID(),
        label: strings.currentLocationLabel,
        displayName: strings.currentLocationLabel,
        lat,
        lon,
      };

      handleSelectResult(fallbackResult);
      setSearchQuery(fallbackResult.displayName);
      setSearchResults([]);
    } catch (error) {
      console.warn("Current location lookup failed", error);
      setSearchError(strings.currentLocationError);
    } finally {
      setIsLocating(false);
    }
  };

  const handleSave = () => {
    if (!draft || !selectedResult) {
      return;
    }

    upsertPlace({
      id: draft.id,
      kind: draft.kind,
      label: draft.label,
      displayName: selectedResult.displayName,
      lat: selectedResult.lat,
      lon: selectedResult.lon,
    });
    setIsDialogOpen(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-3 block text-sm font-medium">{strings.savedPlaces}</label>
        <p className="mb-4 text-xs text-muted-foreground">{strings.savedPlacesDescription}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {primaryKinds.map((kind) => {
          const place = getPlaceByKind(kind);
          const Icon = getPlaceIcon(kind);

          return (
            <div key={kind} className="rounded-xl border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">{getKindLabel(kind, strings)}</p>
                  </div>
                  {place ? (
                    <>
                      <p className="mt-2 truncate text-sm font-semibold">{place.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{place.displayName}</p>
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">{strings.savedPlaceMissing}</p>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => openEditor(kind, place)}>
                  {place ? strings.editPlace : strings.setPlace}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{strings.otherPlaces}</p>
            <p className="text-xs text-muted-foreground">{strings.otherPlacesDescription}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => openEditor("other", null)}>
            <Plus className="mr-1 h-4 w-4" />
            {strings.addPlace}
          </Button>
        </div>

        {savedPlaces.filter((place) => place.kind === "other").length > 0 ? (
          <div className="space-y-2">
            {savedPlaces
              .filter((place) => place.kind === "other")
              .map((place) => (
                <div key={place.id} className="flex items-start justify-between gap-3 rounded-lg border bg-background/60 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{place.label}</p>
                    <p className="text-xs text-muted-foreground">{place.displayName}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditor("other", place)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removePlace(place.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-background/40 px-4 py-4 text-sm text-muted-foreground">
            {strings.noOtherPlaces}
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft ? strings.editSavedPlace(getKindLabel(draft.kind, strings)) : strings.savedPlaces}</DialogTitle>
            <DialogDescription>{strings.savedPlaceDialogDescription}</DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{strings.placeLabel}</label>
                <Input
                  value={draft.label}
                  onChange={(event) => setDraft((current) => current ? { ...current, label: event.target.value } : current)}
                  placeholder={getDefaultPlaceLabel(draft.kind)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{strings.placeSearchLabel}</label>
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={strings.placeSearchPlaceholder}
                />
              </div>

              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={handleUseCurrentLocation} disabled={isLocating}>
                  {isLocating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}
                  {strings.useCurrentLocation}
                </Button>
                {selectedResult && <Badge variant="secondary">{strings.placeSelected}</Badge>}
              </div>

              {searchError && <p className="text-sm text-destructive">{searchError}</p>}

              {isSearching ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {strings.searchingPlaces}
                </div>
              ) : searchResults.length > 0 ? (
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      className="w-full rounded-md border bg-background px-3 py-2 text-left transition-colors hover:bg-accent"
                      onClick={() => handleSelectResult(result)}
                    >
                      <p className="text-sm font-medium">{result.label}</p>
                      <p className="text-xs text-muted-foreground">{result.displayName}</p>
                    </button>
                  ))}
                </div>
              ) : searchQuery.trim().length >= 2 ? (
                <p className="text-sm text-muted-foreground">{strings.noPlaceSearchResults}</p>
              ) : null}

              {selectedResult && (
                <div className="rounded-xl border bg-muted/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{strings.selectedPlace}</p>
                  <p className="mt-1 text-sm font-medium">{selectedResult.label}</p>
                  <p className="text-xs text-muted-foreground">{selectedResult.displayName}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" onClick={handleSave} disabled={!draft || !selectedResult}>
              {strings.savePlace}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
