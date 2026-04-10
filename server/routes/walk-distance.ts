import { Hono } from "hono";

interface CachedEntry {
  distanceMeters: number;
  durationSeconds: number;
  fetchedAt: number;
}

// Module-level cache — valid for 1 hour per origin/destination pair (coordinates
// rounded to 3 decimal places ≈ 100 m precision to maximise cache hit rate).
const cache = new Map<string, CachedEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000;

export const walkDistanceRoute = new Hono();

walkDistanceRoute.get("/", async (c) => {
  const fromLat = parseFloat(c.req.query("fromLat") ?? "");
  const fromLon = parseFloat(c.req.query("fromLon") ?? "");
  const toLat   = parseFloat(c.req.query("toLat")   ?? "");
  const toLon   = parseFloat(c.req.query("toLon")   ?? "");

  if (!isFinite(fromLat) || !isFinite(fromLon) || !isFinite(toLat) || !isFinite(toLon)) {
    return c.json({ error: "invalid_coordinates" }, 400);
  }

  const key = `${fromLat.toFixed(3)},${fromLon.toFixed(3)},${toLat.toFixed(3)},${toLon.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return c.json({ distanceMeters: cached.distanceMeters, durationSeconds: cached.durationSeconds });
  }

  const apiKey = process.env.VITE_GOOGLE_STREETVIEW_KEY;
  if (!apiKey) {
    return c.json({ error: "no_api_key" }, 503);
  }

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", `${fromLat},${fromLon}`);
  url.searchParams.set("destinations", `${toLat},${toLon}`);
  url.searchParams.set("mode", "walking");
  url.searchParams.set("key", apiKey);

  let resp: Response;
  try {
    resp = await fetch(url.toString());
  } catch {
    return c.json({ error: "upstream_unavailable" }, 502);
  }

  if (!resp.ok) {
    return c.json({ error: "upstream_error" }, 502);
  }

  type DistMatrixResponse = {
    status: string;
    rows: Array<{
      elements: Array<{
        status: string;
        distance: { value: number };
        duration: { value: number };
      }>;
    }>;
  };

  const data = await resp.json() as DistMatrixResponse;

  if (data.status !== "OK" || data.rows[0]?.elements[0]?.status !== "OK") {
    return c.json({ error: "route_not_found" }, 404);
  }

  const elem = data.rows[0].elements[0];
  const result: CachedEntry = {
    distanceMeters: elem.distance.value,
    durationSeconds: elem.duration.value,
    fetchedAt: Date.now(),
  };
  cache.set(key, result);

  return c.json({ distanceMeters: result.distanceMeters, durationSeconds: result.durationSeconds });
});
