/**
 * Thin API client replacing the Supabase JS client.
 * All calls go to the co-located Hono API server.
 */

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

async function post<T = unknown>(endpoint: string, body?: unknown): Promise<{ data: T; error: null } | { data: null; error: Error }> {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: res.statusText }));
      return { data: null, error: new Error(errBody.error || res.statusText) };
    }
    const data = await res.json();
    return { data: data as T, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/** Fetch static GTFS data (stops, routes, stopRoutes) */
export function fetchStaticData(body: { hash?: string; dataset?: string }) {
  return post<{
    unchanged: boolean;
    hash: string;
    stops?: { stop_id: string; stop_name: string; stop_lat: number; stop_lon: number }[];
    routes?: { route_id: string; route_short_name: string }[];
    stopRoutes?: { stop_id: string; route_id: string }[];
  }>("/static-data", body);
}

/** Fetch live vehicle positions */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fetchVehicles() {
  return post<{ vehicles: any[]; timestamp: number }>("/vehicles");
}

/** Fetch road situations from Trafikverket */
export function fetchSituations(body: { lat: number; lon: number; radiusMeters: number; limit: number }) {
  return post<{ situations: unknown[]; fetchedAt: string }>("/situations", body);
}

/** Fetch stop_times for a single trip */
export function fetchStopTimes(tripId: string) {
  return post<{ data: { stop_id: string; stop_sequence: number; arrival_time: string; departure_time: string }[] }>(
    "/stop-times",
    { tripId }
  );
}

/** Fetch stop_times for multiple trips */
export function fetchStopTimesMulti(tripIds: string[]) {
  return post<{ data: { trip_id: string; stop_id: string; stop_sequence: number; arrival_time: string; departure_time: string }[] }>(
    "/stop-times",
    { tripIds }
  );
}
