export interface PlaceSearchResult {
  id: string;
  label: string;
  displayName: string;
  lat: number;
  lon: number;
}

interface NominatimResponseItem {
  place_id: number;
  display_name: string;
  name?: string;
  lat: string;
  lon: string;
}

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";

function mapNominatimItem(item: NominatimResponseItem): PlaceSearchResult | null {
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    id: String(item.place_id),
    label: item.name || item.display_name.split(",")[0] || item.display_name,
    displayName: item.display_name,
    lat,
    lon,
  };
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceSearchResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    return [];
  }

  const url = new URL(`${NOMINATIM_BASE_URL}/search`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("countrycodes", "se");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("q", trimmedQuery);

  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Place search failed with status ${response.status}`);
  }

  const results = (await response.json()) as NominatimResponseItem[];
  return results
    .map(mapNominatimItem)
    .filter((result): result is PlaceSearchResult => result !== null);
}

export async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<PlaceSearchResult | null> {
  const url = new URL(`${NOMINATIM_BASE_URL}/reverse`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "0");

  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Reverse geocode failed with status ${response.status}`);
  }

  const result = (await response.json()) as NominatimResponseItem;
  return mapNominatimItem(result);
}
